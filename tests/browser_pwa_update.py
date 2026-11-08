"""Real worker upgrade from an old cached admin; local fixtures, no live API."""
import functools
import http.server
import json
import os
from pathlib import Path
import re
import shutil
import threading

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
LEGACY = """
self.addEventListener('install', e => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', e => e.respondWith(
  caches.match(e.request).then(cached => cached || fetch(e.request))));
"""


class Handler(http.server.SimpleHTTPRequestHandler):
    legacy = True
    marker = ''

    def log_message(self, *args):
        pass

    def reply(self, data, kind='text/html'):
        raw = data.encode()
        self.send_response(200)
        self.send_header('Content-Type', kind)
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self):
        path = self.path.split('?')[0]
        if path == '/sw.js':
            script = (ROOT / 'sw.js').read_text(encoding='utf-8')
            # Keep the real worker logic; make optional CDN precaching local-only.
            script = re.sub(r'  "https://[^"\n]+"[,]?\n', '', script)
            return self.reply(LEGACY if self.legacy else script, 'application/javascript')
        if path == '/blank':
            return self.reply('<html><body>Worker update fixture</body></html>')
        if path in ('/admin', '/admin.html'):
            return self.reply((ROOT / 'admin.html').read_text(encoding='utf-8'))
        if path == '/static/app.js':
            return self.reply(self.marker + (ROOT / 'app.js').read_text(encoding='utf-8'), 'application/javascript')
        if path.startswith('/api/'):
            return self.reply(json.dumps({'authenticated': False}), 'application/json')
        return super().do_GET()


server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Handler, directory=str(ROOT)))
threading.Thread(target=server.serve_forever, daemon=True).start()
base = f'http://127.0.0.1:{server.server_port}'
try:
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=os.environ.get('CHROMIUM_EXECUTABLE') or shutil.which('chromium'),
                                    headless=True, args=['--no-sandbox'])
        context = browser.new_context()
        context.route('https://**/*', lambda route: route.fulfill(status=200, body=''))
        page = context.new_page()
        page.goto(base + '/blank')
        page.evaluate("""async () => {
          await navigator.serviceWorker.register('/sw.js');
          await navigator.serviceWorker.ready;
          if (!navigator.serviceWorker.controller) await new Promise(resolve =>
            navigator.serviceWorker.addEventListener('controllerchange', resolve, {once:true}));
          const cache = await caches.open('zeren-bilet-pwa-v4');
          await cache.put('/admin', new Response('<html><body>Legacy admin<script src="/static/app.js"></script></body></html>', {headers:{'Content-Type':'text/html'}}));
          await cache.put('/static/app.js', new Response('window.legacyAdmin = true;', {headers:{'Content-Type':'application/javascript'}}));
        }""")
        page.goto(base + '/admin')
        assert page.evaluate('window.legacyAdmin === true')
        Handler.legacy = False
        page.evaluate("""async () => {
          const reg = await navigator.serviceWorker.getRegistration();
          const switched = new Promise(resolve => navigator.serviceWorker.addEventListener('controllerchange', resolve, {once:true}));
          await reg.update();
          await switched;
        }""")
        page.wait_for_function("async()=> !(await caches.keys()).includes('zeren-bilet-pwa-v4')", timeout=10000)
        page.goto(base + '/admin', wait_until='networkidle')
        assert not page.evaluate('Boolean(window.legacyAdmin)')
        assert page.locator('#adminLoginOverlay').is_visible()
        bundle = page.evaluate("fetch('/static/app.js').then(r => r.text())")
        assert 'data-act="mark-sent"' in bundle
        Handler.marker = 'window.workerFreshAsset = true;\n'
        bundle = page.evaluate("fetch('/static/app.js').then(r => r.text())")
        assert bundle.startswith(Handler.marker), 'A cached app must not hide a newer online bundle'
        context.set_offline(True)
        offline = page.evaluate("fetch('/static/app.js').then(r => r.text())")
        assert offline.startswith(Handler.marker)
        assert page.evaluate("fetch('/api/state').then(r => r.status)") == 503
        print('PASS legacy worker upgrade, latest admin assets, offline asset fallback and API failure')
        browser.close()
finally:
    server.shutdown()
