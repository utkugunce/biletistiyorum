import os, shutil, subprocess, json, urllib.request
from pathlib import Path

SUPABASE_URL = "https://kgchdufcqgyhycgyydhf.supabase.co"
SUPABASE_KEY = "sb_publishable_aT8iwPOs6AOg5HfaAQpGhg_TlvHwG2T"

def sync_cloud_assignments_to_folders(folder: Path):
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
    except Exception as e:
        print("Cloud sync error:", e)
        return

    # Map current physical ticket positions
    from server import _find_ticket_path_map
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

print("sync helper ready")
