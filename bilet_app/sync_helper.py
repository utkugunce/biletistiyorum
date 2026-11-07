import os, shutil, subprocess, json, urllib.request, time
from pathlib import Path

SUPABASE_URL = "https://kgchdufcqgyhycgyydhf.supabase.co"
SUPABASE_KEY = "sb_publishable_aT8iwPOs6AOg5HfaAQpGhg_TlvHwG2T"

_LAST_EXPLORER_CMD_ID = None
_INITIALIZED_CMD_ID = False

def sync_cloud_assignments_to_folders(folder: Path):
    global _LAST_EXPLORER_CMD_ID, _INITIALIZED_CMD_ID
    try:
        req = urllib.request.Request(
            f"{SUPABASE_URL}/rest/v1/portal_requests?id=eq.__SYSTEM_STATE__&select=*",
            headers={"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}"}
        )
        with urllib.request.urlopen(req, timeout=3) as resp:
            rows = json.loads(resp.read().decode("utf-8"))
            if not rows:
                return
            sys_state = rows[0].get("assigned_seats") or {}
            virtual_map = sys_state.get("virtual_assignments") or {}
            explorer_cmd = sys_state.get("explorer_cmd") or {}
    except Exception as e:
        print("Cloud sync error:", e)
        return

    # Map current physical ticket positions
    from server import _find_ticket_path_map, normalize_text
    path_map = _find_ticket_path_map(folder)

    for key, v in virtual_map.items():
        grp = (v.get("group") or "").strip()
        sub = (v.get("subgroup") or "").strip()
        req_id = (v.get("request_id") or "").strip()
        if not grp:
            continue
        target_dir = folder / grp
        if req_id:
            target_dir = target_dir / req_id
        elif sub:
            target_dir = target_dir / sub
        target_dir.mkdir(parents=True, exist_ok=True)

        src_path = path_map.get(key)
        if src_path and src_path.exists():
            dst_path = target_dir / src_path.name
            if src_path.resolve() != dst_path.resolve():
                try:
                    shutil.move(str(src_path), str(dst_path))
                    print(f"Moved {src_path.name} to {target_dir}")
                except Exception as ex:
                    print("Move error:", ex)

    # Bulut üzerinden gelen Dosya Gezgini açma komutunu kontrol et
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
                found_target = None
                for item in folder.iterdir():
                    if item.is_dir() and normalize_text(item.name) == normalize_text(grp):
                        found_target = item
                        break
                if found_target:
                    target = found_target
                    if rid and (target / rid).exists():
                        target = target / rid
                    elif sub and (target / sub).exists():
                        target = target / sub
                else:
                    target = folder / grp
                    if rid:
                        target = target / rid
                    elif sub:
                        target = target / sub
            if not target.exists():
                target = folder
            try:
                from desktop_helper import open_folder_on_user_desktop
                print(f"Opening desktop explorer via cloud bridge: {target}")
                open_folder_on_user_desktop(target)
            except Exception as ex:
                print("Cloud explorer open error:", ex)

print("sync helper ready")
