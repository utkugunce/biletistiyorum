import time
import sys
import json
import hashlib
from pathlib import Path

from cloud_bridge import call, match_id_for
from folder_sync import reconcile_folder, sanitize_filename_component, command_result, remember_command
from ticket_inventory import is_inventory_directory, build_inventory

_LAST_REPORT = {}
_LAST_INVENTORY = {}


def is_pool_or_system_dir(path: Path) -> bool:
    return is_inventory_directory(path.name)


def sync_cloud_assignments_to_folders(folder: Path):
    """Reconcile one explicitly bound match and acknowledge durable commands."""
    if not folder or not folder.exists():
        return
    folder = folder.resolve()
    try:
        match_id = match_id_for(folder)
        rows = call('/api/companion/state', match_id=match_id)
        state = rows[0]['assigned_seats']
        assignments = state.get('virtual_assignments')
        if state.get('match_id') != match_id or not isinstance(assignments, dict):
            return
        server = sys.modules.get('server')
        if server is None or not hasattr(server, '_find_ticket_path_map'):
            server = sys.modules.get('__main__')
        if server is None or not hasattr(server, '_find_ticket_path_map'):
            raise ValueError('Ticket parser is not initialized')
        _find_ticket_path_map = server._find_ticket_path_map
        errors = []
        reconcile_folder(folder, assignments, _find_ticket_path_map(folder), errors=errors)
        inventory = build_inventory(folder, _find_ticket_path_map(folder), assignments)
        inventory_hash = hashlib.sha256(json.dumps(inventory, sort_keys=True).encode()).hexdigest()
        now = time.monotonic()
        changed = _LAST_INVENTORY.get(str(folder)) != inventory_hash
        if now - _LAST_REPORT.get(str(folder), -100) >= 10 or changed:
            call('/api/companion/report', 'POST', {
                'status': 'error' if errors else 'online', 'error': errors[0] if errors else '',
                **({'inventory': inventory} if changed else {}),
            }, match_id=match_id)
            _LAST_REPORT[str(folder)] = now
            _LAST_INVENTORY[str(folder)] = inventory_hash
        for command in state.get('explorer_commands', []):
            if command.get('match_id') != match_id or not command.get('id'):
                continue
            success, error = False, ''
            try:
                if not command_result(folder, command['id']):
                    if time.time() * 1000 - command.get('ts', 0) > 300000:
                        raise ValueError('Klasör açma isteğinin süresi doldu; yeniden isteyiniz.')
                    target = folder / sanitize_filename_component(command.get('group')) / sanitize_filename_component(command.get('request_id'))
                    if not target.resolve().is_relative_to(folder):
                        raise ValueError('Geçersiz hedef klasör')
                    expected = [key for key, value in assignments.items()
                                if value.get('request_id') == command.get('request_id')]
                    paths = _find_ticket_path_map(folder)
                    if not expected or any(key not in paths or paths[key].parent.resolve() != target.resolve() for key in expected):
                        raise ValueError('Bu talebin PDF dosyaları henüz hazır değil.')
                    from desktop_helper import open_folder_on_user_desktop
                    if open_folder_on_user_desktop(target) is not True:
                        raise OSError('Explorer komutu çalıştırılamadı.')
                    remember_command(folder, command['id'])
                success = True
            except (OSError, ValueError) as problem:
                error = str(problem)
            call('/api/companion/report', 'POST', {
                'command_id': command['id'], 'success': success,
                'status': 'online' if success else 'error', 'error': error,
            }, match_id=match_id)
    except Exception as error:
        print(f'[Sync] Cloud bridge pending: {type(error).__name__}: {error}')
