# -*- coding: utf-8 -*-
"""
Davetiye Bilet Takip.xlsx Güvenli Okuyucu ve Senkronizasyon Modülü
Excel veya OneDrive açıkken bile Windows paylaşımlı tutamaç (CreateFileW) ile
anlık olarak okur ve koltuk atamalarıyla otomatik eşleştirir.
"""

import ctypes
import io
import os
import re
import unicodedata
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

EXCEL_DEFAULT_PATH = Path(
    r"C:\Users\UtkuGünçe-ZerenSporK\OneDrive - Zeren Group\Davetiye Bilet Takip.xlsx"
)

NAME_ALIASES: Dict[str, List[str]] = {
    "ahmet salih canbaz": ["asc", "ahmet salih canbaz", "ahmet salih", "ahmet"],
    "mustafa yiğit zeren": ["myz", "mustafa yiğit zeren", "mustafa yigit zeren", "mustafa yiğit", "mustafa"],
    "eşref arıcan": ["eşref", "esref", "eşref arıcan", "esref arican"],
    "seda canlı": ["seda", "seda canlı", "seda canli"],
    "utku günçe": ["utku", "utku günçe", "utku gunce"],
    "berk çanakcı": ["berk çanakcı", "berk canakci", "berk"],
    "burak eser": ["burak eser", "burak"],
    "çağlar oskay": ["çağlar", "caglar", "çağlar oskay", "caglar oskay"],
    "neslihan erşahin": ["neslihan", "neslihan erşahin", "neslihan ersahin"],
    "tansu ünal": ["tansu", "tansu ünal", "tansu unal", "fenerbahçe", "fenerbahce", "lösev", "hakemler"],
    "aysu balcı": ["aysu", "aysu balcı", "aysu balci"],
    "ömer özdemir": ["ömer özdemir", "omer ozdemir", "ömer", "omer"],
    "ibrahim erten": ["ibrahim erten", "ibrahim"],
    "kerem taha solmaz": ["kerem taha solmaz", "kerem taha", "kerem"],
    "özlem alkan": ["özlem alkan", "ozlem alkan", "özlem", "ozlem"],
    "mehmet antep": ["mehmet antep", "mehmet"],
    "ayşe fidan": ["ayşe fidan", "ayse fidan", "ayşe", "ayse"],
    "manolya melek açıkgöz": ["manolya melek açıkgöz", "manolya", "melek", "açıkgöz"],
    "ahmetcan erşimşek": ["ahmetcan erşimşek", "ahmetcan", "ersimsek"],
    "enes boztürk": ["enes boztürk", "enes", "bozturk"],
    "vladan šaraba": ["vladan šaraba", "vladan saraba", "vladan"],
    "teoman topçu": ["teoman topçu", "teoman topcu", "teoman"],
    "lazar ilınčıć": ["lazar ilınčıć", "lazar ilincic", "lazar"],
    "beyza karatepe": ["beyza karatepe", "beyza"],
    "anna dodson": ["anna dodson", "dodson"],
    "dicle nur babat": ["dicle nur babat", "dicle babat", "dicle"],
    "sarah franklin": ["sarah franklin", "franklin", "sarah"],
    "merve biçer": ["merve biçer", "merve bicer", "merve"],
    "fatma yıldırım": ["fatma yıldırım", "fatma yildirim", "fatma"],
    "ekaterina pipunyrova": ["ekaterina pipunyrova", "ekaterina", "pipunyrova"],
    "anna nicoletti": ["anna nicoletti", "nicoletti"],
    "hilal kocakara": ["hilal kocakara", "hilal"],
    "seher aksoy": ["seher aksoy", "seher"],
    "adhuoljok malul": ["adhuoljok malul", "adhuoljok", "malul"],
    "aslıhan kılıç": ["aslıhan kılıç", "aslihan kilic", "aslıhan", "aslihan"],
    "ceren önal": ["ceren önal", "ceren onal", "ceren"],
}

FOLDER_TO_CANONICAL: Dict[str, str] = {
    "asc": "Ahmet Salih Canbaz",
    "myz": "Mustafa Yiğit Zeren",
    "eşref": "Eşref Arıcan",
    "esref": "Eşref Arıcan",
    "seda": "Seda Canlı",
    "utku": "Utku Günçe",
    "berk çanakcı": "Berk Çanakcı",
    "burak eser": "Burak Eser",
    "çağlar": "Çağlar Oskay",
    "neslihan": "Neslihan Erşahin",
    "fenerbahçe": "Tansu Ünal",
}


def read_excel_bytes(file_path: Path) -> bytes:
    """
    Excel dosyasını Windows API üzerinden FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE
    ile okur. Excel dosyası masaüstünde açık olsa dahi kilitlenmez.
    """
    p_str = str(file_path.resolve())
    handle = ctypes.windll.kernel32.CreateFileW(
        p_str,
        0x80000000,  # GENERIC_READ
        7,           # FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE
        None,
        3,           # OPEN_EXISTING
        0x80,        # FILE_ATTRIBUTE_NORMAL
        None,
    )
    if handle in (-1, 0xFFFFFFFFFFFFFFFF, 0):
        with open(file_path, "rb") as f:
            return f.read()

    try:
        size = ctypes.windll.kernel32.GetFileSize(handle, None)
        buf = ctypes.create_string_buffer(size)
        bytes_read = ctypes.c_ulong()
        ctypes.windll.kernel32.ReadFile(handle, buf, size, ctypes.byref(bytes_read), None)
        return buf.raw[: bytes_read.value]
    finally:
        ctypes.windll.kernel32.CloseHandle(handle)


def normalize_text(text: str) -> str:
    if not text:
        return ""
    t = text.strip().lower()
    t = t.replace("ı", "i").replace("ğ", "g").replace("ü", "u").replace("ş", "s").replace("ö", "o").replace("ç", "c")
    t = unicodedata.normalize("NFKD", t)
    return "".join(c for c in t if not unicodedata.combining(c))


def get_aliases_for_person(person: str, description: str = "") -> List[str]:
    norm_p = person.strip().lower()
    norm_d = description.strip().lower()
    aliases = set()

    for canon, alist in NAME_ALIASES.items():
        if canon == norm_p or canon in norm_p or norm_p in canon:
            aliases.update([a.lower() for a in alist])

    parts = norm_p.split()
    if parts:
        aliases.add(parts[0])
        aliases.add(norm_p)

    if "fener" in norm_d:
        aliases.add("fenerbahçe")
        aliases.add("fenerbahce")
    if "losev" in normalize_text(norm_d) or "lösev" in norm_d:
        aliases.add("lösev")
        aliases.add("losev")
    if "hakem" in norm_d:
        aliases.add("hakemler")
        aliases.add("hakem")

    return list(aliases)


def parse_bilet_takip_excel(file_path: Optional[Path] = None) -> Dict[str, Any]:
    target_path = file_path or EXCEL_DEFAULT_PATH
    if not target_path.exists():
        return {
            "ok": False,
            "error": f"Excel dosyası bulunamadı: {target_path}",
            "excel_path": str(target_path),
            "matches": [],
            "by_match": {},
            "total_requests": 0,
        }

    try:
        raw_bytes = read_excel_bytes(target_path)
        with zipfile.ZipFile(io.BytesIO(raw_bytes), "r") as z:
            shared_strings: List[str] = []
            if "xl/sharedStrings.xml" in z.namelist():
                tree = ET.fromstring(z.read("xl/sharedStrings.xml"))
                for si in tree.findall("{http://schemas.openxmlformats.org/spreadsheetml/2006/main}si"):
                    t = si.find("{http://schemas.openxmlformats.org/spreadsheetml/2006/main}t")
                    if t is not None:
                        shared_strings.append(t.text or "")
                    else:
                        texts = [elem.text for elem in si.iter() if elem.text]
                        shared_strings.append("".join(texts))

            stree = ET.fromstring(z.read("xl/worksheets/sheet1.xml"))
            rows = stree.findall(
                "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}sheetData/{http://schemas.openxmlformats.org/spreadsheetml/2006/main}row"
            )

            records: List[Dict[str, Any]] = []
            for row in rows:
                rnum = int(row.attrib.get("r", 0))
                cells: Dict[str, str] = {}
                for c in row.findall("{http://schemas.openxmlformats.org/spreadsheetml/2006/main}c"):
                    ref = c.attrib.get("r", "")
                    col = "".join([ch for ch in ref if ch.isalpha()])
                    t = c.attrib.get("t")
                    v = c.find("{http://schemas.openxmlformats.org/spreadsheetml/2006/main}v")
                    val = v.text if v is not None else ""
                    if t == "s" and val.isdigit():
                        idx = int(val)
                        val = shared_strings[idx] if idx < len(shared_strings) else val
                    cells[col] = str(val).strip() if val else ""

                if rnum > 1 and cells.get("B"):
                    count_val = int(cells.get("E")) if cells.get("E", "").isdigit() else 0
                    match_name = cells.get("B", "").strip()
                    person = cells.get("C", "").strip()
                    desc = cells.get("F", "").strip()
                    target_b = cells.get("H", "").strip()

                    # Standart grup/altgrup önerisi
                    aliases = get_aliases_for_person(person, desc)
                    suggested_group = aliases[0] if aliases else person
                    # Yaygın klasör formatlarına çevir
                    if person == "Ahmet Salih Canbaz":
                        suggested_group = "ASC"
                    elif person == "Mustafa Yiğit Zeren":
                        suggested_group = "MYZ"
                    elif person == "Eşref Arıcan":
                        suggested_group = "eşref"
                    elif person == "Seda Canlı":
                        suggested_group = "seda"
                    elif person == "Utku Günçe":
                        suggested_group = "utku"
                    elif person == "Çağlar Oskay":
                        suggested_group = "çağlar"
                    elif "fener" in desc.lower():
                        suggested_group = "fenerbahçe"

                    suggested_sub = desc if desc and not ("fener" in desc.lower()) else ""

                    records.append({
                        "request_id": f"row_{rnum}",
                        "row_index": rnum,
                        "date_serial": cells.get("A", ""),
                        "match": match_name,
                        "person": person,
                        "ticket_type": cells.get("D", "").strip(),
                        "requested_count": count_val,
                        "description": desc,
                        "status": cells.get("G", "").strip(),
                        "target_block": target_b,
                        "suggested_group": suggested_group,
                        "suggested_subgroup": suggested_sub,
                        "aliases": aliases,
                    })

        by_match: Dict[str, List[Dict[str, Any]]] = {}
        for r in records:
            by_match.setdefault(r["match"], []).append(r)

        matches_summary = []
        for mname, reqs in by_match.items():
            matches_summary.append({
                "match_name": mname,
                "total_requested": sum(x["requested_count"] for x in reqs),
                "requests_count": len(reqs),
                "requests": reqs,
            })

        return {
            "ok": True,
            "excel_path": str(target_path),
            "total_requests": len(records),
            "matches_count": len(by_match),
            "matches": matches_summary,
            "by_match": by_match,
        }
    except Exception as exc:
        return {
            "ok": False,
            "error": f"Excel ayrıştırma hatası: {str(exc)}",
            "excel_path": str(target_path),
            "matches": [],
            "by_match": {},
            "total_requests": 0,
        }


def match_requests_with_tickets(
    excel_requests: List[Dict[str, Any]],
    tickets: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    """
    Excel taleplerini klasördeki ve sanal plandaki koltuk atamalarıyla eşleştirir.
    Hangi talebin kaç koltuğunun atandığını, hangi koltukların tahsis edildiğini hesaplar.
    """
    assigned_tickets = [t for t in tickets if t.get("status") == "assigned"]
    used_ticket_keys = set()

    evaluated_requests: List[Dict[str, Any]] = []

    # 1. Pas: Hem kişi hem alt grup (açıklama) birebir eşleşenleri bul
    for req in excel_requests:
        target_b = req.get("target_block", "").strip()
        desc = req.get("description", "").strip().lower()
        aliases = [a.lower() for a in req.get("aliases", [])]
        matched_keys: List[str] = []
        matched_seats: List[str] = []

        if desc:
            for t in assigned_tickets:
                if t["key"] in used_ticket_keys:
                    continue
                if target_b and t.get("block") != target_b:
                    continue
                t_sub = (t.get("subgroup") or "").strip().lower()
                t_grp = (t.get("group") or "").strip().lower()
                t_lbl = (t.get("label") or "").strip().lower()

                matches_sub = (
                    desc in t_sub
                    or t_sub in desc
                    or normalize_text(desc) in normalize_text(t_sub)
                    or normalize_text(desc) in normalize_text(t_lbl)
                )
                matches_grp = any(
                    al in t_grp or t_grp in al or normalize_text(al) in normalize_text(t_grp)
                    for al in aliases
                )

                if matches_sub and matches_grp:
                    matched_keys.append(t["key"])
                    matched_seats.append(f"{t['row']}-{t['seat']}")
                    used_ticket_keys.add(t["key"])
                    if len(matched_keys) >= req["requested_count"]:
                        break

        req_copy = dict(req)
        req_copy["matched_keys"] = matched_keys
        req_copy["matched_seats"] = matched_seats
        req_copy["assigned_count"] = len(matched_keys)
        evaluated_requests.append(req_copy)

    # 2. Pas: Alt grubu olmayan veya henüz dolmamış talepleri kişi bazında eşle
    for req in evaluated_requests:
        rem_needed = req["requested_count"] - req["assigned_count"]
        if rem_needed <= 0:
            continue

        target_b = req.get("target_block", "").strip()
        aliases = [a.lower() for a in req.get("aliases", [])]

        for t in assigned_tickets:
            if t["key"] in used_ticket_keys:
                continue
            if target_b and t.get("block") != target_b:
                continue
            t_grp = (t.get("group") or "").strip().lower()
            matches_grp = any(
                al in t_grp or t_grp in al or normalize_text(al) in normalize_text(t_grp)
                for al in aliases
            )

            if matches_grp:
                req["matched_keys"].append(t["key"])
                req["matched_seats"].append(f"{t['row']}-{t['seat']}")
                used_ticket_keys.add(t["key"])
                req["assigned_count"] += 1
                if req["assigned_count"] >= req["requested_count"]:
                    break

    # Durum ve yüzde hesaplamaları
    for req in evaluated_requests:
        req_c = req["requested_count"]
        asg_c = req["assigned_count"]
        if asg_c >= req_c and req_c > 0:
            req["fulfillment_status"] = "completed"
            req["status_badge"] = "Tamamlandı"
            req["status_color"] = "#059669"
            req["progress_pct"] = 100
        elif asg_c > 0:
            req["fulfillment_status"] = "partial"
            req["status_badge"] = f"Kısmi ({asg_c}/{req_c})"
            req["status_color"] = "#D97706"
            req["progress_pct"] = int((asg_c / req_c) * 100) if req_c > 0 else 0
        else:
            req["fulfillment_status"] = "pending"
            req["status_badge"] = f"Bekliyor (0/{req_c})"
            req["status_color"] = "#64748B"
            req["progress_pct"] = 0

    return evaluated_requests
