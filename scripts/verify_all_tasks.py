#!/usr/bin/env python3
"""Run offline behavioral regressions; no claims based on source-code keywords."""
import argparse
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument('--browser', action='store_true', help='Also run real Chromium with mocked APIs')
options = parser.parse_args()
steps = [
    [sys.executable, '-m', 'unittest', 'discover', '-s', 'tests', '-v'],
    ['node', '--test', 'tests/cloud_api.test.mjs'],
    [sys.executable, 'scripts/sync_copies.py', '--check'],
]
for source in ['app.js', 'bilet_istiyorum.js', 'accessibility.js', 'pwa-update.js', 'sw.js', 'api/admin.js', 'api/request.js', 'api/my-requests.js', 'api/matches.js', 'lib/traffic.js', 'lib/store.js', 'lib/auth.js', 'lib/admin-actions.js']:
    steps.append(['node', '--check', source])
steps.append([sys.executable, '-m', 'py_compile', 'bilet_app/server.py', 'bilet_app/portal_storage.py',
              'bilet_app/sync_helper.py', 'bilet_app/folder_sync.py', 'bilet_app/cloud_bridge.py',
              'bilet_app/ticket_inventory.py', 'bilet_app/desktop_helper.py'])
if options.browser:
    steps.append([sys.executable, 'tests/browser_ui.py'])
    steps.append([sys.executable, 'tests/browser_pwa_update.py'])
for command in steps:
    print('RUN:', ' '.join(command), flush=True)
    result = subprocess.run(command, cwd=ROOT)
    if result.returncode:
        sys.exit(result.returncode)
print('PASS: requested automated behavioral checks.')
print('NOT RUN: production RLS/configuration and real Windows desktop acceptance; see DEPLOYMENT_CHECKLIST.md.')
