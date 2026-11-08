"""Preview or copy a Windows workspace into a verified, organized layout.

No source file is removed. Stop the companion before --apply. Old personal PDF
folders become an archive; program files retain their repository layout.
"""
import argparse
from datetime import datetime
import hashlib
import json
from pathlib import Path
import shutil
import socket
import subprocess
import sys
import tempfile

JOURNAL = '.zeren-folder-sync.json'
CACHES = {'.pytest_cache', '__pycache__'}
PROGRAM_DIRS = {'.git', 'api', 'assets', 'bilet_app', 'biletistiyorum', 'icons',
                'lib', 'migrations', 'scripts', 'static', 'tests', 'tickets',
                '.venv', 'venv', 'node_modules', '.vercel', '.vscode', '.idea'}


def read_json(path):
    return json.loads(path.read_text(encoding='utf-8-sig'))


def digest(path):
    result = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            result.update(chunk)
    return result.hexdigest()


def linked(path):
    return path.is_symlink() or (hasattr(path, 'is_junction') and path.is_junction())


def files(path):
    if linked(path):
        raise ValueError(f'Linked directory/file needs a separate migration: {path}')
    if path.is_file():
        yield path
    elif path.is_dir():
        for child in sorted(path.iterdir()):
            if child.name not in CACHES:
                yield from files(child)


def plan_migration(source, destination, stamp=None):
    source, destination = Path(source).resolve(), Path(destination).resolve()
    if source == destination or source.is_relative_to(destination) or destination.is_relative_to(source):
        raise ValueError('Source and destination must be separate directories.')
    if not (source / 'bilet_app/server.py').is_file() or not (source / '.git').is_dir():
        raise ValueError('Run from the existing repository containing bilet_app/server.py and .git.')
    if destination.exists():
        raise ValueError(f'Destination already exists; nothing will be overwritten: {destination}')
    if (source / '.git/index.lock').exists():
        raise ValueError('A Git operation is still running. Try again after it completes.')
    git = subprocess.run(['git', 'ls-files', '-z'], cwd=source, capture_output=True, check=True)
    tracked = {name.split('/', 1)[0] for name in git.stdout.decode('utf-8').split('\0') if name}
    storage_file = source / 'bilet_app/data/storage.json'
    storage = read_json(storage_file) if storage_file.exists() else {}
    active = Path(storage.get('last_folder') or source).resolve()
    matches = source.parent / 'Zeren_Bilet_Maclar'
    program = destination / 'Uygulama'
    new_matches = destination / 'Zeren_Bilet_Maclar'
    if matches.exists() and new_matches.exists():
        raise ValueError(f'Match destination already exists: {new_matches}')
    archive = destination / 'Arsiv' / ('121_BLOK_' + (stamp or datetime.now().strftime('%Y%m%d_%H%M%S_%f')))
    if archive.exists():
        raise ValueError(f'Archive destination already exists: {archive}')
    # Never rearrange a managed or active match tree internally.
    may_archive = not (source / JOURNAL).exists() and not (source / 'mac_bilet_plani.json').exists() and not active.is_relative_to(source)
    legacy = []
    for child in sorted(source.iterdir()):
        if child.name in CACHES:
            continue
        if may_archive and child.name not in tracked and child.name not in PROGRAM_DIRS:
            if any(item.suffix.lower() == '.pdf' for item in files(child)):
                legacy.append(child.name)
    copy_roots = [(source, program)] + ([(matches, new_matches)] if matches.exists() else [])
    if not any(active.is_relative_to(old) for old, _ in copy_roots):
        raise ValueError(f'Active match is outside the migration roots: {active}')
    for old, new in copy_roots:
        if linked(old) or linked(new.parent):
            raise ValueError('Linked migration roots are not supported.')
    return {'source': source, 'destination': destination, 'program': program, 'matches': matches,
            'new_matches': new_matches, 'archive': archive, 'legacy': legacy,
            'active': active}


def mapped(path, plan, *, storage=False):
    path = Path(path).resolve()
    if storage and path == plan['source'] and plan['legacy']:
        return plan['archive']
    roots = [(plan['source'] / name, plan['archive'] / name) for name in plan['legacy']]
    roots += [(plan['matches'], plan['new_matches']), (plan['source'], plan['program'])]
    for old, new in roots:
        if path.is_relative_to(old):
            return new / path.relative_to(old)
    return path


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + '.migration.tmp')
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding='utf-8')
    temporary.replace(path)


def apply_migration(plan, *, check_service=True):
    if check_service:
        with socket.socket() as probe:
            probe.settimeout(1)
            if probe.connect_ex(('127.0.0.1', 8765)) == 0:
                raise ValueError('Bilet servisi halen acik. Once durdurun, sonra tekrar deneyin.')
    # Re-evaluate the plan immediately before copying; do not overwrite targets
    # or operate on a stale classification after another process changed it.
    fresh = plan_migration(plan['source'], plan['destination'])
    if fresh['legacy'] != plan['legacy'] or fresh['active'] != plan['active']:
        raise ValueError('Workspace changed after preview. Run the preview again.')
    parent = plan['destination'].parent
    parent.mkdir(parents=True, exist_ok=True)
    stage = Path(tempfile.mkdtemp(prefix='.bilet-workspace-', dir=parent))
    records, journals = [], []
    published = []
    try:
        def copy_entry(old, staged, final):
            if linked(old):
                raise ValueError(f'Linked directory/file needs a separate migration: {old}')
            if old.is_dir():
                staged.mkdir(parents=True, exist_ok=True)
                for child in sorted(old.iterdir()):
                    if child.name not in CACHES:
                        copy_entry(child, staged / child.name, final / child.name)
                return
            staged.parent.mkdir(parents=True, exist_ok=True)
            before = digest(old)
            with old.open('rb') as src, staged.open('xb') as dst:
                shutil.copyfileobj(src, dst)
            shutil.copystat(old, staged)
            if digest(staged) != before or digest(old) != before:
                raise ValueError(f'File changed or copy verification failed: {old}')
            records.append({'source': str(old), 'destination': str(final), 'sha256': before})
            if old.name == JOURNAL:
                journals.append((old, staged, final))

        program = stage / 'Uygulama'
        program.mkdir()
        for child in sorted(plan['source'].iterdir()):
            if child.name in CACHES:
                continue
            if child.name in plan['legacy']:
                copy_entry(child, stage / 'Arsiv' / plan['archive'].name / child.name, plan['archive'] / child.name)
            else:
                copy_entry(child, program / child.name, plan['program'] / child.name)
        if plan['matches'].exists():
            (stage / 'Zeren_Bilet_Maclar').mkdir()
            copy_entry(plan['matches'], stage / 'Zeren_Bilet_Maclar', plan['new_matches'])
        for original, staged, final in journals:
            journal = read_json(staged)
            if journal.get('version') != 1 or not isinstance(journal.get('managed'), dict):
                raise ValueError(f'Invalid ownership journal: {original}')
            if Path(journal.get('root', '')).resolve() != original.parent.resolve():
                raise ValueError(f'Ownership journal belongs to a different folder: {original}')
            journal['root'] = str(final.parent.resolve())
            write_json(staged, journal)
        storage_file = program / 'bilet_app/data/storage.json'
        if storage_file.exists():
            storage = read_json(storage_file)
            if storage.get('last_folder'):
                storage['last_folder'] = str(mapped(storage['last_folder'], plan, storage=True))
            for match in storage.get('matches', []):
                if match.get('folder'):
                    match['folder'] = str(mapped(match['folder'], plan, storage=True))
            write_json(storage_file, storage)
        # All sources must still match the snapshot after metadata changes.
        for record in records:
            if digest(Path(record['source'])) != record['sha256']:
                raise ValueError('A source file changed during migration. Stop all file operations and retry.')
        modified = {str(final) for _, _, final in journals}
        if storage_file.exists():
            modified.add(str(plan['program'] / 'bilet_app/data/storage.json'))
        # One final rename publishes the entire workspace, with every permanent
        # application, match and archive directory inside the requested root.
        launcher = stage / 'Bilet_Yonetimini_Baslat.cmd'
        python_path = str(Path(sys.executable).resolve())
        launcher.write_text(
            '@echo off\nchcp 65001 >nul\n'
            'cd /d "%~dp0Uygulama"\n'
            'set "ZEREN_PYTHON=' + python_path + '"\n'
            'powershell -NoProfile -Command "'
            '$savedToken = [Environment]::GetEnvironmentVariable(\'ZEREN_COMPANION_TOKEN\', \'User\'); '
            'if ($savedToken) { $env:ZEREN_COMPANION_TOKEN = $savedToken }; '
            '$env:ZEREN_CLOUD_URL = \'https://biletistiyorum.vercel.app\'; '
            'Start-Process \'https://biletistiyorum.vercel.app/admin\'; '
            '& $env:ZEREN_PYTHON \'bilet_app/server.py\'"\npause\n', encoding='utf-8')
        report_relative = Path('Arsiv') / 'Tasima_Kayitlari' / (plan['archive'].name + '.json')
        report = plan['destination'] / report_relative
        for record in records:
            staged = stage / Path(record['destination']).relative_to(plan['destination'])
            record['destination_sha256'] = digest(staged)
            if record['destination'] not in modified and record['destination_sha256'] != record['sha256']:
                raise ValueError('Final copy verification failed.')
        git_root = subprocess.run(['git', 'rev-parse', '--show-toplevel'], cwd=program, capture_output=True, check=True)
        if Path(git_root.stdout.decode('utf-8').strip()).resolve() != program:
            raise ValueError('Copied Git configuration points to a different workspace.')
        if plan['destination'].exists():
            raise ValueError('Destination appeared during migration.')
        stage.rename(plan['destination'])
        published.append((stage, plan['destination']))
        write_json(report, {'completed': True, 'source_preserved': True,
                            'active_match': str(mapped(plan['active'], plan, storage=True)), 'files': records})
        return report
    except Exception:
        for staged, final in reversed(published):
            final.rename(staged)
        # Keep our staging copy for diagnosis. All original files remain intact.
        raise



def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', default='.')
    parser.add_argument('--destination', required=True)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    try:
        plan = plan_migration(args.source, args.destination)
        print('ANA KLASOR:', plan['destination'])
        print('PROGRAM:', plan['program'])
        print('MACLAR:', plan['new_matches'])
        print('ARSIV:', plan['archive'])
        print('AKTIF MAC:', mapped(plan['active'], plan, storage=True))
        print('ARSIVE AYRILACAK KLASOR/DOSYALAR:', ', '.join(plan['legacy']) or '(yok)')
        if not args.apply:
            print('ONIZLEME: Hicbir dosya degistirilmedi. Uygulamak icin --apply kullanin.')
            return 0
        report = apply_migration(plan)
        print('TAMAMLANDI. Dogrulama kaydi:', report)
        print('Eski konum yedek olarak korundu. Yeni ana klasordeki Bilet_Yonetimini_Baslat.cmd dosyasini kullanin.')
        return 0
    except (ValueError, OSError, subprocess.SubprocessError, KeyError) as error:
        print('ISLEM DURDU:', error)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
