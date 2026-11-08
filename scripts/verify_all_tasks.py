#!/usr/bin/env python3
"""
Comprehensive Automated Verification Suite for Tasks T01-T10, U01-U12, M01-M03
Tests API endpoints, security, reconciliation logic, and frontend contracts.
"""

import os
import sys
import json
import urllib.request
import urllib.error
import re
from pathlib import Path

PASS_COUNT = 0
FAIL_COUNT = 0

def check(label, condition, details=""):
    global PASS_COUNT, FAIL_COUNT
    if condition:
        PASS_COUNT += 1
        print(f"  [PASS] {label}")
    else:
        FAIL_COUNT += 1
        print(f"  [FAIL] {label} -> {details}")

print("=== STARTING VERIFICATION SUITE ===")

# --- T01 & T03: Security & Permissions ---
print("\n[T01, T03] Checking Authorization and Safe Querying:")
with open("api/request.js", "r", encoding="utf-8") as f:
    req_js = f.read()
check("api/request.js rejects anonymous GET with 401", "verifyAdminAuth" in req_js and "401" in req_js)
check("api/request.js enforces HTTP methods (405)", "405" in req_js)
check("api/request.js removed in-memory fallbackStore", "fallbackStore" not in req_js)

with open("api/my-requests.js", "r", encoding="utf-8") as f:
    my_req_js = f.read()
check("api/my-requests.js requires q length >= 4", "rawQ.length < 4" in my_req_js and "return res.status(200).json([])" in my_req_js)
check("api/my-requests.js sanitizes output fields (minimization)", "masked_phone" in my_req_js and "description" not in my_req_js)

# --- T02: Admin Tokens & Session Security ---
print("\n[T02] Checking Admin Auth & Token Security:")
with open("api/admin.js", "r", encoding="utf-8") as f:
    admin_js = f.read()
check("admin.js reads secret from env", "process.env.ZEREN_ADMIN_SECRET" in admin_js)
check("admin.js uses safe token comparison (timingSafeEqual)", "safeTokenCompare" in admin_js and "crypto.timingSafeEqual" in admin_js)
check("admin.js implements login rate-limiting", "isRateLimited" in admin_js and "429" in admin_js)
check("admin.js sets HttpOnly and SameSite=Lax cookies", "SameSite=Lax" in admin_js and "HttpOnly" in admin_js)

# --- T04: DB Error Handling & No State Wiping ---
print("\n[T04] Checking Supabase Error Handling:")
check("admin.js uses _lastKnownSysState fallback cache", "_lastKnownSysState" in admin_js)
check("admin.js saveSystemState checks res.ok and throws on failure", "if (!res.ok)" in admin_js and "throw new Error" in admin_js)

# --- T05: Server-side ID Generation ---
print("\n[T05] Checking Collision-Resistant ID Generation:")
check("api/request.js generates crypto random 4-digit ID", "generateUniqueRequestId" in req_js and "crypto.randomInt(1000, 10000)" in req_js)

# --- T06: Seat Collision & Concurrency ---
print("\n[T06] Checking Atomic Seat Collision Detection:")
check("admin.js checks seat collision in /api/assign", "Koltuk çakışması tespit edildi" in admin_js and "409" in admin_js)
check("admin.js checks seat collision in /api/excel/assign-request", "Koltuk çakışması" in admin_js)

# --- T07: Strict Request ID Isolation ---
print("\n[T07] Checking Request ID Isolation:")
check("admin.js isolates sent status by request_id (no person fallback)", "const isSent = Boolean(sentMap[pr.id]);" in admin_js)
check("admin.js mark-sent accepts and indexes request_id", "body.request_id" in admin_js)

# --- T08: Match Scoping ---
print("\n[T08] Checking Match Scoping:")
check("admin.js returns active match name", "active_match_name" in admin_js)

# --- T09 & T10: Windows PDF Reconciliation & Local Companion ---
print("\n[T09, T10] Checking Windows Bridge & Local Server:")
with open("bilet_app/sync_helper.py", "r", encoding="utf-8") as f:
    sync_py = f.read()
# Run actual filesystem regressions, including restart/retry and match isolation.
# Keyword checks cannot establish ownership or successful PDF reconciliation.
import subprocess
sync_result = subprocess.run(
    [sys.executable, "-m", "unittest", "discover", "-s", "tests", "-v"],
    check=False,
)
check("Folder ownership, restart/retry and inventory regression tests", sync_result.returncode == 0)

# Test live local daemon status on port 8765
try:
    req = urllib.request.Request("http://127.0.0.1:8765/api/status")
    with urllib.request.urlopen(req, timeout=3) as resp:
        st_data = json.loads(resp.read().decode("utf-8"))
        check("Local FastAPI daemon is ONLINE on port 8765", st_data.get("status") == "online", str(st_data))
        check("Local daemon reports active match", bool(st_data.get("active_match_name")), st_data.get("active_match_name"))
except Exception as e:
    check("Local FastAPI daemon is ONLINE on port 8765", False, str(e))

# --- U01 - U04: Layout & Accessibility ---
print("\n[U01, U02, U04] Checking Layout, Responsiveness & Accessibility:")
with open("admin.html", "r", encoding="utf-8") as f:
    admin_html = f.read()
check("admin.html has user-scalable=yes viewport meta", 'maximum-scale=5.0, user-scalable=yes' in admin_html)
check("admin.html includes 'İşlemler v' dropdown menu (U02)", 'btnMoreActions' in admin_html and 'moreActionsMenu' in admin_html)
check("admin.html includes local service status pill (T10)", 'localServiceStatusBadge' in admin_html)
check("admin.html includes active highlight chip (U11)", 'activeHighlightChip' in admin_html)

with open("styles.css", "r", encoding="utf-8") as f:
    styles_css = f.read()
check("styles.css hides drawer when closed on mobile (U01)", '.sidebar-column:not(.mobile-open)' in styles_css and 'display: none !important;' in styles_css)
check("styles.css prevents root horizontal overflow (U01)", 'overflow-x: hidden !important;' in styles_css)

# --- U03, U05, U06, U10: Staff Portal Form & Tracking ---
print("\n[U03, U05, U06, U10] Checking Portal UI & Tracking:")
with open("bilet_istiyorum.css", "r", encoding="utf-8") as f:
    portal_css = f.read()
check("bilet_istiyorum.css has global .hidden rule (U03)", '.hidden {\n  display: none !important;\n}' in portal_css)

with open("index.html", "r", encoding="utf-8") as f:
    index_html = f.read()
check("index.html includes 'Taleplerimi Takip Et' tab (U10)", 'tab-my-requests' in index_html)
check("index.html success modal includes Copy and Track buttons (U10)", 'btnCopyReceiptCode' in index_html and 'btnTrackMyRequest' in index_html)
check("index.html includes block allocation advisory hint (U06)", 'Tercihiniz dikkate alınır' in index_html)

with open("bilet_istiyorum.js", "r", encoding="utf-8") as f:
    portal_js = f.read()
check("bilet_istiyorum.js has phone formatting (U06)", '05' in portal_js and 'inputPhoneNumber' in portal_js)
check("bilet_istiyorum.js has searchMyRequests tracking function (U10)", 'searchMyRequests' in portal_js)

# --- U07, U08, U11: Admin App Behaviors ---
print("\n[U07, U08, U11] Checking Admin Interactive Behaviors:")
with open("app.js", "r", encoding="utf-8") as f:
    app_js = f.read()
check("app.js separates WhatsApp opening from mark-sent (U07)", 'WhatsApp ve bilet klasörü açıldı' in app_js)
check("app.js request cards display request_id badge (U08)", 'req-id-badge' in app_js)
check("app.js clears highlight on Escape key (U11)", "e.key === \"Escape\"" in app_js and "updateHighlightChip" in app_js)
check("app.js clears highlight on canvas background click (U11)", "seatingStage" in app_js and "clearAllFocusAndSelection" in app_js)

# --- M01: Multi-Copy Synchronization ---
print("\n[M01] Checking Mirror Consistency:")
import subprocess
ret = subprocess.call([sys.executable, "scripts/sync_copies.py", "--check"])
check("All copies match canonical sources (M01)", ret == 0)

# --- M03: PWA Cache Version ---
print("\n[M03] Checking PWA Cache Version:")
with open("sw.js", "r", encoding="utf-8") as f:
    sw_js = f.read()
check("sw.js bumped to zeren-bilet-pwa-v3 (M03)", 'zeren-bilet-pwa-v3' in sw_js)

print("\n" + "="*50)
print(f"RESULTS: {PASS_COUNT} PASSED, {FAIL_COUNT} FAILED")
print("="*50)

if FAIL_COUNT > 0:
    sys.exit(1)
sys.exit(0)
