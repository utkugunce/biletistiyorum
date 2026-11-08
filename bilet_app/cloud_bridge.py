"""Authenticated cloud bridge. A service-role database key never belongs here."""

import json
import os
from pathlib import Path
import urllib.parse
import urllib.request


def call(endpoint, method='GET', payload=None, match_id=None):
    token = os.environ.get('ZEREN_COMPANION_TOKEN', '')
    if len(token) < 32:
        raise ValueError('ZEREN_COMPANION_TOKEN must be configured (at least 32 characters)')
    base = os.environ.get('ZEREN_CLOUD_URL', 'https://biletistiyorum.vercel.app').rstrip('/')
    parsed = urllib.parse.urlparse(base)
    if parsed.scheme != 'https' and parsed.hostname not in {'localhost', '127.0.0.1'}:
        raise ValueError('Cloud bridge requires HTTPS')
    if method == 'GET' and match_id:
        endpoint += ('&' if '?' in endpoint else '?') + urllib.parse.urlencode({'match_id': match_id})
    body = None
    if method != 'GET':
        body = json.dumps({**(payload or {}), **({'match_id': match_id} if match_id else {})}).encode()
    request = urllib.request.Request(base + endpoint, data=body, method=method,
                                    headers={'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json'})
    with urllib.request.urlopen(request, timeout=10) as response:
        return json.loads(response.read().decode())


def match_id_for(folder):
    plan = Path(folder) / 'mac_bilet_plani.json'
    if plan.exists():
        with plan.open(encoding='utf-8') as stream:
            metadata = json.load(stream)
        if metadata.get('cloud_match_id') or metadata.get('match_id'):
            return str(metadata.get('cloud_match_id') or metadata['match_id'])
        title = metadata.get('match_name', '')
        if title:
            matches = call('/api/companion/matches')
            normalize = lambda text: str(text).casefold().replace('kulübü ', '').strip()
            found = [m for m in matches if normalize(m['title']) == normalize(title)]
            if len(found) == 1:
                return found[0]['id']
    if os.environ.get('ZEREN_MATCH_ID'):
        return os.environ['ZEREN_MATCH_ID']
    if Path(folder).resolve() == Path(__file__).resolve().parent.parent:
        return '20261108_kuzeyboru'
    raise ValueError('Bind this folder to its cloud_match_id before cloud synchronization')
