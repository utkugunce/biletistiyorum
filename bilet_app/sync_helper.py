import json
import os
from pathlib import Path
import time
import urllib.request

from folder_sync import reconcile_folder, sanitize_filename_component
from ticket_inventory import is_inventory_directory

SUPABASE_URL = os.environ.get("SUPABASE_URL", "https://kgchdufcqgyhycgyydhf.supabase.co")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY", "sb_publishable_aT8iwPOs6AOg5HfaAQpGhg_TlvHwG2T")

_LAST_EXPLORER_CMD_ID = None
_INITIALIZED_CMD_ID = False


def is_pool_or_system_dir(path: Path) -> bool:
    return is_inventory_directory(path.name)


def sync_cloud_assignments_to_folders(folder: Path):
    """Reconcile explicit assignments using a persistent journal per match root."""
    global _LAST_EXPLORER_CMD_ID, _INITIALIZED_CMD_ID
    if not folder or not folder.exists():
        return
    folder = folder.resolve()
    try:
        request = urllib.request.Request(
            f"{SUPABASE_URL}/rest/v1/portal_requests?id=eq.__SYSTEM_STATE__&select=*",
            headers={"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}"},
        )
        with urllib.request.urlopen(request, timeout=4) as response:
            rows = json.loads(response.read().decode("utf-8"))
        if not isinstance(rows, list) or not rows:
            return
        sys_state = rows[0].get("assigned_seats")
        if not isinstance(sys_state, dict):
            return
        virtual_map = sys_state.get("virtual_assignments")
        if not isinstance(virtual_map, dict):
            return
        explorer_cmd = sys_state.get("explorer_cmd") or {}
    except Exception:
        return

    from server import _find_ticket_path_map, normalize_text
    try:
        reconcile_folder(folder, virtual_map, _find_ticket_path_map(folder))
    except (OSError, ValueError) as error:
        print(f"[Sync] Folder reconciliation stopped safely: {error}")
        return

    # 2. Bulut üzerinden gelen Dosya Gezgini açma komutunu kontrol et (T10)
    cmd_id = explorer_cmd.get("id")
    if not _INITIALIZED_CMD_ID:
        _LAST_EXPLORER_CMD_ID = cmd_id
        _INITIALIZED_CMD_ID = True
    elif cmd_id and cmd_id != _LAST_EXPLORER_CMD_ID:
        _LAST_EXPLORER_CMD_ID = cmd_id
        # Sadece son 30 saniye içinde tetiklenmiş taze komutları aç
        cmd_ts = explorer_cmd.get("ts") or 0
        if time.time() * 1000 - cmd_ts < 30000:
            grp = (explorer_cmd.get("group") or "").strip()
            sub = (explorer_cmd.get("subgroup") or "").strip()
            rid = (explorer_cmd.get("request_id") or "").strip()
            target = folder
            if grp:
                safe_grp = sanitize_filename_component(grp)
                found_target = None
                for item in folder.iterdir():
                    if item.is_dir() and normalize_text(item.name) == normalize_text(safe_grp):
                        found_target = item
                        break
                if found_target:
                    target = found_target
                    if rid and (target / sanitize_filename_component(rid)).exists():
                        target = target / sanitize_filename_component(rid)
                    elif sub and (target / sanitize_filename_component(sub)).exists():
                        target = target / sanitize_filename_component(sub)
                else:
                    target = folder / safe_grp
                    if rid:
                        target = target / sanitize_filename_component(rid)
                    elif sub:
                        target = target / sanitize_filename_component(sub)

            # Güvenlik kontrolü: target klasörü mutlak suretle folder altında kalmalı
            try:
                target_resolved = target.resolve()
                folder_resolved = folder.resolve()
                if not target_resolved.is_relative_to(folder_resolved):
                    target = folder
            except Exception:
                target = folder

            if not target.exists():
                target = folder

            try:
                from desktop_helper import open_folder_on_user_desktop
                print(f"[Sync] Masaüstü Explorer açılıyor: {target}")
                open_folder_on_user_desktop(target)
            except Exception as ex:
                print(f"[Sync] Explorer açma hatası: {ex}")
