# -*- coding: utf-8 -*-
"""
Başkent Voleybol Salonu (TVF Ziraat Bankkart Voleybol Salonu)
Sezonluk Çoklu Maç Bilet Dağıtım ve Takip Uygulaması - FastAPI Backend
"""

import io
import json
import os
import re
import secrets
import shutil
import zipfile
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import quote

from fastapi import FastAPI, File, Form, HTTPException, Query, UploadFile, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from blocks_data import ARENA_ZONES, BLOCKS_DB, CLOSED_BLOCKS, get_block_layout
from excel_reader import (
    EXCEL_DEFAULT_PATH,
    match_requests_with_tickets,
    normalize_text,
    parse_bilet_takip_excel,
)
from portal_storage import (
    CLUB_STAFF_PRESETS,
    create_portal_request,
    format_whatsapp_phone,
    get_person_phone,
    get_requests_by_person,
    get_requests_for_match,
    load_phonebook,
    load_portal_requests,
    save_person_phone,
    set_request_whatsapp_sent,
    update_request_fulfillment,
    update_request_phone,
)

APP_DIR = Path(__file__).resolve().parent
DEFAULT_MATCH_DIR = APP_DIR.parent
MATCHES_ROOT_DIR = DEFAULT_MATCH_DIR.parent / "Zeren_Bilet_Maclar"
DATA_DIR = APP_DIR / "data"
ASSETS_DIR = APP_DIR / "assets" / "tribun"
STATIC_DIR = APP_DIR / "static"
STORAGE_FILE = DATA_DIR / "storage.json"

DATA_DIR.mkdir(parents=True, exist_ok=True)
MATCHES_ROOT_DIR.mkdir(parents=True, exist_ok=True)

IGNORED_DIRS = {"bilet_app", ".git", "__pycache__", ".vscode", ".idea", "node_modules"}
PLAN_FILENAME = "mac_bilet_plani.json"

# Biletinial PDF dosya adı deseni: "{Blok} {Sıra} - -{Koltuk}.pdf" (ve esnek varyantlar)
TICKET_REGEX = re.compile(r"^(\d{3})\s*[-_ ]*\s*(\d+)\s*[-_ ]+\s*-?\s*(\d+)\.pdf$", re.IGNORECASE)

DEFAULT_PALETTE = [
    "#2563EB",
    "#9333EA",
    "#059669",
    "#EA580C",
    "#DB2777",
    "#0891B2",
    "#4F46E5",
    "#D97706",
    "#0D9488",
    "#E11D48",
    "#65A30D",
    "#7C3AED",
    "#0284C7",
    "#C026D3",
    "#DC2626",
]

DIGER_COLOR = "#D97706"


def load_match_plan(folder: Path) -> Dict[str, Any]:
    """Maç klasöründeki sanal koltuk planlamasını ve maç başlığını okur."""
    pfile = folder / PLAN_FILENAME
    if pfile.exists():
        try:
            with open(pfile, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return {"match_name": "", "match_date": "", "virtual_assignments": {}}


def save_match_plan(folder: Path, plan_data: Dict[str, Any]):
    pfile = folder / PLAN_FILENAME
    with open(pfile, "w", encoding="utf-8") as f:
        json.dump(plan_data, f, ensure_ascii=False, indent=2)


def extract_pdf_match_info(pdf_path: Path) -> Dict[str, str]:
    info = {
        "match_name": "",
        "match_date": "",
        "venue": "TVF Ziraat Bankkart Voleybol Salonu",
    }
    try:
        from pypdf import PdfReader
        reader = PdfReader(str(pdf_path))
        if reader.pages:
            text = reader.pages[0].extract_text() or ""
            lines = [line.strip() for line in text.splitlines() if line.strip()]
            for i, line in enumerate(lines):
                if re.match(r"^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}$", line):
                    info["match_date"] = line
                    if i + 1 < len(lines):
                        info["match_name"] = lines[i + 1]
                    break
    except Exception:
        pass
    return info


class StateManager:
    def __init__(self):
        self.active_folder: Path = DEFAULT_MATCH_DIR
        self.undo_stack: List[Dict[str, Any]] = []
        self.redo_stack: List[Dict[str, Any]] = []
        self.storage: Dict[str, Any] = self._load_storage()
        if self.storage.get("last_folder") and Path(self.storage["last_folder"]).exists():
            self.active_folder = Path(self.storage["last_folder"])
        self._ensure_match_registered(self.active_folder)
        self.sync_excel_matches()

    def _load_storage(self) -> Dict[str, Any]:
        if STORAGE_FILE.exists():
            try:
                with open(STORAGE_FILE, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    # Eski şablonda "fenerbahçe" kalıcı şablon olarak kaldıysa temizle (maç klasöründen dinamik gelir)
                    saved = data.get("saved_groups", [])
                    data["saved_groups"] = [
                        g for g in saved if g.get("group", "").lower() != "fenerbahçe"
                    ]
                    if not any(g.get("group", "").lower() == "rakip kulüp" for g in data["saved_groups"]):
                        data["saved_groups"].insert(0, {"group": "rakip kulüp", "subgroups": []})
                    if "admin_password" not in data:
                        data["admin_password"] = os.environ.get("ZEREN_ADMIN_PASSWORD", "zeren2026")
                    if "admin_tokens" not in data:
                        data["admin_tokens"] = []
                    return data
            except Exception:
                pass
        default_data = {
            "last_folder": str(DEFAULT_MATCH_DIR),
            "admin_password": os.environ.get("ZEREN_ADMIN_PASSWORD", "zeren2026"),
            "admin_tokens": [],
            "matches": [],
            "group_colors": {
                "rakip kulüp": "#1D4ED8",
                "fenerbahçe": "#1D4ED8",
                "seda": "#9333EA",
                "eşref": "#059669",
                "utku": "#EA580C",
                "neslihan": "#DB2777",
                "ASC": "#0891B2",
                "berk çanakcı": "#4F46E5",
                "burak eser": "#0D9488",
                "MYZ": "#7C3AED",
                "çağlar": "#E11D48",
                "diğer": DIGER_COLOR,
            },
            "saved_groups": [
                {"group": "rakip kulüp", "subgroups": []},
                {"group": "seda", "subgroups": ["fatma", "seda", "dicle"]},
                {"group": "eşref", "subgroups": ["spor şube", "eşref1", "eşref2"]},
                {"group": "utku", "subgroups": ["gözde", "metubiz", "redbull"]},
                {"group": "neslihan", "subgroups": []},
                {"group": "ASC", "subgroups": []},
                {"group": "berk çanakcı", "subgroups": []},
                {"group": "burak eser", "subgroups": []},
                {"group": "MYZ", "subgroups": []},
                {"group": "çağlar", "subgroups": ["sırtlı"]},
                {"group": "diğer", "subgroups": []},
            ],
            "history": [],
        }
        self._save_storage(default_data)
        return default_data

    def _save_storage(self, data: Optional[Dict[str, Any]] = None):
        if data is not None:
            self.storage = data
        with open(STORAGE_FILE, "w", encoding="utf-8") as f:
            json.dump(self.storage, f, ensure_ascii=False, indent=2)

    def check_admin_password(self, pwd: str) -> bool:
        expected = str(self.storage.get("admin_password") or os.environ.get("ZEREN_ADMIN_PASSWORD") or "zeren2026")
        return pwd == expected

    def set_admin_password(self, new_pwd: str):
        self.storage["admin_password"] = new_pwd
        self._save_storage()

    def create_admin_session(self) -> str:
        token = secrets.token_hex(24)
        tokens = self.storage.get("admin_tokens", [])
        if not isinstance(tokens, list):
            tokens = []
        tokens.append(token)
        # en fazla son 50 oturumu tut
        self.storage["admin_tokens"] = tokens[-50:]
        self._save_storage()
        return token

    def verify_admin_token(self, token: Optional[str]) -> bool:
        if not token:
            return False
        tokens = self.storage.get("admin_tokens", [])
        if not isinstance(tokens, list):
            return False
        return token in tokens

    def revoke_admin_token(self, token: Optional[str]):
        if not token:
            return
        tokens = self.storage.get("admin_tokens", [])
        if isinstance(tokens, list) and token in tokens:
            tokens.remove(token)
            self.storage["admin_tokens"] = tokens
            self._save_storage()

    def _ensure_match_registered(self, folder: Path, custom_title: str = "", custom_date: str = ""):
        matches = self.storage.setdefault("matches", [])
        f_str = str(folder.resolve())
        for m in matches:
            if str(Path(m["folder"]).resolve()) == f_str:
                if custom_title:
                    m["title"] = custom_title
                if custom_date:
                    m["date"] = custom_date
                self._save_storage()
                return m

        # Yeni maç kaydı oluştur
        info = self._detect_folder_match_meta(folder)
        title = custom_title or info.get("match_name") or folder.name
        date_str = custom_date or info.get("match_date") or ""
        entry = {
            "id": datetime.now().strftime("%Y%m%d%H%M%S"),
            "title": title,
            "date": date_str,
            "folder": f_str,
            "created_at": datetime.now().strftime("%d.%m.%Y %H:%M"),
        }
        matches.insert(0, entry)
        self._save_storage()
        return entry

    def _detect_folder_match_meta(self, folder: Path) -> Dict[str, str]:
        plan_file = folder / PLAN_FILENAME
        if plan_file.exists():
            try:
                with open(plan_file, "r", encoding="utf-8") as f:
                    pdata = json.load(f)
                    if pdata.get("match_name"):
                        return {
                            "match_name": pdata["match_name"],
                            "match_date": pdata.get("match_date", ""),
                            "venue": "TVF Ziraat Bankkart Voleybol Salonu",
                        }
            except Exception:
                pass
        for root, dirs, files in os.walk(folder):
            dirs[:] = [d for d in dirs if d not in IGNORED_DIRS and not d.startswith(".")]
            for fname in files:
                if TICKET_REGEX.match(fname):
                    return extract_pdf_match_info(Path(root) / fname)
        return {"match_name": folder.name, "match_date": "", "venue": "TVF Ziraat Bankkart Voleybol Salonu"}

    def get_group_color(self, group_name: str) -> str:
        if not group_name:
            return "#94A3B8"
        g_lower = group_name.lower()
        if g_lower in ("diğer", "diger"):
            return DIGER_COLOR
        colors = self.storage.setdefault("group_colors", {})
        for k, v in colors.items():
            if k.lower() == g_lower:
                return v
        used = set(colors.values())
        for c in DEFAULT_PALETTE:
            if c not in used:
                colors[group_name] = c
                self._save_storage()
                return c
        chosen = DEFAULT_PALETTE[len(colors) % len(DEFAULT_PALETTE)]
        colors[group_name] = chosen
        self._save_storage()
        return chosen

    def ensure_group_in_templates(self, group_name: str, subgroup_name: str = ""):
        if not group_name:
            return
        self.get_group_color(group_name)

    def sync_excel_matches(self):
        try:
            res = parse_bilet_takip_excel()
            matches = self.storage.setdefault("matches", [])
            IGNORED_MATCHES = {"vakifbank", "vakıfbank", "ilbank", "fenerbahce", "fenerbahçe", "besiktas", "beşiktaş"}

            # Kuzeyboru maçını aktif listeye ekle/garantiye al
            has_kuzeyboru = any("kuzeyboru" in normalize_text(ex.get("title", "")) for ex in matches)
            if not has_kuzeyboru:
                kb_dir = MATCHES_ROOT_DIR / "Zeren Spor - Kuzeyboru"
                kb_dir.mkdir(parents=True, exist_ok=True)
                plan_file = kb_dir / PLAN_FILENAME
                if not plan_file.exists():
                    save_match_plan(
                        kb_dir,
                        {
                            "match_name": "Zeren Spor Kulübü - Kuzeyboru",
                            "match_date": "08.11.2026 16:00",
                            "virtual_assignments": {},
                        },
                    )
                matches.insert(0, {
                    "id": "20261108_kuzeyboru",
                    "title": "Zeren Spor Kulübü - Kuzeyboru",
                    "date": "08.11.2026 16:00",
                    "folder": str(kb_dir.resolve()),
                    "created_at": "02.11.2026 10:30",
                    "active": True,
                })

            if not res.get("ok"):
                self._save_storage()
                return

            for m in res.get("matches", []):
                mname = m["match_name"]
                norm_m = normalize_text(mname)
                if any(ig in norm_m for ig in IGNORED_MATCHES):
                    continue
                found = False
                for ex in matches:
                    ex_title = normalize_text(ex.get("title", ""))
                    ex_folder = normalize_text(ex.get("folder", ""))
                    if norm_m in ex_title or norm_m in ex_folder:
                        found = True
                        break
                if not found:
                    safe_name = f"Zeren Spor - {mname}"
                    target_dir = MATCHES_ROOT_DIR / safe_name
                    target_dir.mkdir(parents=True, exist_ok=True)
                    plan_file = target_dir / PLAN_FILENAME
                    if not plan_file.exists():
                        save_match_plan(
                            target_dir,
                            {
                                "match_name": f"Zeren Spor Kulübü - {mname}",
                                "match_date": "",
                                "virtual_assignments": {},
                            },
                        )
                    matches.append({
                        "id": datetime.now().strftime("%Y%m%d%H%M%S") + f"_{norm_m}",
                        "title": f"Zeren Spor Kulübü - {mname}",
                        "date": "",
                        "folder": str(target_dir.resolve()),
                        "created_at": datetime.now().strftime("%d.%m.%Y %H:%M"),
                        "from_excel": True,
                        "excel_match_name": mname,
                    })
            self._save_storage()
        except Exception:
            pass


state_mgr = StateManager()


def _is_raw_block_folder(folder_name: str) -> bool:
    """Klasör adı '121 BLOK' veya '102' gibi salt blok klasörü mü kontrol eder."""
    return bool(re.match(r"^\d{3}(\s*BLOK)?$", folder_name.strip(), re.IGNORECASE))


def scan_match_folder(folder: Path) -> Dict[str, Any]:
    """
    Aktif maç klasöründeki:
    1) Tüm fiziksel PDF biletleri
    2) Henüz PDF'i olmayan ama uygulama üzerinden planlanmış (sanal) koltuk atamalarını
    birleştirerek tam durumu döndürür.
    """
    if not folder.exists() or not folder.is_dir():
        raise HTTPException(status_code=400, detail=f"Klasör bulunamadı: {folder}")

    plan_data = load_match_plan(folder)
    virtual_map: Dict[str, Dict[str, str]] = plan_data.get("virtual_assignments", {})
    plan_dirty = False

    tickets: List[Dict[str, Any]] = []
    seen_keys = set()
    sample_pdf: Optional[Path] = None

    for root, dirs, files in os.walk(folder):
        dirs[:] = [d for d in dirs if d not in IGNORED_DIRS and not d.startswith(".")]
        rel_root = Path(root).relative_to(folder)
        rel_parts = [p for p in rel_root.parts if not _is_raw_block_folder(p)]

        for fname in files:
            m = TICKET_REGEX.match(fname)
            if not m:
                continue
            block_id, row_str, seat_str = m.group(1), m.group(2), m.group(3)
            row_num = int(row_str)
            seat_num = int(seat_str)
            key = f"{block_id}:{row_num}-{seat_num}"
            full_path = Path(root) / fname
            if sample_pdf is None:
                sample_pdf = full_path

            # Eğer bu PDF ana klasördeyse ama önceden sanal planlamada bir kişiye atandıysa otomatik o klasöre taşı!
            if len(rel_parts) == 0 and key in virtual_map:
                v_grp = virtual_map[key].get("group", "").strip()
                v_sub = virtual_map[key].get("subgroup", "").strip()
                if v_grp:
                    target_dir = folder / v_grp
                    if v_sub:
                        target_dir = target_dir / v_sub
                    target_dir.mkdir(parents=True, exist_ok=True)
                    dst_path = target_dir / fname
                    if full_path.resolve() != dst_path.resolve():
                        try:
                            shutil.move(str(full_path), str(dst_path))
                            full_path = dst_path
                            rel_parts = [v_grp] + ([v_sub] if v_sub else [])
                        except Exception:
                            pass
                del virtual_map[key]
                plan_dirty = True

            if len(rel_parts) == 0:
                group = ""
                subgroup = ""
                status = "unassigned"
            elif len(rel_parts) == 1:
                group = rel_parts[0]
                subgroup = ""
                status = "diger" if group.lower() in ("diğer", "diger") else "assigned"
            else:
                group = rel_parts[0]
                subgroup = "/".join(rel_parts[1:])
                status = "diger" if group.lower() in ("diğer", "diger") else "assigned"

            if group:
                state_mgr.ensure_group_in_templates(group, subgroup)

            seen_keys.add(key)
            tickets.append({
                "key": key,
                "seat_id": f"{row_num}-{seat_num}",
                "block": block_id,
                "row": row_num,
                "seat": seat_num,
                "filename": fname,
                "rel_path": str(full_path.relative_to(folder)).replace("\\", "/"),
                "group": group,
                "subgroup": subgroup,
                "label": f"{group}/{subgroup}" if subgroup else group,
                "status": status,
                "has_pdf": True,
                "color": state_mgr.get_group_color(group) if group else "#D97706",
            })

    # Fiziksel PDF'i henüz klasörde olmayan ama planlanmış (sanal) koltukları ekle
    for key, v_info in list(virtual_map.items()):
        if key in seen_keys:
            continue
        try:
            b_id, rs = key.split(":")
            r_num, s_num = map(int, rs.split("-"))
        except Exception:
            continue
        group = v_info.get("group", "").strip()
        subgroup = v_info.get("subgroup", "").strip()
        if not group:
            continue
        status = "diger" if group.lower() in ("diğer", "diger") else "assigned"
        tickets.append({
            "key": key,
            "seat_id": f"{r_num}-{s_num}",
            "block": b_id,
            "row": r_num,
            "seat": s_num,
            "filename": "",
            "rel_path": "(PDF Bekleniyor - Planlandı)",
            "group": group,
            "subgroup": subgroup,
            "label": f"{group}/{subgroup}" if subgroup else group,
            "status": status,
            "has_pdf": False,
            "color": state_mgr.get_group_color(group),
        })

    if plan_dirty:
        plan_data["virtual_assignments"] = virtual_map
        save_match_plan(folder, plan_data)

    # Maç bilgilerini belirle
    pdf_info = (
        extract_pdf_match_info(sample_pdf)
        if sample_pdf
        else {"match_name": "", "match_date": "", "venue": "TVF Ziraat Bankkart Voleybol Salonu"}
    )
    match_name = plan_data.get("match_name") or pdf_info.get("match_name") or folder.name
    match_date = plan_data.get("match_date") or pdf_info.get("match_date") or ""

    state_mgr._ensure_match_registered(folder, match_name, match_date)

    # Blok bazlı harita
    tickets_by_block: Dict[str, Dict[str, Any]] = {}
    for t in tickets:
        tickets_by_block.setdefault(t["block"], {})[t["seat_id"]] = t

    all_block_ids = sorted(set(list(BLOCKS_DB.keys()) + list(tickets_by_block.keys())))
    blocks_summary: Dict[str, Any] = {}

    for b_id in all_block_ids:
        b_tickets = tickets_by_block.get(b_id, {})
        extra_coords = [(t["row"], t["seat"]) for t in b_tickets.values()]
        layout = get_block_layout(b_id, extra_coords)

        total_pdfs = sum(1 for t in b_tickets.values() if t.get("has_pdf", True))
        assigned_count = sum(1 for t in b_tickets.values() if t["status"] == "assigned")
        diger_count = sum(1 for t in b_tickets.values() if t["status"] == "diger")
        unassigned_count = sum(1 for t in b_tickets.values() if t["status"] == "unassigned")

        blocks_summary[b_id] = {
            "id": b_id,
            "name": layout["name"],
            "zone": layout["zone"],
            "court_side": layout["court_side"],
            "cols": layout["cols"],
            "capacity": layout["capacity"],
            "rows": layout["rows"],
            "total_pdfs": total_pdfs,
            "total_active": len(b_tickets),
            "assigned_count": assigned_count,
            "diger_count": diger_count,
            "unassigned_count": unassigned_count,
            "available_count": diger_count + unassigned_count,
            "missing_count": max(0, layout["capacity"] - len(b_tickets)),
            "tickets": b_tickets,
            "has_image": (ASSETS_DIR / f"{b_id}.png").exists(),
        }

    groups_summary = build_groups_summary(tickets)

    # Bu maçta aktif olan grupları ve kayıtlı şablonları birleştir
    active_group_map: Dict[str, List[str]] = {}
    for sg_item in state_mgr.storage.get("saved_groups", []):
        active_group_map[sg_item["group"]] = list(sg_item.get("subgroups", []))
    for t in tickets:
        if t["group"]:
            subs = active_group_map.setdefault(t["group"], [])
            if t["subgroup"] and t["subgroup"] not in subs:
                subs.append(t["subgroup"])

    merged_saved_groups = [
        {"group": g, "subgroups": subs} for g, subs in active_group_map.items()
    ]

    return {
        "folder": str(folder),
        "folder_name": folder.name,
        "match_info": {
            "match_name": match_name,
            "match_date": match_date,
            "venue": "TVF Ziraat Bankkart Voleybol Salonu",
        },
        "matches": [
            m for m in state_mgr.storage.get("matches", [])
            if not any(ig in normalize_text(m.get("title", "")) for ig in {"vakifbank", "vakıfbank", "ilbank", "fenerbahce", "fenerbahçe", "besiktas", "beşiktaş"})
        ],
        "total_tickets": len(tickets),
        "assigned_tickets": sum(1 for t in tickets if t["status"] == "assigned"),
        "diger_tickets": sum(1 for t in tickets if t["status"] == "diger"),
        "unassigned_tickets": sum(1 for t in tickets if t["status"] == "unassigned"),
        "arena_zones": ARENA_ZONES,
        "closed_blocks": CLOSED_BLOCKS,
        "blocks": blocks_summary,
        "groups_summary": groups_summary,
        "saved_groups": merged_saved_groups,
        "group_colors": state_mgr.storage.get("group_colors", {}),
        "can_undo": len(state_mgr.undo_stack) > 0,
        "can_redo": len(state_mgr.redo_stack) > 0,
        "history": state_mgr.storage.get("history", []),
    }


def format_seat_ranges(seat_tuples: List[Tuple[str, int, int]]) -> List[Dict[str, Any]]:
    by_block_row: Dict[Tuple[str, int], List[int]] = {}
    for b, r, s in seat_tuples:
        by_block_row.setdefault((b, r), []).append(s)

    ranges_out = []
    for (b, r), seats in sorted(by_block_row.items(), key=lambda x: (x[0][0], x[0][1])):
        seats_sorted = sorted(set(seats))
        if not seats_sorted:
            continue
        start = seats_sorted[0]
        prev = start
        segments = []
        for s in seats_sorted[1:]:
            if s == prev + 1:
                prev = s
            else:
                segments.append((start, prev))
                start = s
                prev = s
        segments.append((start, prev))

        seg_strs = [f"{r}-{st}" if st == en else f"{r}-{st}..{r}-{en}" for st, en in segments]
        ranges_out.append({
            "block": b,
            "row": r,
            "count": len(seats_sorted),
            "text": ", ".join(seg_strs),
            "seats": [f"{r}-{s}" for s in seats_sorted],
        })
    return ranges_out


def build_groups_summary(tickets: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    grouped: Dict[str, Dict[str, List[Tuple[str, int, int]]]] = {}
    for t in tickets:
        g = t["group"] if t["group"] else "__UNASSIGNED__"
        sg = t["subgroup"] if t["subgroup"] else ""
        grouped.setdefault(g, {}).setdefault(sg, []).append((t["block"], t["row"], t["seat"]))

    result = []
    for g, submap in grouped.items():
        is_unassigned = g == "__UNASSIGNED__"
        is_diger = g.lower() in ("diğer", "diger")
        display_name = "Dağıtılmamış (Ana Klasör)" if is_unassigned else g
        color = "#D97706" if is_unassigned else state_mgr.get_group_color(g)

        total_g = 0
        subgroups_list = []
        all_tuples: List[Tuple[str, int, int]] = []

        for sg, stuples in sorted(submap.items(), key=lambda x: x[0]):
            total_g += len(stuples)
            all_tuples.extend(stuples)
            subgroups_list.append({
                "subgroup": sg,
                "display": f"{g}/{sg}" if sg else display_name,
                "count": len(stuples),
                "ranges": format_seat_ranges(stuples),
                "blocks": sorted(list({b for b, _, _ in stuples})),
                "seat_keys": [f"{b}:{r}-{s}" for b, r, s in sorted(stuples)],
            })

        result.append({
            "group": "" if is_unassigned else g,
            "display_name": display_name,
            "is_unassigned": is_unassigned,
            "is_diger": is_diger,
            "color": color,
            "total_count": total_g,
            "blocks": sorted(list({b for b, _, _ in all_tuples})),
            "ranges": format_seat_ranges(all_tuples),
            "subgroups": subgroups_list,
            "seat_keys": [f"{b}:{r}-{s}" for b, r, s in sorted(all_tuples)],
        })

    result.sort(key=lambda x: (x["is_unassigned"], x["is_diger"], -x["total_count"], x["display_name"].lower()))
    return result


def cleanup_empty_dirs(base_folder: Path):
    for root, dirs, files in os.walk(base_folder, topdown=False):
        rel = Path(root).relative_to(base_folder)
        if not rel.parts:
            continue
        if any(p in IGNORED_DIRS or p.startswith(".") for p in rel.parts):
            continue
        try:
            if not os.listdir(root):
                os.rmdir(root)
        except Exception:
            pass


# ---------------------------------------------------------
# FASTAPI UYGULAMASI VE MODELLER
# ---------------------------------------------------------

app = FastAPI(title="Başkent Voleybol Salonu Bilet Dağıtım ve Takip Uygulaması")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def admin_auth_middleware(request: Request, call_next):
    path = request.url.path

    # Public paths (no password needed):
    # - Root index file ("/" and "/index.html"): The page loads, but frontend shows login overlay and cannot fetch /api/state
    # - Static assets & CSS/JS files: /static/*, /assets/*, /favicon.ico
    # - Staff portal: /bilet-istiyorum, /talep
    # - Staff portal APIs: /api/portal/*
    # - Admin auth APIs: /api/auth/login, /api/auth/check
    # - CORS OPTIONS requests
    if (
        path in ("/", "/index.html", "/favicon.ico", "/manifest.json", "/sw.js")
        or path.startswith("/static")
        or path.startswith("/assets")
        or path.startswith("/icons")
        or path.startswith("/bilet-istiyorum")
        or path.startswith("/talep")
        or path.startswith("/api/portal")
        or path.startswith("/api/auth/login")
        or path.startswith("/api/auth/check")
        or request.method == "OPTIONS"
    ):
        return await call_next(request)

    # All other /api/ routes require valid admin session:
    if path.startswith("/api/"):
        token = request.cookies.get("zeren_admin_token")
        if not token:
            auth_header = request.headers.get("Authorization", "")
            if auth_header.startswith("Bearer "):
                token = auth_header.split(" ", 1)[1].strip()
            elif "X-Admin-Token" in request.headers:
                token = request.headers.get("X-Admin-Token", "").strip()

        if not state_mgr.verify_admin_token(token):
            return JSONResponse(
                status_code=401,
                content={"detail": "Yetkisiz erişim. Lütfen yönetici şifresi ile giriş yapınız."},
            )

    return await call_next(request)


class LoginPayload(BaseModel):
    password: str


class ChangePasswordPayload(BaseModel):
    current_password: str
    new_password: str


@app.post("/api/auth/login")
def api_auth_login(payload: LoginPayload, response: Response):
    pwd = payload.password.strip()
    if state_mgr.check_admin_password(pwd):
        token = state_mgr.create_admin_session()
        response.set_cookie(
            key="zeren_admin_token",
            value=token,
            max_age=30 * 24 * 3600,
            httponly=False,
            samesite="lax",
            path="/"
        )
        return {"success": True, "token": token, "message": "Giriş başarılı."}
    else:
        raise HTTPException(status_code=401, detail="Hatalı şifre! Lütfen tekrar deneyiniz.")


@app.get("/api/auth/check")
def api_auth_check(request: Request):
    token = request.cookies.get("zeren_admin_token")
    if not token:
        auth_header = request.headers.get("Authorization", "")
        if auth_header.startswith("Bearer "):
            token = auth_header.split(" ", 1)[1].strip()
        elif "X-Admin-Token" in request.headers:
            token = request.headers.get("X-Admin-Token", "").strip()
    is_auth = state_mgr.verify_admin_token(token)
    return {"authenticated": is_auth}


@app.post("/api/auth/logout")
def api_auth_logout(request: Request, response: Response):
    token = request.cookies.get("zeren_admin_token")
    if not token:
        auth_header = request.headers.get("Authorization", "")
        if auth_header.startswith("Bearer "):
            token = auth_header.split(" ", 1)[1].strip()
        elif "X-Admin-Token" in request.headers:
            token = request.headers.get("X-Admin-Token", "").strip()
    state_mgr.revoke_admin_token(token)
    response.delete_cookie(key="zeren_admin_token", path="/")
    return {"success": True, "message": "Çıkış yapıldı."}


@app.post("/api/auth/change-password")
def api_auth_change_password(payload: ChangePasswordPayload, request: Request):
    token = request.cookies.get("zeren_admin_token")
    if not token:
        auth_header = request.headers.get("Authorization", "")
        if auth_header.startswith("Bearer "):
            token = auth_header.split(" ", 1)[1].strip()
        elif "X-Admin-Token" in request.headers:
            token = request.headers.get("X-Admin-Token", "").strip()
    if not state_mgr.verify_admin_token(token):
        raise HTTPException(status_code=401, detail="Yetkisiz erişim.")
    if not state_mgr.check_admin_password(payload.current_password.strip()):
        raise HTTPException(status_code=400, detail="Mevcut şifreniz hatalı.")
    new_p = payload.new_password.strip()
    if len(new_p) < 4:
        raise HTTPException(status_code=400, detail="Yeni şifre en az 4 karakter olmalıdır.")
    state_mgr.set_admin_password(new_p)
    return {"success": True, "message": "Şifre başarıyla güncellendi."}


class SeatRef(BaseModel):
    block: str
    row: int
    seat: int


class AssignRequest(BaseModel):
    seats: List[SeatRef]
    group: str = ""
    subgroup: str = ""


class ShiftRequest(BaseModel):
    source_seats: List[SeatRef]
    target_seats: List[SeatRef]


class FolderSelectRequest(BaseModel):
    folder_path: str


class CreateMatchRequest(BaseModel):
    match_name: str
    match_date: str = ""
    source_folder: str = ""


class GroupTemplateRequest(BaseModel):
    group: str
    subgroup: str = ""
    color: Optional[str] = None


class OpenExplorerRequest(BaseModel):
    group: str = ""
    subgroup: str = ""


class ExcelAssignPayload(BaseModel):
    request_id: str = ""
    block_id: str
    count: int = 1
    group: str
    subgroup: str = ""
    seat_ids: List[str] = []
    match_name: str = ""


class DispatchMarkSentPayload(BaseModel):
    request_id: Optional[str] = ""
    person: Optional[str] = ""
    group: Optional[str] = ""
    sent: bool = True


class DispatchSavePhonePayload(BaseModel):
    request_id: Optional[str] = ""
    person: str
    phone: str


def get_current_excel_match_name(folder: Path, match_meta: Optional[Dict[str, Any]] = None) -> str:
    folder_str = str(folder).lower()
    title = ""
    if match_meta:
        title = (match_meta.get("match_name") or "").lower()
    if not title:
        title = folder.name.lower()

    if "kuzeyboru" in folder_str or "kuzeyboru" in title:
        return "Kuzeyboru"
    if "fener" in folder_str or "fener" in title or "121 blok" in folder_str:
        return "Fenerbahçe"
    if "besiktas" in folder_str or "beşiktaş" in folder_str or "besiktas" in title or "beşiktaş" in title:
        return "Beşiktaş"
    if "ilbank" in folder_str or "ilbank" in title or "il bank" in title:
        return "İlbank"

    try:
        res = parse_bilet_takip_excel()
        for m in res.get("matches", []):
            mname = m["match_name"]
            if normalize_text(mname) in normalize_text(title) or normalize_text(mname) in normalize_text(folder_str):
                return mname
    except Exception:
        pass
    return "Fenerbahçe"


def auto_pick_seats_in_block(block_id: str, count: int, current_tickets: Dict[str, Any]) -> List[SeatRef]:
    layout = get_block_layout(block_id)
    if count <= 0:
        return []

    # 1. Aşama: Mümkünse aynı sırada YAN YANA (ardışık) boş koltuk bul
    if count > 1:
        for row_obj in sorted(layout["rows"], key=lambda r: r["row"]):
            r_num = row_obj["row"]
            cells = [s for s in row_obj["cells"] if s is not None]
            cells.sort()
            consecutive: List[SeatRef] = []
            for s_num in cells:
                seat_id = f"{r_num}-{s_num}"
                t = current_tickets.get(seat_id)
                is_free = not t or t.get("status") in ("unassigned", "diger")
                if is_free:
                    if consecutive and consecutive[-1].seat != s_num - 1:
                        consecutive = []
                    consecutive.append(SeatRef(block=block_id, row=r_num, seat=s_num))
                    if len(consecutive) == count:
                        return consecutive
                else:
                    consecutive = []

    # 2. Aşama: Ardışık bulunamazsa aynı bloktaki boş koltukları topla
    picked: List[SeatRef] = []
    for row_obj in sorted(layout["rows"], key=lambda r: r["row"]):
        r_num = row_obj["row"]
        cells = [s for s in row_obj["cells"] if s is not None]
        cells.sort()
        for s_num in cells:
            seat_id = f"{r_num}-{s_num}"
            t = current_tickets.get(seat_id)
            if not t or t.get("status") in ("unassigned", "diger"):
                picked.append(SeatRef(block=block_id, row=r_num, seat=s_num))
                if len(picked) >= count:
                    return picked
    return picked


@app.get("/api/state")
def api_get_state():
    return scan_match_folder(state_mgr.active_folder)


@app.post("/api/select-folder")
def api_select_folder(req: FolderSelectRequest):
    p = Path(req.folder_path.strip().strip('"'))
    if not p.exists() or not p.is_dir():
        raise HTTPException(status_code=400, detail=f"Geçersiz klasör yolu: {p}")
    state_mgr.active_folder = p
    state_mgr.undo_stack.clear()
    state_mgr.redo_stack.clear()
    state_mgr.storage["last_folder"] = str(p)
    state_mgr._ensure_match_registered(p)
    state_mgr._save_storage()
    return scan_match_folder(state_mgr.active_folder)


@app.post("/api/matches/create")
def api_create_match(req: CreateMatchRequest):
    """
    Yeni bir maç çalışma alanı oluşturur (veya mevcut bir klasörü yeni maç olarak bağlar).
    """
    title = req.match_name.strip()
    if not title:
        raise HTTPException(status_code=400, detail="Maç adı boş olamaz.")

    if req.source_folder.strip():
        target_dir = Path(req.source_folder.strip().strip('"'))
        if not target_dir.exists() or not target_dir.is_dir():
            raise HTTPException(status_code=400, detail=f"Seçilen klasör bulunamadı: {target_dir}")
    else:
        safe_folder_name = re.sub(r'[\\/:*?"<>|]+', "_", title).strip()
        if req.match_date.strip():
            safe_date = re.sub(r'[\\/:*?"<>|]+', "-", req.match_date.strip())
            safe_folder_name = f"{safe_folder_name}_{safe_date}"
        target_dir = MATCHES_ROOT_DIR / safe_folder_name
        target_dir.mkdir(parents=True, exist_ok=True)

    plan_data = load_match_plan(target_dir)
    plan_data["match_name"] = title
    if req.match_date.strip():
        plan_data["match_date"] = req.match_date.strip()
    save_match_plan(target_dir, plan_data)

    state_mgr.active_folder = target_dir
    state_mgr.undo_stack.clear()
    state_mgr.redo_stack.clear()
    state_mgr.storage["last_folder"] = str(target_dir)
    state_mgr._ensure_match_registered(target_dir, title, req.match_date.strip())
    state_mgr._save_storage()
    return scan_match_folder(target_dir)


@app.post("/api/matches/upload-zip")
async def api_upload_match_zip(
    match_name: str = Form(""),
    match_date: str = Form(""),
    file: UploadFile = File(...),
):
    """
    WeTransfer veya Biletinial'dan indirilen ZIP dosyasını yeni bir maç klasörüne çıkartır ve açar.
    """
    raw_bytes = await file.read()
    base_title = match_name.strip() or Path(file.filename or "Yeni_Mac").stem
    safe_folder_name = re.sub(r'[\\/:*?"<>|]+', "_", base_title).strip()
    target_dir = MATCHES_ROOT_DIR / f"{safe_folder_name}_{datetime.now().strftime('%Y%m%d_%H%M')}"
    target_dir.mkdir(parents=True, exist_ok=True)

    try:
        with zipfile.ZipFile(io.BytesIO(raw_bytes), "r") as zf:
            zf.extractall(target_dir)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"ZIP dosyası açılamadı: {e}")

    if match_name.strip() or match_date.strip():
        plan_data = load_match_plan(target_dir)
        if match_name.strip():
            plan_data["match_name"] = match_name.strip()
        if match_date.strip():
            plan_data["match_date"] = match_date.strip()
        save_match_plan(target_dir, plan_data)

    state_mgr.active_folder = target_dir
    state_mgr.undo_stack.clear()
    state_mgr.redo_stack.clear()
    state_mgr.storage["last_folder"] = str(target_dir)
    state_mgr._ensure_match_registered(target_dir, match_name.strip(), match_date.strip())
    state_mgr._save_storage()
    return scan_match_folder(target_dir)


@app.post("/api/browse-folder")
def api_browse_folder():
    try:
        import tkinter as tk
        from tkinter import filedialog
        root = tk.Tk()
        root.withdraw()
        root.attributes("-topmost", True)
        selected = filedialog.askdirectory(
            initialdir=str(state_mgr.active_folder.parent),
            title="Maç Bilet PDF Klasörünü Seçin",
        )
        root.destroy()
        if selected:
            p = Path(selected)
            if p.exists() and p.is_dir():
                state_mgr.active_folder = p
                state_mgr.undo_stack.clear()
                state_mgr.redo_stack.clear()
                state_mgr.storage["last_folder"] = str(p)
                state_mgr._ensure_match_registered(p)
                state_mgr._save_storage()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Klasör seçici açılamadı: {e}")
    return scan_match_folder(state_mgr.active_folder)


@app.post("/api/matches/upload-tickets")
async def api_upload_tickets(files: List[UploadFile] = File(...)):
    """
    Biletinial'dan indirilen PDF biletleri veya ZIP arşivini DOĞRUDAN aktif maç klasörüne çıkartır/kaydeder.
    """
    target_dir = state_mgr.active_folder
    target_dir.mkdir(parents=True, exist_ok=True)

    added_files = 0
    extracted_names = []
    for f in files:
        fname = f.filename or ""
        raw = await f.read()
        if fname.lower().endswith(".zip"):
            try:
                with zipfile.ZipFile(io.BytesIO(raw), "r") as zf:
                    for member in zf.namelist():
                        if member.lower().endswith(".pdf"):
                            base_f = Path(member).name
                            if not base_f.startswith(".") and not base_f.startswith("__MACOSX"):
                                out_p = target_dir / base_f
                                with zf.open(member) as source_f, open(out_p, "wb") as dest_f:
                                    shutil.copyfileobj(source_f, dest_f)
                                added_files += 1
                                extracted_names.append(base_f)
            except Exception as e:
                raise HTTPException(status_code=400, detail=f"ZIP dosyası açılamadı: {e}")
        elif fname.lower().endswith(".pdf"):
            base_f = Path(fname).name
            if not base_f.startswith("."):
                out_p = target_dir / base_f
                with open(out_p, "wb") as dest_f:
                    dest_f.write(raw)
                added_files += 1
                extracted_names.append(base_f)

    state = scan_match_folder(target_dir)
    return {
        "success": True,
        "added_files": added_files,
        "active_match": state.get("match_name") or target_dir.name,
        "total_tickets": state.get("stats", {}).get("total_tickets", 0),
        "blocks": list(state.get("blocks", {}).keys()),
        "state": state,
    }


@app.post("/api/matches/auto-assign-all")
def api_auto_assign_all():
    """
    Kuzeyboru / aktif maç için bekleyen tüm bilet taleplerini,
    mevcut boş koltuklarla (mümkünse yan yana) otomatik eşleştirir.
    """
    meta = state_mgr._detect_folder_match_meta(state_mgr.active_folder)
    mname = meta.get("match_name", "")
    portal_reqs = get_requests_for_match(mname)
    pending_reqs = [
        r for r in portal_reqs
        if len(r.get("assigned_seats", [])) < r.get("requested_count", 1)
    ]

    if not pending_reqs:
        return {
            "success": True,
            "message": "Atama bekleyen talep bulunmamaktadır.",
            "assigned_count": 0,
            "results": [],
        }

    state = scan_match_folder(state_mgr.active_folder)
    assigned_results = []

    for req in pending_reqs:
        target_b = req.get("target_block", "121").strip()
        if not target_b or target_b.lower() in ("saha içi", "saha ici"):
            target_b = "121"

        b_tickets = state["blocks"].get(target_b, {}).get("tickets", {})
        needed = req.get("requested_count", 1) - len(req.get("assigned_seats", []))
        seats_to_assign = auto_pick_seats_in_block(target_b, needed, b_tickets)

        # Hedef blokta yer kalmadıysa açık olan diğer bloklara bak
        if not seats_to_assign:
            for alt_b in state["blocks"].keys():
                if alt_b != target_b:
                    alt_tickets = state["blocks"].get(alt_b, {}).get("tickets", {})
                    candidate = auto_pick_seats_in_block(alt_b, needed, alt_tickets)
                    if candidate:
                        target_b = alt_b
                        seats_to_assign = candidate
                        break

        if seats_to_assign:
            assign_req = AssignRequest(
                seats=seats_to_assign,
                group=req.get("person", "").strip(),
                subgroup=req.get("department", "").strip(),
            )
            api_assign_seats(assign_req)
            all_sids = req.get("assigned_seats", []) + [f"{s.row}-{s.seat}" for s in seats_to_assign]
            update_request_fulfillment(
                request_id=req["id"],
                status="assigned",
                assigned_block=target_b,
                assigned_seats=all_sids,
                group=req.get("person", ""),
                subgroup=req.get("department", ""),
            )
            assigned_results.append({
                "request_id": req["id"],
                "person": req.get("person"),
                "block": target_b,
                "seats": [f"{s.row}-{s.seat}" for s in seats_to_assign],
                "count": len(seats_to_assign),
            })
            state = scan_match_folder(state_mgr.active_folder)

    return {
        "success": True,
        "message": f"{len(assigned_results)} personelin talebi koltuklarla başarıyla eşleştirildi.",
        "assigned_count": len(assigned_results),
        "results": assigned_results,
    }


def format_seats_label(block: str, seats: List[str]) -> str:
    """Koltuk listesini '121 Blok, Sıra 4 (Koltuk: 1, 2)' şeklinde okunur biçimlendirir."""
    if not seats:
        return f"{block} Blok"
    rows_map: Dict[int, List[int]] = {}
    for s in seats:
        try:
            r_str, s_str = s.split("-")
            rows_map.setdefault(int(r_str), []).append(int(s_str))
        except Exception:
            continue
    parts = []
    for r_num in sorted(rows_map.keys()):
        s_nums = sorted(rows_map[r_num])
        s_str = ", ".join(str(n) for n in s_nums)
        parts.append(f"Sıra {r_num}: {s_str}")
    if parts:
        return f"{block} Blok ({' · '.join(parts)})"
    return f"{block} Blok ({', '.join(seats)})"


def build_whatsapp_message(person: str, match_title: str, match_date: str, block: str, seats: List[str]) -> str:
    seats_str = format_seats_label(block, seats)
    date_line = f"📅 *Tarih:* {match_date}\n" if match_date else ""
    return (
        f"🏐 *ZEREN SPOR KULÜBÜ — MAÇ BİLETİNİZ*\n\n"
        f"Sayın *{person}*,\n"
        f"*{match_title}* karşılaşması biletleriniz tanımlanmıştır.\n\n"
        f"📍 *Salon:* TVF Ziraat Bankkart Voleybol Salonu (Başkent)\n"
        f"{date_line}"
        f"🎟️ *Bilet Adedi:* {len(seats)} Adet\n"
        f"💺 *Koltuk Bilgileri:* {seats_str}\n\n"
        f"📎 Biletiniz ekte PDF formatındadır. Turnikede barkodunuzu okutarak salona giriş yapabilirsiniz.\n\n"
        f"İyi seyirler dileriz! 💜🤍"
    )


@app.get("/api/dispatch/list")
def api_dispatch_list():
    meta = state_mgr._detect_folder_match_meta(state_mgr.active_folder)
    mname = meta.get("match_name", "") or state_mgr.active_folder.name
    mdate = meta.get("match_date", "") or "08.11.2026 16:00"
    plan_data = load_match_plan(state_mgr.active_folder)
    sent_groups = plan_data.get("whatsapp_sent_groups", {})
    state = scan_match_folder(state_mgr.active_folder)
    pmap = _find_ticket_path_map(state_mgr.active_folder)

    recipients = []
    seen_persons = set()

    # 1. Portal Taleplerinden atananlar
    portal_reqs = get_requests_for_match(mname)
    for pr in portal_reqs:
        seats = pr.get("assigned_seats", [])
        if not seats:
            continue
        person = pr.get("person", "").strip()
        seen_persons.add(person.lower())
        block = pr.get("assigned_block", "121")
        phone = pr.get("phone", "").strip() or get_person_phone(person)
        clean_phone = format_whatsapp_phone(phone)
        pdf_c = sum(1 for s in seats if f"{block}:{s}" in pmap)
        has_pdf = pdf_c >= len(seats) and len(seats) > 0

        wa_web = f"https://web.whatsapp.com/send?phone={clean_phone}" if clean_phone else "https://web.whatsapp.com"
        wa_me = f"https://wa.me/{clean_phone}" if clean_phone else "https://wa.me"

        ind_tickets = []
        for sid in seats:
            key = f"{block}:{sid}"
            p = pmap.get(key)
            has_p = p is not None and p.exists()
            try:
                r_num, s_num = sid.split("-")
                lbl = f"Sıra {r_num}, Koltuk {s_num}"
                fname = f"ZEREN_SPOR_{block}Blok_Sira{r_num}_Koltuk{s_num}.pdf"
            except Exception:
                lbl = f"Koltuk {sid}"
                fname = f"ZEREN_SPOR_{block}Blok_{sid}.pdf"
            ind_tickets.append({
                "block": block,
                "seat_id": sid,
                "label": lbl,
                "filename": fname,
                "download_url": f"/api/tickets/download-single?block={block}&seat={sid}",
                "has_pdf": has_p,
            })

        recipients.append({
            "id": pr["id"],
            "source": "portal",
            "person": person,
            "department": pr.get("department", ""),
            "phone": phone,
            "clean_phone": clean_phone,
            "block": block,
            "seats": seats,
            "seats_formatted": format_seats_label(block, seats),
            "ticket_count": len(seats),
            "pdf_count": pdf_c,
            "has_pdf": has_pdf,
            "whatsapp_sent": bool(pr.get("whatsapp_sent", False)),
            "whatsapp_sent_at": pr.get("whatsapp_sent_at"),
            "download_url": f"/api/portal/download-tickets/{pr['id']}",
            "individual_tickets": ind_tickets,
            "whatsapp_url": wa_web,
            "wa_me_url": wa_me,
            "message_text": "",
        })

    # 2. Doğrudan Koltuk Planına atanan gruplar (Portalda olmayanlar)
    group_buckets: Dict[str, List[Dict[str, Any]]] = {}
    for b_id, b_info in state["blocks"].items():
        for t in b_info["tickets"].values():
            g = t.get("group", "").strip()
            if g and g.lower() not in ("diğer", "diger", "rakip kulüp", "fenerbahçe"):
                group_buckets.setdefault(g, []).append(t)

    for g_name, t_list in group_buckets.items():
        if g_name.lower() in seen_persons:
            continue
        seen_persons.add(g_name.lower())
        b_id = t_list[0]["block"]
        seats = [f"{t['row']}-{t['seat']}" for t in t_list]
        phone = get_person_phone(g_name)
        clean_phone = format_whatsapp_phone(phone)
        pdf_c = sum(1 for t in t_list if t.get("has_pdf", True))
        has_pdf = pdf_c >= len(t_list)
        wa_web = f"https://web.whatsapp.com/send?phone={clean_phone}" if clean_phone else "https://web.whatsapp.com"
        wa_me = f"https://wa.me/{clean_phone}" if clean_phone else "https://wa.me"
        sent_info = sent_groups.get(g_name, {})

        ind_tickets = []
        for sid in seats:
            key = f"{b_id}:{sid}"
            p = pmap.get(key)
            has_p = p is not None and p.exists()
            try:
                r_num, s_num = sid.split("-")
                lbl = f"Sıra {r_num}, Koltuk {s_num}"
                fname = f"ZEREN_SPOR_{b_id}Blok_Sira{r_num}_Koltuk{s_num}.pdf"
            except Exception:
                lbl = f"Koltuk {sid}"
                fname = f"ZEREN_SPOR_{b_id}Blok_{sid}.pdf"
            ind_tickets.append({
                "block": b_id,
                "seat_id": sid,
                "label": lbl,
                "filename": fname,
                "download_url": f"/api/tickets/download-single?block={b_id}&seat={sid}",
                "has_pdf": has_p,
            })

        recipients.append({
            "id": f"group_{re.sub(r'[^a-zA-Z0-9]', '_', g_name)}",
            "source": "map_group",
            "person": g_name,
            "department": t_list[0].get("subgroup", ""),
            "phone": phone,
            "clean_phone": clean_phone,
            "block": b_id,
            "seats": seats,
            "seats_formatted": format_seats_label(b_id, seats),
            "ticket_count": len(t_list),
            "pdf_count": pdf_c,
            "has_pdf": has_pdf,
            "whatsapp_sent": bool(sent_info.get("sent", False)),
            "whatsapp_sent_at": sent_info.get("at"),
            "download_url": f"/api/export-merged-pdf?group={quote(g_name)}",
            "individual_tickets": ind_tickets,
            "whatsapp_url": wa_web,
            "wa_me_url": wa_me,
            "message_text": "",
        })

    recipients.sort(key=lambda x: (x["whatsapp_sent"], x["person"].lower()))

    total_r = len(recipients)
    total_tickets = sum(r["ticket_count"] for r in recipients)
    sent_c = sum(1 for r in recipients if r["whatsapp_sent"])
    pending_c = total_r - sent_c

    return {
        "ok": True,
        "match_name": mname,
        "match_date": mdate,
        "total_recipients": total_r,
        "total_tickets": total_tickets,
        "sent_count": sent_c,
        "pending_count": pending_c,
        "progress_pct": int((sent_c / total_r * 100)) if total_r > 0 else 0,
        "recipients": recipients,
    }


@app.post("/api/dispatch/mark-sent")
def api_dispatch_mark_sent(payload: DispatchMarkSentPayload):
    req_id = payload.request_id.strip()
    person = payload.person.strip()
    is_sent = payload.sent

    if req_id and req_id.startswith("ZEREN-"):
        set_request_whatsapp_sent(req_id, is_sent)
        return {"success": True, "request_id": req_id, "sent": is_sent}

    plan_data = load_match_plan(state_mgr.active_folder)
    sent_groups = plan_data.setdefault("whatsapp_sent_groups", {})
    key = person or payload.group
    if key:
        sent_groups[key] = {
            "sent": is_sent,
            "at": datetime.now().isoformat() if is_sent else None,
        }
        save_match_plan(state_mgr.active_folder, plan_data)
        return {"success": True, "person": key, "sent": is_sent}

    return {"success": False, "message": "Kişi veya talep ID bulunamadı."}


@app.post("/api/dispatch/save-phone")
def api_dispatch_save_phone(payload: DispatchSavePhonePayload):
    req_id = payload.request_id.strip()
    person = payload.person.strip()
    phone = payload.phone.strip()

    if person and phone:
        save_person_phone(person, phone)

    if req_id and req_id.startswith("ZEREN-"):
        update_request_phone(req_id, phone)

    clean_p = format_whatsapp_phone(phone)
    return {
        "success": True,
        "person": person,
        "phone": phone,
        "clean_phone": clean_p,
    }


@app.get("/api/tickets/download-single")
def api_download_single_ticket(block: str = Query(...), seat: str = Query(...)):
    """
    Belirli bir koltuğun tekil orijinal PDF biletini indirir.
    Örn: block=121&seat=3-1 -> ZEREN_SPOR_121Blok_Sira3_Koltuk1.pdf
    """
    pmap = _find_ticket_path_map(state_mgr.active_folder)
    key = f"{block}:{seat}"
    pdf_path = pmap.get(key)
    if not pdf_path or not pdf_path.exists():
        raise HTTPException(status_code=404, detail=f"{block} Blok {seat} koltuğu için fiziksel PDF bilet bulunamadı.")

    try:
        r_str, s_str = seat.split("-")
        clean_name = f"ZEREN_SPOR_{block}Blok_Sira{r_str}_Koltuk{s_str}.pdf"
    except Exception:
        clean_name = f"ZEREN_SPOR_{block}Blok_{seat}.pdf"

    encoded_name = quote(clean_name)
    return FileResponse(
        str(pdf_path),
        media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{encoded_name}"},
    )


@app.get("/api/dispatch/export-all-zip")
def api_dispatch_export_all_zip():
    d_info = api_dispatch_list()
    recipients = d_info.get("recipients", [])
    if not recipients:
        raise HTTPException(status_code=404, detail="Dağıtılacak bilet veya kişi bulunamadı.")

    pmap = _find_ticket_path_map(state_mgr.active_folder)
    buf = io.BytesIO()

    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for r in recipients:
            clean_name = re.sub(r'[\\/:*?"<>|]+', "_", r["person"]).strip()
            block = r["block"]
            for sid in r["seats"]:
                key = f"{block}:{sid}"
                pdf_p = pmap.get(key)
                if pdf_p and pdf_p.exists():
                    try:
                        r_str, s_str = sid.split("-")
                        t_name = f"ZEREN_SPOR_{block}Blok_Sira{r_str}_Koltuk{s_str}.pdf"
                    except Exception:
                        t_name = f"ZEREN_SPOR_{block}Blok_{sid}.pdf"
                    # Her personelin biletlerini kendi klasörüne TEK TEK ekle (başkalarına iletebilmeleri için)
                    zf.write(str(pdf_p), arcname=f"{clean_name}/{t_name}")

    buf.seek(0)
    out_filename = f"ZEREN_SPOR_KUZEYBORU_Tekil_Biletler_{len(recipients)}Kisi.zip"
    encoded_name = quote(out_filename)
    return StreamingResponse(
        buf,
        media_type="application/zip",
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{encoded_name}"},
    )



def _find_ticket_path_map(folder: Path) -> Dict[str, Path]:
    mapping: Dict[str, Path] = {}
    for root, dirs, files in os.walk(folder):
        dirs[:] = [d for d in dirs if d not in IGNORED_DIRS and not d.startswith(".")]
        for fname in files:
            m = TICKET_REGEX.match(fname)
            if m:
                key = f"{m.group(1)}:{int(m.group(2))}-{int(m.group(3))}"
                mapping[key] = Path(root) / fname
    return mapping


@app.post("/api/assign")
def api_assign_seats(req: AssignRequest):
    """
    Seçili koltukları hedef kişi/alt gruba atar:
    - Koltuğun PDF'i klasörde varsa fiziksel olarak ilgili klasöre taşır.
    - Koltuğun PDF'i henüz klasörde yoksa sanal planlamaya (mac_bilet_plani.json) kaydeder.
    """
    folder = state_mgr.active_folder
    group_clean = req.group.strip().strip("/\\")
    subgroup_clean = req.subgroup.strip().strip("/\\")

    target_dir = folder
    if group_clean:
        target_dir = target_dir / group_clean
        if subgroup_clean:
            target_dir = target_dir / subgroup_clean
        target_dir.mkdir(parents=True, exist_ok=True)
        state_mgr.ensure_group_in_templates(group_clean, subgroup_clean)

    path_map = _find_ticket_path_map(folder)
    plan_data = load_match_plan(folder)
    virtual_map = plan_data.setdefault("virtual_assignments", {})

    moves_recorded: List[Tuple[str, str]] = []
    virtual_changes: List[Tuple[str, Optional[Dict[str, str]], Optional[Dict[str, str]]]] = []

    for sref in req.seats:
        key = f"{sref.block}:{sref.row}-{sref.seat}"
        src_path = path_map.get(key)
        if src_path and src_path.exists():
            dst_path = target_dir / src_path.name
            if src_path.resolve() != dst_path.resolve():
                shutil.move(str(src_path), str(dst_path))
                moves_recorded.append((str(src_path), str(dst_path)))
        else:
            old_val = virtual_map.get(key)
            new_val = {"group": group_clean, "subgroup": subgroup_clean} if group_clean else None
            if old_val != new_val:
                virtual_changes.append((key, old_val, new_val))
                if new_val:
                    virtual_map[key] = new_val
                else:
                    virtual_map.pop(key, None)

    if virtual_changes:
        save_match_plan(folder, plan_data)

    if moves_recorded or virtual_changes:
        state_mgr.undo_stack.append({"moves": moves_recorded, "virtual": virtual_changes})
        state_mgr.redo_stack.clear()
        cleanup_empty_dirs(folder)

    return scan_match_folder(folder)


@app.get("/api/excel/summary")
def api_excel_summary(match_name: Optional[str] = None):
    res = parse_bilet_takip_excel()
    if not res.get("ok"):
        return res

    active_mname = match_name or get_current_excel_match_name(state_mgr.active_folder)
    reqs: List[Dict[str, Any]] = []
    for m in res.get("matches", []):
        if (
            m["match_name"].lower() == active_mname.lower()
            or normalize_text(m["match_name"]) == normalize_text(active_mname)
        ):
            reqs = m["requests"]
            active_mname = m["match_name"]
            break

    state = scan_match_folder(state_mgr.active_folder)
    all_tickets = []
    for b in state["blocks"].values():
        all_tickets.extend(b["tickets"].values())

    evaluated = match_requests_with_tickets(reqs, all_tickets)

    # Portal taleplerini (Bilet İstiyorum) de entegre et
    portal_reqs = get_requests_for_match(active_mname)
    portal_evaluated = []
    for pr in portal_reqs:
        asg_seats = pr.get("assigned_seats", [])
        req_c = pr.get("requested_count", 1)
        asg_c = len(asg_seats)
        is_comp = asg_c >= req_c and req_c > 0
        is_part = asg_c > 0 and not is_comp
        pr_person = pr.get("person", "")
        pr_phone = pr.get("phone", "").strip() or get_person_phone(pr_person)
        portal_evaluated.append({
            "request_id": pr["id"],
            "source": "portal",
            "row_index": 0,
            "date_serial": pr.get("created_at", ""),
            "match": pr.get("match_name", ""),
            "person": pr_person,
            "department": pr.get("department", ""),
            "phone": pr_phone,
            "ticket_type": pr.get("ticket_type", "Davetiye / Protokol"),
            "requested_count": req_c,
            "description": f"🌐 Bilet İstiyorum ({pr.get('department', '')}): {pr.get('description', '')}".strip(": "),
            "status": pr.get("status", "pending"),
            "target_block": pr.get("target_block", "121"),
            "suggested_group": pr_person,
            "suggested_subgroup": pr.get("department", ""),
            "aliases": [pr_person.lower()],
            "matched_keys": [f"{pr.get('assigned_block', '121')}:{s}" for s in asg_seats],
            "matched_seats": asg_seats,
            "assigned_count": asg_c,
            "fulfillment_status": "completed" if is_comp else ("partial" if is_part else "pending"),
            "status_badge": "Portal: Koltuklar Ayrıldı ✅" if is_comp else ("Portal: Kısmi ⚠️" if is_part else "Bilet İstiyorum Talebi ⏳"),
            "status_color": "#059669" if is_comp else ("#D97706" if is_part else "#2563EB"),
            "progress_pct": int((asg_c / req_c) * 100) if req_c > 0 else 0,
        })

    for r in evaluated:
        if not r.get("phone"):
            r["phone"] = get_person_phone(r.get("person", ""))

    all_evaluated = portal_evaluated + evaluated
    total_requested = sum(r["requested_count"] for r in all_evaluated)
    total_assigned = sum(r["assigned_count"] for r in all_evaluated)
    completed_count = sum(1 for r in all_evaluated if r["fulfillment_status"] == "completed")
    partial_count = sum(1 for r in all_evaluated if r["fulfillment_status"] == "partial")
    pending_count = sum(1 for r in all_evaluated if r["fulfillment_status"] == "pending")

    return {
        "ok": True,
        "excel_path": str(EXCEL_DEFAULT_PATH),
        "excel_exists": EXCEL_DEFAULT_PATH.exists(),
        "active_match_name": active_mname,
        "available_matches": [m["match_name"] for m in res.get("matches", [])],
        "requests": all_evaluated,
        "total_requested": total_requested,
        "total_assigned": total_assigned,
        "total_pending": max(0, total_requested - total_assigned),
        "completed_count": completed_count,
        "partial_count": partial_count,
        "pending_count": pending_count,
        "portal_requests_count": len(portal_evaluated),
        "fulfillment_pct": int((total_assigned / total_requested * 100)) if total_requested > 0 else 0,
    }


@app.post("/api/excel/assign-request")
def api_excel_assign(payload: ExcelAssignPayload):
    folder = state_mgr.active_folder
    state = scan_match_folder(folder)
    target_block = payload.block_id.strip()

    # Eğer Saha İçi ise sanal olarak 121 veya özel bloğa yerleştir
    if target_block.lower() in ("saha içi", "saha ici"):
        target_block = "121"

    b_tickets = state["blocks"].get(target_block, {}).get("tickets", {})

    seats_to_assign: List[SeatRef] = []
    if payload.seat_ids:
        for sid in payload.seat_ids:
            try:
                r_str, s_str = sid.split("-")
                seats_to_assign.append(SeatRef(block=target_block, row=int(r_str), seat=int(s_str)))
            except Exception:
                continue
    else:
        seats_to_assign = auto_pick_seats_in_block(target_block, payload.count, b_tickets)

    if not seats_to_assign:
        raise HTTPException(
            status_code=400,
            detail=f"{target_block} bloğunda atanabilecek yeterli boş koltuk bulunamadı.",
        )

    assign_req = AssignRequest(
        seats=seats_to_assign,
        group=payload.group,
        subgroup=payload.subgroup,
    )
    res = api_assign_seats(assign_req)

    # Eğer Bilet İstiyorum talep kodu ise portal kaydını da güncelle
    if payload.request_id and payload.request_id.startswith("ZEREN-"):
        update_request_fulfillment(
            request_id=payload.request_id,
            status="assigned",
            assigned_block=target_block,
            assigned_seats=[f"{s.row}-{s.seat}" for s in seats_to_assign],
            group=payload.group,
            subgroup=payload.subgroup,
        )

    return res


@app.post("/api/excel/reload")
def api_excel_reload():
    state_mgr.sync_excel_matches()
    return api_excel_summary()


@app.post("/api/shift")
def api_shift_seats(req: ShiftRequest):
    if len(req.source_seats) != len(req.target_seats):
        raise HTTPException(
            status_code=400,
            detail=f"Kaynak koltuk sayısı ({len(req.source_seats)}) ile hedef koltuk sayısı ({len(req.target_seats)}) eşit olmalıdır.",
        )

    folder = state_mgr.active_folder
    path_map = _find_ticket_path_map(folder)
    moves_recorded: List[Tuple[str, str]] = []

    plan = []
    for src_ref, dst_ref in zip(req.source_seats, req.target_seats):
        src_key = f"{src_ref.block}:{src_ref.row}-{src_ref.seat}"
        dst_key = f"{dst_ref.block}:{dst_ref.row}-{dst_ref.seat}"
        if src_key == dst_key:
            continue
        src_path = path_map.get(src_key)
        dst_path = path_map.get(dst_key)
        if src_path and dst_path:
            plan.append((src_path, dst_path))

    for src_path, dst_path in plan:
        src_dir = src_path.parent
        dst_dir = dst_path.parent
        if src_dir.resolve() == dst_dir.resolve():
            continue
        new_src_path = dst_dir / src_path.name
        new_dst_path = src_dir / dst_path.name

        shutil.move(str(src_path), str(new_src_path))
        moves_recorded.append((str(src_path), str(new_src_path)))

        shutil.move(str(dst_path), str(new_dst_path))
        moves_recorded.append((str(dst_path), str(new_dst_path)))

    if moves_recorded:
        state_mgr.undo_stack.append({"moves": moves_recorded, "virtual": []})
        state_mgr.redo_stack.clear()
        cleanup_empty_dirs(folder)

    return scan_match_folder(folder)


@app.post("/api/undo")
def api_undo():
    if not state_mgr.undo_stack:
        return scan_match_folder(state_mgr.active_folder)

    action = state_mgr.undo_stack.pop()
    last_moves = action.get("moves", [])
    v_changes = action.get("virtual", [])
    redo_moves: List[Tuple[str, str]] = []

    for orig_src, orig_dst in reversed(last_moves):
        src_p = Path(orig_src)
        dst_p = Path(orig_dst)
        if dst_p.exists():
            src_p.parent.mkdir(parents=True, exist_ok=True)
            shutil.move(str(dst_p), str(src_p))
            redo_moves.append((orig_src, orig_dst))

    if v_changes:
        plan_data = load_match_plan(state_mgr.active_folder)
        vmap = plan_data.setdefault("virtual_assignments", {})
        for key, old_val, _ in reversed(v_changes):
            if old_val:
                vmap[key] = old_val
            else:
                vmap.pop(key, None)
        save_match_plan(state_mgr.active_folder, plan_data)

    state_mgr.redo_stack.append({"moves": list(reversed(redo_moves)), "virtual": v_changes})
    cleanup_empty_dirs(state_mgr.active_folder)
    return scan_match_folder(state_mgr.active_folder)


@app.post("/api/redo")
def api_redo():
    if not state_mgr.redo_stack:
        return scan_match_folder(state_mgr.active_folder)

    action = state_mgr.redo_stack.pop()
    moves = action.get("moves", [])
    v_changes = action.get("virtual", [])
    undo_moves: List[Tuple[str, str]] = []

    for orig_src, orig_dst in moves:
        src_p = Path(orig_src)
        dst_p = Path(orig_dst)
        if src_p.exists():
            dst_p.parent.mkdir(parents=True, exist_ok=True)
            shutil.move(str(src_p), str(dst_p))
            undo_moves.append((orig_src, orig_dst))

    if v_changes:
        plan_data = load_match_plan(state_mgr.active_folder)
        vmap = plan_data.setdefault("virtual_assignments", {})
        for key, _, new_val in v_changes:
            if new_val:
                vmap[key] = new_val
            else:
                vmap.pop(key, None)
        save_match_plan(state_mgr.active_folder, plan_data)

    state_mgr.undo_stack.append({"moves": undo_moves, "virtual": v_changes})
    cleanup_empty_dirs(state_mgr.active_folder)
    return scan_match_folder(state_mgr.active_folder)


@app.post("/api/groups")
def api_save_group_template(req: GroupTemplateRequest):
    g = req.group.strip()
    sg = req.subgroup.strip()
    if not g:
        raise HTTPException(status_code=400, detail="Grup adı boş olamaz.")
    if req.color:
        state_mgr.storage.setdefault("group_colors", {})[g] = req.color
    saved = state_mgr.storage.setdefault("saved_groups", [])
    found = next((x for x in saved if x["group"].lower() == g.lower()), None)
    if not found:
        found = {"group": g, "subgroups": []}
        saved.append(found)
    if sg and sg not in found["subgroups"]:
        found["subgroups"].append(sg)
    state_mgr._save_storage()
    return scan_match_folder(state_mgr.active_folder)


@app.post("/api/history/save")
def api_save_history():
    state = scan_match_folder(state_mgr.active_folder)
    entry = {
        "id": datetime.now().strftime("%Y%m%d_%H%M%S"),
        "saved_at": datetime.now().strftime("%d.%m.%Y %H:%M"),
        "folder": state["folder"],
        "match_name": state["match_info"].get("match_name") or state["folder_name"],
        "match_date": state["match_info"].get("match_date", ""),
        "total_tickets": state["total_tickets"],
        "assigned_tickets": state["assigned_tickets"],
        "diger_tickets": state["diger_tickets"],
        "groups": [
            {
                "group": g["display_name"],
                "total": g["total_count"],
                "subgroups": [
                    {"name": sg["display"], "count": sg["count"], "ranges": [r["text"] for r in sg["ranges"]]}
                    for sg in g["subgroups"]
                ],
            }
            for g in state["groups_summary"]
        ],
    }
    hist = state_mgr.storage.setdefault("history", [])
    hist.insert(0, entry)
    state_mgr.storage["history"] = hist[:30]
    state_mgr._save_storage()
    return {"ok": True, "history": state_mgr.storage["history"]}


@app.post("/api/open-explorer")
def api_open_explorer(req: OpenExplorerRequest):
    target = state_mgr.active_folder
    if req.group:
        target = target / req.group
        if req.subgroup:
            target = target / req.subgroup
    if not target.exists():
        target = state_mgr.active_folder
    try:
        os.startfile(str(target))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    return {"ok": True, "opened": str(target)}


# ---------------------------------------------------------
# DIŞA AKTARIM (EXPORT) UÇ NOKTALARI: GÖRSEL (PNG), TEK PDF, ZIP
# ---------------------------------------------------------

def _hex_to_rgb(hex_str: str) -> Tuple[int, int, int]:
    h = hex_str.lstrip("#")
    if len(h) == 6:
        return int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)
    return (200, 200, 200)


def _load_font(size: int, bold: bool = False):
    from PIL import ImageFont
    candidates = (
        ["C:/Windows/Fonts/arialbd.ttf", "C:/Windows/Fonts/segoeuib.ttf", "C:/Windows/Fonts/calibrib.ttf"]
        if bold
        else ["C:/Windows/Fonts/arial.ttf", "C:/Windows/Fonts/segoeui.ttf", "C:/Windows/Fonts/calibri.ttf"]
    )
    for c in candidates:
        if os.path.exists(c):
            try:
                return ImageFont.truetype(c, size)
            except Exception:
                pass
    return ImageFont.load_default()


def render_block_annotated_png(block_id: str, mode: str = "groups") -> Tuple[bytes, Path]:
    import numpy as np
    from PIL import Image, ImageDraw
    from scipy.ndimage import binary_dilation, binary_fill_holes, find_objects, label

    state = scan_match_folder(state_mgr.active_folder)
    if block_id not in state["blocks"]:
        raise HTTPException(status_code=404, detail=f"Blok bulunamadı: {block_id}")

    b_info = state["blocks"][block_id]
    b_tickets = b_info["tickets"]
    rows_spec = b_info["rows"]
    orig_img_path = ASSETS_DIR / f"{block_id}.png"

    font_title = _load_font(16, bold=True)
    font_sub = _load_font(13, bold=False)
    font_seat = _load_font(11, bold=True)
    font_small = _load_font(10, bold=False)

    if orig_img_path.exists():
        base_img = Image.open(orig_img_path).convert("RGB")
        arr = np.array(base_img)
        h, w, _ = arr.shape

        diff = np.max(arr, axis=2) - np.min(arr, axis=2)
        gray_border = (diff < 15) & (arr[:, :, 0] > 140) & (arr[:, :, 0] < 235)
        dilated = binary_dilation(gray_border, iterations=1)
        filled = binary_fill_holes(dilated)
        labeled, _ = label(filled)
        slices = find_objects(labeled)

        boxes = []
        for sl in slices:
            if sl is None:
                continue
            y1, y2 = sl[0].start, sl[0].stop
            x1, x2 = sl[1].start, sl[1].stop
            bw, bh = x2 - x1, y2 - y1
            if 18 <= bw <= 55 and 18 <= bh <= 55 and 0.7 <= bw / bh <= 1.35:
                boxes.append((x1, y1, x2, y2, (x1 + x2) / 2, (y1 + y2) / 2))

        boxes.sort(key=lambda b: b[5])
        row_groups = []
        for b in boxes:
            if not row_groups or abs(b[5] - row_groups[-1][0][5]) > 18:
                row_groups.append([b])
            else:
                row_groups[-1].append(b)
        for rg in row_groups:
            rg.sort(key=lambda b: b[4])

        if len(row_groups) == len(rows_spec):
            draw_base = ImageDraw.Draw(base_img)
            for rg, r_spec in zip(row_groups, rows_spec):
                r_num = r_spec["row"]
                non_null_seats = [s for s in r_spec["cells"] if s is not None]
                for box, s_num in zip(rg, non_null_seats):
                    x1, y1, x2, y2, cx, cy = box
                    seat_id = f"{r_num}-{s_num}"
                    t = b_tickets.get(seat_id)

                    if t is None:
                        fill_rgb = (248, 250, 252)
                        outline_rgb = (180, 188, 198)
                        txt_rgb = (148, 163, 184)
                    elif mode == "classic":
                        if t["status"] == "assigned":
                            fill_rgb = (220, 38, 38)
                            outline_rgb = (153, 27, 27)
                            txt_rgb = (255, 255, 255)
                        else:
                            fill_rgb = (245, 158, 11)
                            outline_rgb = (180, 83, 9)
                            txt_rgb = (255, 255, 255)
                    else:
                        if t["status"] == "assigned":
                            fill_rgb = _hex_to_rgb(t["color"])
                            outline_rgb = tuple(max(0, c - 45) for c in fill_rgb)
                            txt_rgb = (255, 255, 255)
                        else:
                            fill_rgb = (245, 158, 11)
                            outline_rgb = (180, 83, 9)
                            txt_rgb = (255, 255, 255)

                    draw_base.rounded_rectangle(
                        [x1 + 1, y1 + 1, x2 - 2, y2 - 2],
                        radius=4,
                        fill=fill_rgb,
                        outline=outline_rgb,
                        width=2,
                    )
                    st_txt = str(s_num)
                    bbox = draw_base.textbbox((0, 0), st_txt, font=font_seat)
                    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
                    draw_base.text((cx - tw / 2, cy - th / 2 - 1), st_txt, fill=txt_rgb, font=font_seat)

            group_items = []
            if mode == "groups":
                g_counts: Dict[str, Dict[str, Any]] = {}
                for t in b_tickets.values():
                    lbl = t["label"] if t["status"] == "assigned" else "Boşta / Diğer"
                    col = t["color"] if t["status"] == "assigned" else "#F59E0B"
                    entry = g_counts.setdefault(lbl, {"label": lbl, "color": col, "count": 0})
                    entry["count"] += 1
                group_items = sorted(g_counts.values(), key=lambda x: (-x["count"], x["label"]))

            legend_rows = (len(group_items) + 2) // 3 if group_items else 0
            extra_h = 85 + (legend_rows * 28 if mode == "groups" else 0)
            out_img = Image.new("RGB", (max(w, 820), h + extra_h), (255, 255, 255))
            out_img.paste(base_img, ((out_img.width - w) // 2, 0))
            draw = ImageDraw.Draw(out_img)

            y_start = h + 8
            draw.line([(20, y_start), (out_img.width - 20, y_start)], fill=(226, 232, 240), width=2)

            summary_title = (
                f"{block_id} BLOK — "
                f"Dağıtılan: {b_info['assigned_count']}  |  "
                f"Boşta/Diğer: {b_info['available_count']}  |  "
                f"Atanmamış: {b_info['missing_count']}  |  "
                f"Kapasite: {b_info['capacity']}"
            )
            draw.text((25, y_start + 10), summary_title, fill=(15, 23, 42), font=font_title)

            if mode == "classic":
                items = [
                    ((220, 38, 38), (153, 27, 27), f"Dağıtılan ({b_info['assigned_count']})"),
                    ((245, 158, 11), (180, 83, 9), f"Boşta / Diğer ({b_info['available_count']})"),
                    ((248, 250, 252), (180, 188, 198), f"Boş ({b_info['missing_count']})"),
                ]
                lx = 25
                ly = y_start + 42
                for f_c, o_c, txt in items:
                    draw.rounded_rectangle([lx, ly, lx + 20, ly + 20], radius=4, fill=f_c, outline=o_c, width=2)
                    draw.text((lx + 28, ly + 2), txt, fill=(51, 65, 85), font=font_sub)
                    lx += 240
            else:
                col_w = (out_img.width - 50) // 3
                for idx, g_it in enumerate(group_items):
                    r_idx = idx // 3
                    c_idx = idx % 3
                    lx = 25 + c_idx * col_w
                    ly = y_start + 42 + r_idx * 26
                    f_c = _hex_to_rgb(g_it["color"])
                    draw.rounded_rectangle([lx, ly, lx + 18, ly + 18], radius=4, fill=f_c, outline=f_c)
                    draw.text(
                        (lx + 25, ly + 1),
                        f"{g_it['label']} ({g_it['count']} adet)",
                        fill=(30, 41, 59),
                        font=font_sub,
                    )

            buf = io.BytesIO()
            out_img.save(buf, format="PNG")
            png_bytes = buf.getvalue()

            suffix = "Isaretli" if mode == "classic" else "Gruplu_Plani"
            save_path = state_mgr.active_folder / f"{block_id}_BLOK_Koltuk_Plani_{suffix}.png"
            with open(save_path, "wb") as f:
                f.write(png_bytes)

            return png_bytes, save_path

    cols = max(b_info["cols"], 10)
    rows_cnt = len(rows_spec)
    cell_size = 38
    w = max(860, cols * cell_size + 140)
    h = rows_cnt * cell_size + 180
    out_img = Image.new("RGB", (w, h), (255, 255, 255))
    draw = ImageDraw.Draw(out_img)
    draw.text((30, 20), f"{block_id} BLOK KOLTUK PLANI", fill=(15, 23, 42), font=font_title)

    for r_idx, r_spec in enumerate(rows_spec):
        r_num = r_spec["row"]
        cy = 70 + r_idx * cell_size
        draw.text((25, cy + 8), f"Sıra {r_num}", fill=(71, 85, 105), font=font_small)
        for c_idx, s_num in enumerate(r_spec["cells"]):
            if s_num is None:
                continue
            cx = 85 + c_idx * cell_size
            seat_id = f"{r_num}-{s_num}"
            t = b_tickets.get(seat_id)
            if t is None:
                fill_rgb = (241, 245, 249)
                txt_rgb = (148, 163, 184)
            elif t["status"] == "assigned":
                fill_rgb = (220, 38, 38) if mode == "classic" else _hex_to_rgb(t["color"])
                txt_rgb = (255, 255, 255)
            else:
                fill_rgb = (245, 158, 11)
                txt_rgb = (255, 255, 255)
            draw.rounded_rectangle([cx, cy, cx + 32, cy + 32], radius=5, fill=fill_rgb)
            draw.text((cx + 8, cy + 9), str(s_num), fill=txt_rgb, font=font_seat)

    buf = io.BytesIO()
    out_img.save(buf, format="PNG")
    png_bytes = buf.getvalue()
    save_path = state_mgr.active_folder / f"{block_id}_BLOK_Koltuk_Plani.png"
    with open(save_path, "wb") as f:
        f.write(png_bytes)
    return png_bytes, save_path


@app.get("/api/export-image/{block_id}")
def api_export_image(block_id: str, mode: str = Query("groups", pattern="^(groups|classic)$")):
    png_bytes, save_path = render_block_annotated_png(block_id, mode=mode)
    filename = save_path.name
    encoded_name = quote(filename)
    return StreamingResponse(
        io.BytesIO(png_bytes),
        media_type="image/png",
        headers={
            "Content-Disposition": f"attachment; filename*=UTF-8''{encoded_name}",
            "X-Saved-Path": quote(str(save_path)),
        },
    )


@app.get("/api/export-merged-pdf")
def api_export_merged_pdf(group: str = Query(""), subgroup: str = Query("")):
    from pypdf import PdfReader, PdfWriter

    state = scan_match_folder(state_mgr.active_folder)
    matched_tickets = []
    for b_info in state["blocks"].values():
        for t in b_info["tickets"].values():
            if not t.get("has_pdf", True):
                continue
            if group == "__ALL__":
                if t["status"] == "assigned":
                    matched_tickets.append(t)
            elif group == "":
                if t["status"] == "unassigned":
                    matched_tickets.append(t)
            else:
                if t["group"].lower() == group.lower():
                    if not subgroup or t["subgroup"].lower() == subgroup.lower():
                        matched_tickets.append(t)

    if not matched_tickets:
        raise HTTPException(status_code=404, detail="Birleştirilecek fiziksel PDF bilet bulunamadı.")

    matched_tickets.sort(key=lambda x: (x["block"], x["row"], x["seat"]))

    writer = PdfWriter()
    for t in matched_tickets:
        pdf_path = state_mgr.active_folder / t["rel_path"]
        if pdf_path.exists():
            reader = PdfReader(str(pdf_path))
            for page in reader.pages:
                writer.add_page(page)

    buf = io.BytesIO()
    writer.write(buf)
    buf.seek(0)

    label_part = f"{group}_{subgroup}" if subgroup else (group if group else "Bosta")
    label_part = re.sub(r'[\\/:*?"<>|]+', "_", label_part)
    out_filename = f"{label_part}_Toplu_Bilet_{len(matched_tickets)}Adet.pdf"
    encoded_name = quote(out_filename)

    return StreamingResponse(
        buf,
        media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{encoded_name}"},
    )


@app.get("/api/export-zip")
def api_export_zip(group: str = Query(""), subgroup: str = Query("")):
    state = scan_match_folder(state_mgr.active_folder)
    matched_tickets = []
    for b_info in state["blocks"].values():
        for t in b_info["tickets"].values():
            if not t.get("has_pdf", True):
                continue
            if not group or group == "__ALL__":
                matched_tickets.append(t)
            else:
                if t["group"].lower() == group.lower():
                    if not subgroup or t["subgroup"].lower() == subgroup.lower():
                        matched_tickets.append(t)

    if not matched_tickets:
        raise HTTPException(status_code=404, detail="ZIP'lenecek fiziksel PDF bilet bulunamadı.")

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for t in matched_tickets:
            pdf_path = state_mgr.active_folder / t["rel_path"]
            if pdf_path.exists():
                zf.write(str(pdf_path), arcname=t["rel_path"])

    buf.seek(0)
    label_part = f"{group}_{subgroup}" if subgroup else (group if group and group != "__ALL__" else "Tum_Biletler")
    label_part = re.sub(r'[\\/:*?"<>|]+', "_", label_part)
    out_filename = f"{label_part}_{len(matched_tickets)}Adet_Bilet.zip"
    encoded_name = quote(out_filename)

    return StreamingResponse(
        buf,
        media_type="application/zip",
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{encoded_name}"},
    )


class PortalRequestPayload(BaseModel):
    match_name: str = "Zeren Spor Kulübü - Kuzeyboru"
    person: str
    department: str = ""
    phone: str = ""
    email: str = ""
    requested_count: int = 1
    ticket_type: str = "Davetiye / Protokol"
    target_block: str = "121"
    description: str = ""


@app.get("/bilet-istiyorum")
@app.get("/talep")
def serve_portal():
    return FileResponse(str(STATIC_DIR / "bilet_istiyorum.html"))


@app.get("/api/portal/matches")
def api_portal_matches():
    state_mgr.sync_excel_matches()
    from portal_storage import ACTIVE_PORTAL_MATCHES
    matches = state_mgr.storage.get("matches", [])
    IGNORED_MATCHES = {"vakifbank", "vakıfbank", "ilbank", "fenerbahce", "fenerbahçe", "besiktas", "beşiktaş"}
    clean_list = []
    for m in matches:
        title = m.get("title", "")
        clean_title = re.sub(r"\s*-\s*\d{3}\s+\d+\s*-\s*-?\d+$", "", title).strip()
        norm_t = normalize_text(clean_title)
        if any(ig in norm_t for ig in IGNORED_MATCHES):
            continue
        clean_list.append({
            "id": m.get("id"),
            "title": clean_title,
            "date": m.get("date", "08.11.2026 16:00") or "08.11.2026 16:00",
            "venue": "TVF Ziraat Bankkart Voleybol Salonu",
            "folder": m.get("folder", ""),
        })
    if not clean_list:
        return ACTIVE_PORTAL_MATCHES
    return clean_list


@app.get("/api/portal/arena-data")
def api_portal_arena_data():
    from blocks_data import BLOCKS_DB, ARENA_ZONES, CLOSED_BLOCKS
    blocks_meta = {}
    for b_id, b_info in BLOCKS_DB.items():
        img_file = ASSETS_DIR / f"{b_id}.png"
        blocks_meta[b_id] = {
            "id": b_id,
            "name": b_info.get("name", f"{b_id} BLOK"),
            "zone": b_info.get("zone", ""),
            "court_side": b_info.get("court_side", ""),
            "capacity": b_info.get("capacity", 0),
            "cols": b_info.get("cols", 0),
            "rows_count": len(b_info.get("rows", [])),
            "has_image": img_file.exists(),
            "image_url": f"/assets/tribun/{b_id}.png" if img_file.exists() else "",
            "is_closed": False,
            "closed_reason": "",
        }
    for b_id, c_info in CLOSED_BLOCKS.items():
        img_file = ASSETS_DIR / f"{b_id}.png"
        blocks_meta[b_id] = {
            "id": b_id,
            "name": c_info.get("name", f"{b_id} BLOK"),
            "zone": c_info.get("zone", ""),
            "court_side": "",
            "capacity": 0,
            "cols": 0,
            "rows_count": 0,
            "has_image": img_file.exists(),
            "image_url": f"/assets/tribun/{b_id}.png" if img_file.exists() else "",
            "is_closed": True,
            "closed_reason": c_info.get("reason", "Satışa Kapalı"),
        }
    return {
        "venue": "TVF Ziraat Bankkart (Başkent) Voleybol Salonu",
        "address": "Emniyet Mah. Milas Sok. No:9, Beşevler / Yenimahalle / ANKARA",
        "zones": ARENA_ZONES,
        "closed_blocks": CLOSED_BLOCKS,
        "blocks": blocks_meta,
        "original_plan_url": "/assets/tribun/oturma%20plan%C4%B1.png",
    }


@app.get("/api/portal/staff")
def api_portal_staff():
    from portal_storage import STAFF_GROUPS, CLUB_STAFF_PRESETS
    return {
        "groups": STAFF_GROUPS,
        "staff": CLUB_STAFF_PRESETS,
    }


@app.post("/api/portal/request")
def api_portal_submit_request(payload: PortalRequestPayload):
    match_name = payload.match_name.strip()
    if not match_name:
        match_name = "Zeren Spor Kulübü - Kuzeyboru"
    if not payload.person.strip():
        raise HTTPException(status_code=400, detail="Ad Soyad alanı zorunludur.")
    if payload.requested_count < 1:
        raise HTTPException(status_code=400, detail="En az 1 bilet talep etmelisiniz.")

    req_data = payload.dict()
    req_data["match_name"] = match_name
    created = create_portal_request(req_data)
    return created


@app.get("/api/portal/my-requests")
def api_portal_my_requests(q: str = Query("")):
    requests = get_requests_by_person(q)
    for req in requests:
        req["has_physical_pdf"] = False
        if req.get("status") == "assigned" and req.get("assigned_seats"):
            b_id = req.get("assigned_block", "121")
            for m in state_mgr.storage.get("matches", []):
                norm_m = normalize_text(m.get("title", ""))
                if normalize_text(req.get("match_name", "")) in norm_m:
                    mfolder = Path(m["folder"])
                    if mfolder.exists():
                        pmap = _find_ticket_path_map(mfolder)
                        for sid in req.get("assigned_seats", []):
                            key = f"{b_id}:{sid}"
                            if key in pmap:
                                req["has_physical_pdf"] = True
                                break
                    break
    return requests


@app.get("/api/portal/download-tickets/{request_id}")
def api_portal_download_tickets(request_id: str):
    from pypdf import PdfReader, PdfWriter

    requests = load_portal_requests()
    target_req = next((r for r in requests if r.get("id") == request_id), None)
    if not target_req:
        raise HTTPException(status_code=404, detail="Talep bulunamadı.")

    if not target_req.get("assigned_seats"):
        raise HTTPException(status_code=400, detail="Bu talep için henüz koltuk tahsis edilmemiştir.")

    mfolder = state_mgr.active_folder
    for m in state_mgr.storage.get("matches", []):
        if normalize_text(target_req.get("match_name", "")) in normalize_text(m.get("title", "")):
            candidate_p = Path(m["folder"])
            if candidate_p.exists():
                mfolder = candidate_p
                break

    pmap = _find_ticket_path_map(mfolder)
    b_id = target_req.get("assigned_block", "121")

    writer = PdfWriter()
    pdf_count = 0
    for sid in target_req.get("assigned_seats", []):
        key = f"{b_id}:{sid}"
        pdf_path = pmap.get(key)
        if pdf_path and pdf_path.exists():
            reader = PdfReader(str(pdf_path))
            for page in reader.pages:
                writer.add_page(page)
            pdf_count += 1

    if pdf_count == 0:
        raise HTTPException(status_code=404, detail="Koltuklar için henüz PDF bilet yüklenmemiştir.")

    buf = io.BytesIO()
    writer.write(buf)
    buf.seek(0)

    clean_person = re.sub(r'[\\/:*?"<>|]+', "_", target_req.get("person", "Bilet"))
    out_filename = f"ZEREN_SPOR_{clean_person}_{pdf_count}Adet_Bilet.pdf"
    encoded_name = quote(out_filename)

    return StreamingResponse(
        buf,
        media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{encoded_name}"},
    )


class UnassignGroupPayload(BaseModel):
    group: Optional[str] = ""
    subgroup: Optional[str] = ""
    seat_keys: Optional[List[str]] = []


@app.post("/api/groups/unassign")
def api_unassign_group(payload: UnassignGroupPayload):
    """
    Belirli bir grubun, alt grubun veya verilen koltuk listesinin atamasını kaldırır (boşa çıkarır).
    Fiziksel PDF dosyalarını ana klasöre geri taşır, sanal atamaları siler.
    """
    folder = state_mgr.active_folder
    group_clean = (payload.group or "").strip()
    subgroup_clean = (payload.subgroup or "").strip()
    seat_keys = payload.seat_keys or []

    plan_data = load_match_plan(folder)
    virtual_map = plan_data.setdefault("virtual_assignments", {})
    path_map = _find_ticket_path_map(folder)

    changed = False

    # 1. Eğer doğrudan seat_keys verilmişse
    if seat_keys:
        for key in seat_keys:
            if key in virtual_map:
                virtual_map.pop(key, None)
                changed = True
            src_path = path_map.get(key)
            if src_path and src_path.exists() and src_path.parent.resolve() != folder.resolve():
                dst_path = folder / src_path.name
                shutil.move(str(src_path), str(dst_path))

    # 2. Grup adına göre eşleşen sanal atamaları sil
    if group_clean:
        g_low = group_clean.lower()
        sg_low = subgroup_clean.lower() if subgroup_clean else ""
        keys_to_del = []
        for k, v in virtual_map.items():
            vg = (v.get("group") or "").strip().lower()
            vsg = (v.get("subgroup") or "").strip().lower()
            if vg == g_low or normalize_text(vg) == normalize_text(g_low):
                if not sg_low or vsg == sg_low or normalize_text(vsg) == normalize_text(sg_low):
                    keys_to_del.append(k)
        for k in keys_to_del:
            virtual_map.pop(k, None)
            changed = True

        target_dir = folder / group_clean
        if subgroup_clean:
            target_dir = target_dir / subgroup_clean
        if target_dir.exists() and target_dir.is_dir():
            for f in target_dir.rglob("*.pdf"):
                dst = folder / f.name
                shutil.move(str(f), str(dst))
            cleanup_empty_dirs(folder)

    if changed:
        save_match_plan(folder, plan_data)

    return scan_match_folder(folder)


@app.delete("/api/portal/request/{request_id}")
@app.post("/api/portal/request/{request_id}/delete")
def api_portal_delete_request(request_id: str):
    from portal_storage import delete_portal_request
    target = delete_portal_request(request_id)
    if not target:
        raise HTTPException(status_code=404, detail="Talep bulunamadı.")

    # Bu talebe atanmış koltuklar varsa, onları da otomatik boşa çıkar
    folder = state_mgr.active_folder
    plan_data = load_match_plan(folder)
    virtual_map = plan_data.setdefault("virtual_assignments", {})
    assigned_seats = target.get("assigned_seats", [])
    target_block = target.get("assigned_block", target.get("target_block", "121"))
    person = target.get("person", "")

    changed = False
    for s in assigned_seats:
        key = f"{target_block}:{s}"
        if key in virtual_map:
            virtual_map.pop(key, None)
            changed = True

    if person:
        p_clean = person.strip().lower()
        keys_to_remove = [
            k for k, v in virtual_map.items()
            if (v.get("group") or "").strip().lower() == p_clean
            or normalize_text(v.get("group") or "") == normalize_text(p_clean)
        ]
        for k in keys_to_remove:
            virtual_map.pop(k, None)
            changed = True

        p_dir = folder / person
        if p_dir.exists() and p_dir.is_dir():
            for f in p_dir.rglob("*.pdf"):
                dst = folder / f.name
                shutil.move(str(f), str(dst))
            cleanup_empty_dirs(folder)

    if changed:
        save_match_plan(folder, plan_data)

    return {"success": True, "message": "Talep ve koltuk atamaları silindi."}


@app.post("/api/portal/requests/clear-all")
def api_portal_clear_all():
    from portal_storage import clear_all_portal_requests
    clear_all_portal_requests()

    folder = state_mgr.active_folder
    plan_data = load_match_plan(folder)
    plan_data["virtual_assignments"] = {}
    save_match_plan(folder, plan_data)

    return {"success": True, "message": "Tüm talepler ve sanal koltuk atamaları temizlendi."}


app.mount("/assets/tribun", StaticFiles(directory=str(ASSETS_DIR)), name="tribun_assets")
STATIC_DIR.mkdir(parents=True, exist_ok=True)
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static_files")


@app.get("/manifest.json")
def serve_manifest():
    return FileResponse(str(STATIC_DIR / "manifest.json"), media_type="application/manifest+json")


@app.get("/sw.js")
def serve_sw():
    return FileResponse(str(STATIC_DIR / "sw.js"), media_type="application/javascript")


@app.get("/icons/{filename}")
def serve_icons(filename: str):
    fpath = STATIC_DIR / "icons" / filename
    if fpath.exists():
        return FileResponse(str(fpath))
    raise HTTPException(status_code=404, detail="Icon not found")


@app.get("/")
def serve_index():
    return FileResponse(str(STATIC_DIR / "index.html"))


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8765)
