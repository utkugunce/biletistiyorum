#!/usr/bin/env python3
"""Read-only deployment checks, plus optional login/logout (no ticket mutations)."""
import argparse
import http.cookiejar
import json
import os
import urllib.error
import urllib.request

parser = argparse.ArgumentParser()
parser.add_argument('--url', default='https://biletistiyorum.vercel.app')
parser.add_argument('--check-anon-database', action='store_true')
parser.add_argument('--authenticated', action='store_true')
options = parser.parse_args()
base = options.url.rstrip('/')
jar = http.cookiejar.CookieJar()
client = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
failures = []

def call(path, method='GET', body=None, headers=None):
    request = urllib.request.Request(base+path, method=method,
        data=json.dumps(body).encode() if body is not None else None,
        headers={'Content-Type': 'application/json', **(headers or {})})
    try:
        with client.open(request, timeout=20) as response:
            content = response.read()
            return response.status, json.loads(content) if 'application/json' in response.headers.get('Content-Type','') else None
    except urllib.error.HTTPError as error:
        return error.code, None

def check(label, good):
    print(('PASS ' if good else 'FAIL ')+label)
    if not good: failures.append(label)

for path in ['/bilet_app/data/phonebook.json','/bilet_app/data/storage.json','/bilet_app/data/portal_requests.json','/biletistiyorum/bilet_app/data/storage.json']:
    status,_=call(path)
    check('Private path blocked: '+path, status in (401,403,404))
for path in ['/api/state','/api/portal/request','/api/portal/my-requests?q=ZS-257']:
    status,_=call(path)
    check('Anonymous API blocked: '+path, status in (401,403))
if options.check_anon_database:
    key=os.environ.get('SUPABASE_ANON_KEY','')
    if not key: raise SystemExit('Set SUPABASE_ANON_KEY privately; never paste service-role keys into chat.')
    request=urllib.request.Request(os.environ['SUPABASE_URL'].rstrip('/')+'/rest/v1/portal_requests?select=id&limit=1',headers={'apikey':key})
    try:
        with urllib.request.urlopen(request,timeout=15) as response: status=response.status
    except urllib.error.HTTPError as error: status=error.code
    check('Anonymous database permission revoked',status in (401,403))
if options.authenticated:
    password=os.environ.get('ZEREN_ADMIN_PASSWORD','')
    if not password: raise SystemExit('Set ZEREN_ADMIN_PASSWORD in the secure execution environment.')
    status,_=call('/api/auth/login','POST',{'password':password})
    check('Admin login',status==200)
    copied=next((cookie.value for cookie in jar if cookie.name=='zeren_admin_token'),'')
    status,state=call('/api/state')
    check('Authenticated state',status==200 and isinstance(state,dict) and bool(state.get('match_info',{}).get('match_id')))
    status,_=call('/api/auth/logout','POST',{})
    check('Logout',status==200)
    status,_=call('/api/state',headers={'Authorization':'Bearer '+copied})
    check('Copied token revoked',status==401)
raise SystemExit(1 if failures else 0)
