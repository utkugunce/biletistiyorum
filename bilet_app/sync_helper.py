import os
import shutil
import subprocess
import json
import urllib.request
import time
import re
from pathlib import Path

SUPABASE_URL = os.environ.get("SUPABASE_URL", "https://kgchdufcqgyhycgyydhf.supabase.co")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY", "sb_publishable_aT8iwPOs6AOg5HfaAQpGhg_TlvHwG2T")

_LAST_EXPLORER_CMD_ID = None
_INITIALIZED_CMD_ID = False
_LAST_STATE_VERSION = None


def sanitize_filename_component(name: str) -> str:
    """Windows dosya ve klasör adlarında yasaklanan karakterleri temizler ve path traversal'ı engeller."""
    if not name:
        return "Genel"
    # Yasaklı karakterler: \ / : * ? " < > |
    cleaned = re.sub(r'[\\/:*?"<>|]+', '_', str(name)).strip('. ')
    # Güvenlik: .. veya gizli dizin atlamasını engelle
    cleaned = cleaned.replace("..", "_")
    return cleaned or "Genel"


def sync_cloud_assignments_to_folders(folder: Path):
    """
    T09: İki yönlü mutabakat ile bulut atamalarını yerel PDF klasörleriyle senkronize eder.
    - Bulutta bir gruba/talebe atanan koltuk PDF'i hedef klasöre taşınır.
    - Bulutta ataması kaldırılan (boşa çıkarılan) koltuk PDF'i kök havuza geri döner.
    - Dosya kilitlenmesi veya erişim hataları durumunda güvenli şekilde pas geçilir.
    """
    global _LAST_EXPLORER_CMD_ID, _INITIALIZED_CMD_ID, _LAST_STATE_VERSION

    if not folder or not folder.exists():
        return

    try:
        req = urllib.request.Request(
            f"{SUPABASE_URL}/rest/v1/portal_requests?id=eq.__SYSTEM_STATE__&select=*",
            headers={
                "apikey": SUPABASE_KEY,
                "Authorization": f"Bearer {SUPABASE_KEY}",
                "User-Agent": "Zeren-Local-Sync-Helper/2.0"
            }
        )
        with urllib.request.urlopen(req, timeout=4) as resp:
            rows = json.loads(resp.read().decode("utf-8"))
            if not rows:
                return
            sys_state = rows[0].get("assigned_seats") or {}
            virtual_map = sys_state.get("virtual_assignments") or {}
            explorer_cmd = sys_state.get("explorer_cmd") or {}
            current_version = sys_state.get("version", 0)
    except Exception as e:
        # Ağ kesintisi veya geçici hata durumunda yerel dosyaları bozma
        return

    # Map current physical ticket positions
    from server import _find_ticket_path_map, normalize_text
    path_map = _find_ticket_path_map(folder)

    # 1. Atanmış biletler için hedef belirleme
    assigned_keys = {}
    for key, v in virtual_map.items():
        grp = (v.get("group") or "").strip()
        if grp:
            assigned_keys[key] = v

    # A. Atanmış biletleri ilgili klasörlerine taşı
    for key, v in assigned_keys.items():
        grp = (v.get("group") or "").strip()
        sub = (v.get("subgroup") or "").strip()
        req_id = (v.get("request_id") or "").strip()

        safe_grp = sanitize_filename_component(grp)
        target_dir = folder / safe_grp
        if req_id:
            target_dir = target_dir / sanitize_filename_component(req_id)
        elif sub:
            target_dir = target_dir / sanitize_filename_component(sub)

        try:
            target_dir.mkdir(parents=True, exist_ok=True)
        except OSError as ex:
            print(f"[Sync] Hedef klasör oluşturulamadı ({target_dir}): {ex}")
            continue

        src_path = path_map.get(key)
        if src_path and src_path.exists():
            dst_path = target_dir / src_path.name
            if src_path.resolve() != dst_path.resolve():
                try:
                    shutil.move(str(src_path), str(dst_path))
                    print(f"[Sync] Atanan taşındı: {src_path.name} -> {target_dir.name}")
                    path_map[key] = dst_path
                except (PermissionError, OSError) as ex:
                    print(f"[Sync] Dosya taşınamadı (kilitli olabilir): {src_path.name} ({ex})")

    # B. Ataması kaldırılan (virtual_map'te olmayan) biletleri kök havuza geri taşı (T09)
    for key, src_path in path_map.items():
        if key not in assigned_keys:
            # Koltuk şu an atanmamış durumda. Kök havuzda mı olmalı?
            if src_path and src_path.exists() and src_path.parent.resolve() != folder.resolve():
                dst_path = folder / src_path.name
                if not dst_path.exists():
                    try:
                        shutil.move(str(src_path), str(dst_path))
                        print(f"[Sync] Ataması kalkan bilet havuza geri döndü: {src_path.name} -> {folder.name}")
                        path_map[key] = dst_path
                    except (PermissionError, OSError) as ex:
                        print(f"[Sync] Geri taşıma hatası: {src_path.name} ({ex})")

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
                if not str(target_resolved).startswith(str(folder_resolved)):
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


print("sync helper ready")
