#!/usr/bin/env python3
"""
scripts/sync_copies.py
Synchronizes canonical root source files to all mirror destinations across:
- biletistiyorum/
- biletistiyorum/static/
- bilet_app/static/
- static/

Supports:
  python scripts/sync_copies.py         # Syncs all files
  python scripts/sync_copies.py --check # Verifies all files are identical, exits 1 if mismatch
"""

import sys
import os
import shutil
import filecmp

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))

MAPPINGS = [
    (".vercelignore", ["biletistiyorum/.vercelignore"]),
    ("accessibility.js", ["static/accessibility.js", "biletistiyorum/static/accessibility.js", "bilet_app/static/accessibility.js"]),
    ("lib/store.js", ["biletistiyorum/lib/store.js"]),
    ("lib/auth.js", ["biletistiyorum/lib/auth.js"]),
    ("lib/admin-actions.js", ["biletistiyorum/lib/admin-actions.js"]),
    # (Source relative to REPO_ROOT, [Destinations relative to REPO_ROOT])
    (
        "admin.html",
        [
            "biletistiyorum/admin.html",
            "static/admin.html",
            "bilet_app/static/index.html",
        ],
    ),
    (
        "index.html",
        [
            "biletistiyorum/index.html",
            "bilet_app/static/bilet_istiyorum.html",
        ],
    ),
    (
        "app.js",
        [
            "biletistiyorum/app.js",
            "biletistiyorum/static/app.js",
            "static/app.js",
            "bilet_app/static/app.js",
        ],
    ),
    (
        "styles.css",
        [
            "biletistiyorum/styles.css",
            "biletistiyorum/static/styles.css",
            "static/styles.css",
            "bilet_app/static/styles.css",
        ],
    ),
    (
        "bilet_istiyorum.js",
        [
            "biletistiyorum/bilet_istiyorum.js",
            "biletistiyorum/static/bilet_istiyorum.js",
            "static/bilet_istiyorum.js",
            "bilet_app/static/bilet_istiyorum.js",
        ],
    ),
    (
        "bilet_istiyorum.css",
        [
            "biletistiyorum/bilet_istiyorum.css",
            "biletistiyorum/static/bilet_istiyorum.css",
            "static/bilet_istiyorum.css",
            "bilet_app/static/bilet_istiyorum.css",
        ],
    ),
    (
        "sw.js",
        [
            "biletistiyorum/sw.js",
            "bilet_app/static/sw.js",
        ],
    ),
    (
        "manifest.json",
        [
            "biletistiyorum/manifest.json",
            "bilet_app/static/manifest.json",
        ],
    ),
    (
        "vercel.json",
        [
            "biletistiyorum/vercel.json",
        ],
    ),
    (
        "api/admin.js",
        [
            "biletistiyorum/api/admin.js",
        ],
    ),
    (
        "api/request.js",
        [
            "biletistiyorum/api/request.js",
        ],
    ),
    (
        "api/my-requests.js",
        [
            "biletistiyorum/api/my-requests.js",
        ],
    ),
    (
        "api/matches.js",
        [
            "biletistiyorum/api/matches.js",
        ],
    ),
    (
        "api/staff.js",
        [
            "biletistiyorum/api/staff.js",
        ],
    ),
    (
        "api/base_state.json",
        [
            "biletistiyorum/api/base_state.json",
        ],
    ),
]


def sync_all():
    updated = 0
    for src_rel, dst_list in MAPPINGS:
        src_path = os.path.join(REPO_ROOT, src_rel)
        if not os.path.exists(src_path):
            print(f"[WARN] Source missing: {src_rel}")
            continue
        for dst_rel in dst_list:
            dst_path = os.path.join(REPO_ROOT, dst_rel)
            os.makedirs(os.path.dirname(dst_path), exist_ok=True)
            if not os.path.exists(dst_path) or not filecmp.cmp(src_path, dst_path, shallow=False):
                shutil.copy2(src_path, dst_path)
                print(f"[SYNC] {src_rel} -> {dst_rel}")
                updated += 1
    print(f"Sync complete. Updated {updated} files.")
    return 0


def check_all():
    mismatches = 0
    for src_rel, dst_list in MAPPINGS:
        src_path = os.path.join(REPO_ROOT, src_rel)
        if not os.path.exists(src_path):
            print(f"[ERROR] Source missing: {src_rel}")
            mismatches += 1
            continue
        for dst_rel in dst_list:
            dst_path = os.path.join(REPO_ROOT, dst_rel)
            if not os.path.exists(dst_path):
                print(f"[MISMATCH] Destination missing: {dst_rel}")
                mismatches += 1
            elif not filecmp.cmp(src_path, dst_path, shallow=False):
                print(f"[MISMATCH] Diff detected: {src_rel} != {dst_rel}")
                mismatches += 1
    if mismatches > 0:
        print(f"[FAIL] Found {mismatches} mismatching files.")
        return 1
    print("[PASS] All mirrored copies are 100% in sync.")
    return 0


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--check":
        sys.exit(check_all())
    else:
        sys.exit(sync_all())
