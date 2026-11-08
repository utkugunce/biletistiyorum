"""Crash-recoverable reconciliation of PDFs explicitly managed by this app.

The journal lives inside each match folder. Unknown/manual files are never
inferred to be old cloud assignments just because of their directory names.
"""

import hashlib
import json
import os
from pathlib import Path
import shutil
import tempfile
import threading
import time

JOURNAL_NAME = ".zeren-folder-sync.json"
_LOCK = threading.RLock()


def sanitize_filename_component(name):
    import re
    value = re.sub(r'[\\/:*?"<>|\x00-\x1f]+', '_', str(name or '')).strip('. ')
    value = value.replace('..', '_') or 'Genel'
    if value.split('.')[0].upper() in {
        'CON', 'PRN', 'AUX', 'NUL',
        *(f'COM{i}' for i in range(1, 10)),
        *(f'LPT{i}' for i in range(1, 10)),
    }:
        value = '_' + value
    return value


def _inside(root, relative):
    candidate = root / relative
    try:
        candidate.resolve().relative_to(root.resolve())
    except ValueError:
        raise ValueError('Ticket path escapes its match folder') from None
    return candidate


def _digest(path):
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def _load(root):
    path = root / JOURNAL_NAME
    if not path.exists():
        return {'version': 1, 'root': str(root), 'managed': {}}
    with path.open(encoding='utf-8') as stream:
        journal = json.load(stream)
    if (not isinstance(journal, dict) or journal.get('version') != 1
            or journal.get('root') != str(root)
            or not isinstance(journal.get('managed'), dict)):
        raise ValueError('Invalid journal or journal belongs to another match folder')
    for record in journal['managed'].values():
        if (not isinstance(record, dict) or not isinstance(record.get('path'), str)
                or not isinstance(record.get('sha256'), str)):
            raise ValueError('Invalid managed ticket record')
        _inside(root, record['path'])
        if record.get('target'):
            _inside(root, record['target'])
    return journal


def _save(root, journal):
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(
            mode='w', encoding='utf-8', dir=root,
            prefix=JOURNAL_NAME + '.', suffix='.tmp', delete=False,
        ) as stream:
            temporary = Path(stream.name)
            json.dump(journal, stream, ensure_ascii=False, indent=2)
            stream.flush()
            os.fsync(stream.fileno())
        target = root / JOURNAL_NAME
        for attempt in range(5):
            try:
                os.replace(temporary, target)
                break
            except PermissionError:
                if attempt == 4:
                    # Preserve the existing ownership journal if Windows keeps
                    # it locked. An in-place copy can leave truncated JSON.
                    raise
                time.sleep(0.05)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def _move_without_overwrite(source, destination, expected_digest):
    """Keep the source until a complete destination has been flushed to disk."""
    if source.resolve() == destination.resolve():
        return
    if destination.exists():
        # Recover an interrupted copy where both complete copies survived.
        if _digest(source) == expected_digest == _digest(destination):
            source.unlink()
            return
        raise FileExistsError(f'Destination already exists: {destination.name}')
    destination.parent.mkdir(parents=True, exist_ok=True)
    created = False
    try:
        with source.open('rb') as src, destination.open('xb') as dst:
            created = True
            shutil.copyfileobj(src, dst)
            dst.flush()
            os.fsync(dst.fileno())
        if _digest(destination) != expected_digest:
            raise OSError('Source changed while copying ticket')
        source.unlink()
    except OSError:
        if created and source.exists():
            destination.unlink(missing_ok=True)
        raise


def _owned_path(root, record):
    """Find only a recorded file; never discover ownership by scanning names."""
    for relative in dict.fromkeys([record['path'], record.get('target')]):
        if relative:
            path = _inside(root, relative)
            if path.is_file() and _digest(path) == record['sha256']:
                return path
    return None


def reconcile_folder(folder, assignments, path_map, errors=None):
    """Apply cloud assignments and retry pending returns using a per-root journal.

    path_map maps seat keys to the current PDF paths from the existing parser.
    A corrupt journal fails closed. The function never deletes the journal to
    recover automatically, since that would discard ownership information.
    """
    root = Path(folder).resolve()
    errors = errors if errors is not None else []
    with _LOCK:
        journal = _load(root)
        managed = journal['managed']
        active = {key: value for key, value in assignments.items()
                  if isinstance(value, dict) and str(value.get('group') or '').strip()}

        for key, assignment in active.items():
            source = path_map.get(key)
            try:
                old = managed.get(key)
                if old:
                    owned = _owned_path(root, old)
                    if owned is not None:
                        # The scanner's seat map may also contain an unrelated
                        # duplicate. Preserve provenance instead of adopting it.
                        source = owned
                if source is None:
                    continue
                source = _inside(root, Path(source).resolve().relative_to(root))
                if not source.is_file():
                    continue
                group = sanitize_filename_component(assignment['group'].strip())
                part = assignment.get('request_id') or assignment.get('subgroup')
                relative = Path(group)
                if part:
                    relative /= sanitize_filename_component(part)
                destination = _inside(root, relative / source.name)
                if (old and old['path'] == str(source.resolve().relative_to(root))
                        and not old.get('target') and source == destination
                        and old.get('mtime_ns') == source.stat().st_mtime_ns
                        and old.get('size') == source.stat().st_size):
                    continue
                fingerprint = _digest(source)
                record = {
                    'path': str(source.resolve().relative_to(root)),
                    'target': str(destination.resolve().relative_to(root)),
                    'sha256': fingerprint,
                }
                managed[key] = record
                # Persist intent before changing a PDF's physical location.
                _save(root, journal)
                _move_without_overwrite(source, destination, fingerprint)
                managed[key] = {
                    'path': str(destination.relative_to(root)),
                    'sha256': fingerprint,
                    'mtime_ns': destination.stat().st_mtime_ns,
                    'size': destination.stat().st_size,
                }
                _save(root, journal)
                path_map[key] = destination
            except (OSError, ValueError) as error:
                print(f'[Sync] Assignment pending for {key}: {error}')
                errors.append(f'{key}: {error}')

        for key in list(managed):
            if key in active:
                continue
            try:
                record = managed[key]
                source = _owned_path(root, record)
                if source is None:
                    # Missing, replaced or manually relocated: do not touch a
                    # similarly named file elsewhere in this match directory.
                    continue
                destination = _inside(root, source.name)
                record['target'] = str(destination.resolve().relative_to(root))
                _save(root, journal)
                _move_without_overwrite(source, destination, record['sha256'])
                # Only forget ownership once the return really succeeded.
                del managed[key]
                _save(root, journal)
                path_map[key] = destination
            except (OSError, ValueError) as error:
                print(f'[Sync] Return pending for {key}: {error}')
                errors.append(f'{key}: {error}')
        return path_map


def command_result(folder, command_id):
    with _LOCK:
        return _load(Path(folder).resolve()).get('commands', {}).get(command_id)


def remember_command(folder, command_id):
    with _LOCK:
        root = Path(folder).resolve()
        journal = _load(root)
        journal.setdefault('commands', {})[command_id] = True
        journal['commands'] = dict(list(journal['commands'].items())[-200:])
        _save(root, journal)
