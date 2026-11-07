# -*- coding: utf-8 -*-
"""
Bilet İstiyorum — Kulüp Çalışanları Bilet Talep Yönetim Modülü
Kulüp personelinin maç bilet taleplerini kaydeder, durumunu günceller ve
ana Bilet Takip / Dağıtım paneliyle çift yönlü senkronize eder.
"""

import json
import os
import re
import urllib.parse
import urllib.request
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

SUPABASE_URL = os.environ.get("SUPABASE_URL", "https://kgchdufcqgyhycgyydhf.supabase.co").rstrip("/")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY", "sb_publishable_aT8iwPOs6AOg5HfaAQpGhg_TlvHwG2T")


def _supabase_headers(extra: Optional[Dict[str, str]] = None) -> Dict[str, str]:
    headers = {
        "apikey": SUPABASE_KEY,
        "Content-Type": "application/json",
    }
    if SUPABASE_KEY.startswith("eyJ"):
        headers["Authorization"] = f"Bearer {SUPABASE_KEY}"
    if extra:
        headers.update(extra)
    return headers


def supabase_upsert_request(req_obj: Dict[str, Any]) -> bool:
    """Talebi Supabase'e ekler veya günceller."""
    try:
        row = {
            "id": req_obj.get("id", ""),
            "match_name": req_obj.get("match_name", "Zeren Spor - Kuzeyboru"),
            "person": req_obj.get("person", ""),
            "department": req_obj.get("department", ""),
            "phone": req_obj.get("phone", ""),
            "ticket_type": req_obj.get("ticket_type", "Davetiye / Protokol"),
            "requested_count": int(req_obj.get("requested_count", 1)),
            "target_block": req_obj.get("target_block", "121"),
            "description": req_obj.get("description", ""),
            "status": req_obj.get("status", "pending"),
            "assigned_seats": req_obj.get("assigned_seats", []),
            "assigned_block": req_obj.get("assigned_block", ""),
            "whatsapp_sent": bool(req_obj.get("whatsapp_sent", False)),
            "whatsapp_sent_at": req_obj.get("whatsapp_sent_at"),
        }
        url = f"{SUPABASE_URL}/rest/v1/portal_requests"
        data = json.dumps(row).encode("utf-8")
        req = urllib.request.Request(
            url,
            data=data,
            method="POST",
            headers=_supabase_headers({"Prefer": "resolution=merge-duplicates,return=minimal"}),
        )
        with urllib.request.urlopen(req, timeout=4) as res:
            return res.status in (200, 201, 204)
    except Exception:
        return False


def supabase_delete_request(request_id: str) -> bool:
    """Talebi Supabase'den siler."""
    try:
        enc_id = urllib.parse.quote(request_id, safe="")
        url = f"{SUPABASE_URL}/rest/v1/portal_requests?id=eq.{enc_id}"
        req = urllib.request.Request(url, method="DELETE", headers=_supabase_headers())
        with urllib.request.urlopen(req, timeout=4) as res:
            return res.status in (200, 204)
    except Exception:
        return False


def supabase_clear_all() -> bool:
    """Tüm talepleri Supabase'den temizler."""
    try:
        url = f"{SUPABASE_URL}/rest/v1/portal_requests?id=neq.__SYSTEM_STATE__"
        req = urllib.request.Request(url, method="DELETE", headers=_supabase_headers())
        with urllib.request.urlopen(req, timeout=4) as res:
            return res.status in (200, 204)
    except Exception:
        return False

PORTAL_DATA_DIR = Path(__file__).resolve().parent / "data"
PORTAL_REQUESTS_FILE = PORTAL_DATA_DIR / "portal_requests.json"
PHONEBOOK_FILE = PORTAL_DATA_DIR / "phonebook.json"
PORTAL_DATA_DIR.mkdir(parents=True, exist_ok=True)

def load_phonebook() -> Dict[str, str]:
    if not PHONEBOOK_FILE.exists():
        return {}
    try:
        with open(PHONEBOOK_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}

def save_phonebook(pb: Dict[str, str]) -> None:
    try:
        with open(PHONEBOOK_FILE, "w", encoding="utf-8") as f:
            json.dump(pb, f, ensure_ascii=False, indent=2)
    except Exception:
        pass

def _normalize_name_key(text: str) -> str:
    t = text.lower().strip()
    tr_map = str.maketrans("çğıöşüiı", "cgiosuii")
    return t.translate(tr_map)


def get_person_phone(person_name: str) -> str:
    if not person_name:
        return ""
    pb = load_phonebook()
    p_norm = _normalize_name_key(person_name)

    # 1. Tam eşleşme
    for k, v in pb.items():
        if _normalize_name_key(k) == p_norm:
            return v

    # 2. Özel kısaltma eşleşmeleri
    if p_norm in ("asc", "ahmet salih"):
        if "Ahmet Salih Canbaz" in pb:
            return pb["Ahmet Salih Canbaz"]

    # 3. İsim/alt dize eşleşmesi (örn: "seda" -> "Seda Canlı", "eşref" -> "Eşref Arıcan")
    for k, v in pb.items():
        k_norm = _normalize_name_key(k)
        if len(p_norm) >= 3 and (p_norm in k_norm or k_norm in p_norm):
            return v

    return ""

def save_person_phone(person_name: str, phone: str) -> None:
    if not person_name or not phone:
        return
    pb = load_phonebook()
    pb[person_name.strip()] = phone.strip()
    save_phonebook(pb)

def format_whatsapp_phone(raw_phone: str) -> str:
    """Türkiye ve uluslararası telefon numaralarını WhatsApp formatına normalize eder."""
    if not raw_phone:
        return ""
    digits = re.sub(r"\D", "", raw_phone)
    if not digits:
        return ""
    # 05321234567 -> 905321234567
    if digits.startswith("0") and len(digits) == 11:
        return "90" + digits[1:]
    # 5321234567 -> 905321234567
    if digits.startswith("5") and len(digits) == 10:
        return "90" + digits
    # 905321234567 -> 905321234567
    if digits.startswith("90") and len(digits) == 12:
        return digits
    return digits

# Kulüp Personeli ve Sporcu Grupları (Genişletilebilir / Daraltılabilir Kategori Yapısı)
STAFF_GROUPS = [
    {
        "group": "İdari Personel",
        "icon": "ph-briefcase",
        "members": [
            "Utku Günçe",
            "Tansu Ünal",
            "Aysu Balcı",
            "Çağlar Oskay",
            "Neslihan Erşahin",
            "Ayşe Fidan",
            "Eşref Arıcan",
            "Ömer Özdemir",
        ],
    },
    {
        "group": "Yönetim",
        "icon": "ph-crown",
        "members": [
            "Mustafa Yiğit Zeren",
            "Ahmet Salih Canbaz",
            "Manolya Melek Açıkgöz",
        ],
    },
    {
        "group": "Teknik Ekip",
        "icon": "ph-clipboard-text",
        "members": [
            "Ahmetcan Erşimşek",
            "Berk Çanakcı",
            "Enes Boztürk",
            "Seda Canlı",
            "Vladan Šaraba",
            "Teoman Topçu",
            "Lazar Ilınčıć",
            "İbrahim Erten",
            "Burak Eser",
        ],
    },
    {
        "group": "Altyapı",
        "icon": "ph-plant",
        "members": [
            "Kerem Taha Solmaz",
            "Beyza Karatepe",
        ],
    },
    {
        "group": "Diğer",
        "icon": "ph-dots-three-circle",
        "members": [
            "Mehmet Antep",
        ],
    },
    {
        "group": "Sporcu",
        "icon": "ph-volleyball",
        "members": [
            "Anna Dodson",
            "Dicle Nur Babat",
            "Sarah Franklin",
            "Merve Biçer",
            "Fatma Yıldırım",
            "Ekaterina Pipunyrova",
            "Anna Nicoletti",
            "Hilal Kocakara",
            "Seher Aksoy",
            "Adhuoljok Malul",
            "Aslıhan Kılıç",
            "Özlem Alkan",
            "Ceren Önal",
        ],
    },
]

# Düzleştirilmiş liste
CLUB_STAFF_PRESETS = [
    {"name": m, "group": g["group"], "department": g["group"], "role": g["group"]}
    for g in STAFF_GROUPS
    for m in g["members"]
]

# Aktif / Gelecek Karşılaşmalar (Geçmiş maçlar İlbank, Fenerbahçe, Beşiktaş gösterilmez)
ACTIVE_PORTAL_MATCHES = [
    {
        "id": "20261108_kuzeyboru",
        "title": "Zeren Spor Kulübü - Kuzeyboru",
        "date": "08.11.2026 16:00",
        "venue": "TVF Ziraat Bankkart Voleybol Salonu",
    }
]


def load_portal_requests() -> List[Dict[str, Any]]:
    if not PORTAL_REQUESTS_FILE.exists():
        return []
    try:
        with open(PORTAL_REQUESTS_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return []


def save_portal_requests(requests: List[Dict[str, Any]]) -> None:
    with open(PORTAL_REQUESTS_FILE, "w", encoding="utf-8") as f:
        json.dump(requests, f, ensure_ascii=False, indent=2)


def generate_request_code(existing_count: int) -> str:
    now = datetime.now()
    year = now.strftime("%Y")
    return f"ZEREN-{year}-{existing_count + 1:04d}"


def create_portal_request(payload: Dict[str, Any]) -> Dict[str, Any]:
    requests = load_portal_requests()
    req_code = generate_request_code(len(requests))

    person = payload.get("person", "").strip()
    match_name = payload.get("match_name", "").strip()
    if not match_name and ACTIVE_PORTAL_MATCHES:
        match_name = ACTIVE_PORTAL_MATCHES[0]["title"]

    count = int(payload.get("requested_count", 1))
    if count < 1:
        count = 1

    phone = payload.get("phone", "").strip()
    if phone:
        save_person_phone(person, phone)
    else:
        phone = get_person_phone(person)

    entry = {
        "id": req_code,
        "created_at": datetime.now().strftime("%d.%m.%Y %H:%M"),
        "timestamp": datetime.now().isoformat(),
        "match_name": match_name,
        "person": person,
        "department": payload.get("department", "").strip(),
        "phone": phone,
        "email": payload.get("email", "").strip(),
        "requested_count": count,
        "ticket_type": payload.get("ticket_type", "Davetiye / Protokol").strip(),
        "target_block": payload.get("target_block", "121").strip(),
        "description": payload.get("description", "").strip(),
        "status": "pending",  # "pending" | "assigned" | "rejected"
        "status_label": "İnceleniyor (Bekliyor)",
        "assigned_count": 0,
        "assigned_block": "",
        "assigned_seats": [],
        "assigned_group": "",
        "assigned_subgroup": "",
        "admin_notes": "",
        "whatsapp_sent": False,
        "whatsapp_sent_at": None,
    }

    requests.insert(0, entry)
    save_portal_requests(requests)
    supabase_upsert_request(entry)
    return entry


def sync_requests_from_vercel() -> int:
    added = 0
    local_reqs = load_portal_requests()
    existing_map = {r.get("id"): r for r in local_reqs if r.get("id")}

    # 1. Önce doğrudan Supabase'den çek
    try:
        sb_url = f"{SUPABASE_URL}/rest/v1/portal_requests?id=neq.__SYSTEM_STATE__&select=*&order=created_at.desc"
        req = urllib.request.Request(sb_url, headers=_supabase_headers())
        with urllib.request.urlopen(req, timeout=4) as res:
            if res.status == 200:
                sb_rows = json.loads(res.read().decode("utf-8"))
                if isinstance(sb_rows, list):
                    for sr in sb_rows:
                        rid = sr.get("id")
                        if not rid or rid == "__SYSTEM_STATE__":
                            continue
                        if not sr.get("phone") and sr.get("person"):
                            sr["phone"] = get_person_phone(sr["person"])
                        if rid not in existing_map:
                            local_reqs.append(sr)
                            existing_map[rid] = sr
                            added += 1
                        else:
                            # Durum veya koltuk güncellemesi varsa senkronize et
                            ex = existing_map[rid]
                            if sr.get("status") != ex.get("status") or sr.get("assigned_seats") != ex.get("assigned_seats") or sr.get("whatsapp_sent") != ex.get("whatsapp_sent"):
                                ex.update(sr)
                                added += 1
    except Exception:
        pass

    # 2. Yedek olarak Vercel API'den de kontrol et
    try:
        url = "https://biletistiyorum.vercel.app/api/portal/request"
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=3) as res:
            if res.status == 200:
                cloud_reqs = json.loads(res.read().decode("utf-8"))
                if cloud_reqs and isinstance(cloud_reqs, list):
                    for cr in cloud_reqs:
                        rid = cr.get("id")
                        if rid and rid not in existing_map:
                            if not cr.get("phone") and cr.get("person"):
                                cr["phone"] = get_person_phone(cr["person"])
                            local_reqs.append(cr)
                            existing_map[rid] = cr
                            added += 1
    except Exception:
        pass

    if added > 0:
        save_portal_requests(local_reqs)
    return added


def get_requests_for_match(match_name: str) -> List[Dict[str, Any]]:
    sync_requests_from_vercel()
    requests = load_portal_requests()
    norm_m = match_name.strip().lower()
    if not norm_m:
        return requests
    return [
        r
        for r in requests
        if norm_m in r.get("match_name", "").lower()
        or r.get("match_name", "").lower() in norm_m
        or ("kuzeyboru" in norm_m and "kuzeyboru" in r.get("match_name", "").lower())
    ]


def get_requests_by_person(person_query: str) -> List[Dict[str, Any]]:
    sync_requests_from_vercel()
    requests = load_portal_requests()
    q = person_query.strip().lower()
    if not q:
        return []
    return [
        r
        for r in requests
        if q in r.get("person", "").lower()
        or q in r.get("phone", "").lower()
        or q in r.get("id", "").lower()
    ]


def update_request_fulfillment(
    request_id: str,
    status: str,
    assigned_block: str,
    assigned_seats: List[str],
    group: str = "",
    subgroup: str = "",
    admin_notes: str = "",
) -> Optional[Dict[str, Any]]:
    requests = load_portal_requests()
    target_req = None
    for r in requests:
        if r.get("id") == request_id:
            target_req = r
            break

    if not target_req:
        return None

    target_req["status"] = status
    target_req["assigned_block"] = assigned_block
    target_req["assigned_seats"] = assigned_seats
    target_req["assigned_count"] = len(assigned_seats)
    if group:
        target_req["assigned_group"] = group
    if subgroup:
        target_req["assigned_subgroup"] = subgroup
    if admin_notes:
        target_req["admin_notes"] = admin_notes

    if status == "assigned":
        target_req["status_label"] = f"Koltuklar Ayrıldı ({len(assigned_seats)} Adet)"
    elif status == "rejected":
        target_req["status_label"] = "Talebiniz Karşılanamadı (Kapasite Dolu)"
    else:
        target_req["status_label"] = "İnceleniyor (Bekliyor)"

    save_portal_requests(requests)
    supabase_upsert_request(target_req)
    return target_req


def delete_portal_request(request_id: str) -> Optional[Dict[str, Any]]:
    requests = load_portal_requests()
    target = None
    new_requests = []
    for r in requests:
        if r.get("id") == request_id:
            target = r
        else:
            new_requests.append(r)
    supabase_delete_request(request_id)
    if target is not None:
        save_portal_requests(new_requests)
        return target
    return None


def clear_all_portal_requests() -> None:
    save_portal_requests([])
    supabase_clear_all()


def set_request_whatsapp_sent(request_id: str, sent: bool = True) -> Optional[Dict[str, Any]]:
    requests = load_portal_requests()
    target_req = next((r for r in requests if r.get("id") == request_id), None)
    if not target_req:
        return None
    target_req["whatsapp_sent"] = sent
    target_req["whatsapp_sent_at"] = datetime.now().isoformat() if sent else None
    save_portal_requests(requests)
    supabase_upsert_request(target_req)
    return target_req


def update_portal_request(request_id: str, payload: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    requests = load_portal_requests()
    target_req = next((r for r in requests if r.get("id") == request_id), None)
    if not target_req:
        return None
    for k in ["person", "phone", "department", "target_block", "description"]:
        if k in payload and payload[k] is not None:
            target_req[k] = str(payload[k]).strip()
    if "requested_count" in payload and payload["requested_count"] is not None:
        try:
            target_req["requested_count"] = int(payload["requested_count"])
        except Exception:
            pass
    save_portal_requests(requests)
    supabase_upsert_request(target_req)
    return target_req


def update_request_phone(request_id: str, phone: str) -> Optional[Dict[str, Any]]:
    requests = load_portal_requests()
    target_req = next((r for r in requests if r.get("id") == request_id), None)
    clean_p = phone.strip()
    if target_req:
        target_req["phone"] = clean_p
        if target_req.get("person"):
            save_person_phone(target_req["person"], clean_p)
        save_portal_requests(requests)
        supabase_upsert_request(target_req)
        return target_req
    return None

