"""Real Chromium layout/form tests with mocked APIs; never touches live records."""
import functools
import http.server
import json
import os
from pathlib import Path
import shutil
import subprocess
import threading
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
script = '''import {getBaseData,buildFullState} from './api/admin.js';
const s=buildFullState(getBaseData().base_state,{virtual_assignments:{'102:3-1':{group:'Test Person',request_id:'REQ-A'}}});
s.folder='20261108_kuzeyboru';s.folder_name='Zeren Spor - Kuzeyboru';s.match_info={match_id:s.folder,match_name:s.folder_name,match_date:'08.11.2026 16:00'};
s.matches=[{id:s.folder,folder:s.folder,title:s.folder_name,date:s.match_info.match_date}];s.can_undo=false;s.can_redo=false;s.history=[];console.log(JSON.stringify(s));'''
state = json.loads(subprocess.check_output(['node', '--input-type=module', '-e', script], cwd=ROOT))
row = {'request_id': 'REQ-A', 'person': 'Test Person', 'source': 'portal', 'phone': '05321234567',
       'department': 'Test', 'requested_count': 1, 'assigned_count': 1, 'target_block': '102',
       'matched_keys': ['102:3-1'], 'matched_seats': ['3-1'], 'fulfillment_status': 'completed',
       'status_color': '#047857', 'status_badge': 'Koltuklar hazır', 'progress_pct': 100,
       'whatsapp_sent': False, 'suggested_group': 'Test Person', 'suggested_subgroup': 'Test'}
access = 'ZS-00000000-0000-0000-0000-000000000001.' + 'a' * 64
submissions, errors, sent_actions = [], [], []

class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass
server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(QuietHandler, directory=str(ROOT)))
threading.Thread(target=server.serve_forever, daemon=True).start()
base = f'http://127.0.0.1:{server.server_port}'

def api(route):
    request = route.request
    path = request.url.split('/api/', 1)[1].split('?')[0]
    data, status = {}, 200
    if path == 'auth/check': data = {'authenticated': True}
    elif path == 'state': data = state
    elif path in ['excel/summary', 'excel/reload']: data = {'ok': True, 'requests': [row], 'total_requested': 1, 'total_assigned': 1, 'total_pending': 0}
    elif path == 'status': data = {'companion': None, 'commands': []}
    elif path == 'dispatch/mark-sent':
        sent_actions.append(request.post_data_json)
        row['whatsapp_sent'] = request.post_data_json['sent']
        data = {'ok': True, 'success': True}
    elif path == 'dispatch/list': data = {'recipients': [], 'pending_count': 0}
    elif path == 'portal/matches': data = [{**m, 'blocks': ['102','121','SAHA']} for m in state['matches']]
    elif path == 'portal/staff': data = {'groups': [{'group': 'Test', 'members': ['Test Person']}]}
    elif path == 'portal/request' and request.method == 'POST':
        submissions.append({'payload': request.post_data_json, 'key': request.headers.get('idempotency-key')})
        data = {**request.post_data_json, 'id': access.split('.')[0], 'tracking_token': access}
    elif path == 'portal/my-requests':
        if request.headers.get('x-tracking-token') != access:
            data, status = {'detail': 'Güvenli takip bağlantısı gerekli.'}, 401
        else: data = []
    route.fulfill(status=status, content_type='application/json', body=json.dumps(data))

def check_request_tab_spacing(page):
    result = page.evaluate("""() => {
      const tabs = [...document.querySelectorAll('.sidebar-nav-tab')];
      const overlap = (a,b) => Math.min(a.right,b.right)>Math.max(a.left,b.left)+1 && Math.min(a.bottom,b.bottom)>Math.max(a.top,b.top)+1;
      return tabs.flatMap(tab => {
        const bounds = tab.getBoundingClientRect();
        const label = tab.querySelector('.sidebar-tab-label');
        const other = [...tab.querySelectorAll('i,.tab-badge')];
        const parts = [label,...other];
        return parts.some(el => {
          const r=el.getBoundingClientRect();
          return r.left<bounds.left-1 || r.right>bounds.right+1 || r.top<bounds.top-1 || r.bottom>bounds.bottom+1 || el.scrollWidth>el.clientWidth+1;
        }) || other.some(el=>overlap(label.getBoundingClientRect(),el.getBoundingClientRect())) ? [tab.id] : [];
      });
    }""")
    assert not result, result


try:
    with sync_playwright() as p:
        arguments = ['--no-sandbox']
        if os.environ.get('BROWSER_PROXY_SPKI'):
            arguments.append('--ignore-certificate-errors-spki-list=' + os.environ['BROWSER_PROXY_SPKI'])
        browser = p.chromium.launch(executable_path=os.environ.get('CHROMIUM_EXECUTABLE') or shutil.which('chromium'), headless=True, args=arguments)
        context = browser.new_context(viewport={'width': 1440, 'height': 1000}, service_workers='block')
        context.route('**/api/**', api)
        page = context.new_page()
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.goto(base + '/admin.html', wait_until='networkidle')
        for width in [1920, 1440, 1366, 1280, 768, 430, 390, 360]:
            page.set_viewport_size({'width': width, 'height': 1000 if width > 768 else 844})
            page.wait_for_timeout(150)
            result = page.evaluate('''()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,
              outside:[...document.querySelectorAll('.topbar button,.topbar select,.block-toolbar button,.block-toolbar select')].filter(e=>{const r=e.getBoundingClientRect();return r.width&&r.height&&(r.left< -1||r.right>innerWidth+1)}).map(e=>e.id),
              toolbarBottom:document.querySelector('.topbar').getBoundingClientRect().bottom,
              clipped:[...document.querySelectorAll('.topbar button,.topbar select')].filter(e=>{const r=e.getBoundingClientRect(),h=document.querySelector('.topbar').getBoundingClientRect();return r.width&&r.height&&r.bottom>h.bottom+1}).map(e=>e.id)})''')
            assert result['scroll'] <= width, result
            assert not result['outside'], result
            assert not result['clipped'], result
            page.locator('#btnMoreActions').click()
            box = page.locator('#moreActionsMenu').bounding_box()
            assert box and box['x'] >= -1 and box['x'] + box['width'] <= width + 1, box
            page.locator('#btnMoreActions').click()
            if os.environ.get('UI_SCREENSHOT_DIR') and width in (390, 1440):
                directory = Path(os.environ['UI_SCREENSHOT_DIR']); directory.mkdir(parents=True, exist_ok=True)
                page.screenshot(path=str(directory / f'admin-{width}.png'), full_page=True)
            assert page.locator('#matchDateBadge').is_visible()
            assert '08.11.2026' not in page.locator('#selectMatchSwitcher option:checked').inner_text()
            if width <= 768:
                page.locator('#tabBtnMobileSidebar').click()
            page.locator('#badgeExcelPendingCount').evaluate("el=>el.textContent='108'")
            page.locator('#badgeExcelSentCount').evaluate("el=>el.textContent='17'")
            check_request_tab_spacing(page)
            if os.environ.get('UI_SCREENSHOT_DIR') and width == 390:
                page.screenshot(path=str(Path(os.environ['UI_SCREENSHOT_DIR']) / 'sidebar-390.png'), full_page=True)
            if width <= 768:
                page.keyboard.press('Escape')
            print('PASS admin controls, menu, match date and request tab spacing', width)
        page.set_viewport_size({'width': 1440, 'height': 1000})
        mark = page.locator('[data-act="mark-sent"]')
        assert mark.is_visible()
        assert mark.inner_text() == 'Gönderildi olarak işaretle'
        mark.click()
        page.locator('#tabBtnSent').click()
        undo = page.locator('[data-act="mark-sent"]')
        assert undo.is_visible()
        assert undo.inner_text() == 'Gönderim işaretini kaldır'
        undo.click()
        page.locator('#tabBtnExcel').click()
        assert mark.is_visible()
        assert sent_actions == [{'request_id':'REQ-A','person':'Test Person','sent':True}, {'request_id':'REQ-A','person':'Test Person','sent':False}]
        print('PASS visible request sent action, sent tab and undo using the request identifier')
        page.set_viewport_size({'width': 390, 'height': 844})
        page.locator('#tabBtnMobileSidebar').click()
        assert mark.is_visible()
        assert page.locator('#sidebarColumn').is_visible()
        page.keyboard.press('Escape')
        assert not page.locator('#sidebarColumn').is_visible()
        page.locator('#btnNewMatchModal').click()
        page.wait_for_timeout(100)
        assert page.locator('#newMatchModalBackdrop').get_attribute('aria-hidden') == 'false'
        page.keyboard.press('Escape')
        assert not page.locator('#newMatchModalBackdrop').is_visible()
        page.locator('.seat-cell').first.focus()
        page.keyboard.press('Enter')
        assert page.locator('.seat-cell.selected').count() == 1
        page.keyboard.press('Escape')
        assert page.locator('.seat-cell.selected').count() == 0
        print('PASS mobile drawer, modal Escape and keyboard seat selection')
        page.set_viewport_size({'width': 1440, 'height': 1000})
        page.locator('#tabBtnDistribution').click()
        page.locator('#inputSearchGroups').fill('no-such-group-at-all')
        assert 'bulunamadı' in page.locator('#groupsSummaryList').inner_text()
        page.locator('#inputSearchGroups').fill('')
        page.evaluate("""() => {
          const payload = '<img src=x onerror="window.untrustedExecuted=true">';
          appState.groups_summary[0].display_name = payload;
          appState.groups_summary[0].subgroups[0].display = payload;
          renderGroupsSummary();
          appState.blocks[currentBlockId].tickets['3-1'].group = payload;
          renderSeatingStage();
        }""")
        page.wait_for_timeout(100)
        assert not page.evaluate('Boolean(window.untrustedExecuted)')
        assert page.locator('#groupsSummaryList img').count() == 0
        print('PASS empty distribution search and untrusted labels rendered as text')
        page.set_viewport_size({'width': 390, 'height': 844})

        page.goto(base + '/', wait_until='networkidle')
        assert not page.locator('#selectedPersonBadge').is_visible()
        assert not page.locator('#selectStaffDropdown').is_visible()
        assert not page.locator('#btnClearStaffSearch').is_visible()
        assert not page.locator('.staff-directory').get_attribute('open')
        if os.environ.get('UI_SCREENSHOT_DIR'):
            page.screenshot(path=str(Path(os.environ['UI_SCREENSHOT_DIR']) / 'portal-390.png'), full_page=True)
        assert page.locator('#selectTargetBlock option').evaluate_all('(items)=>items.map(e=>e.value)') == ['102','121','SAHA','']
        field = page.locator('#inputTicketCount')
        field.fill(''); field.press_sequentially('30'); field.blur()
        assert field.input_value() == '30'
        page.locator('#inputPersonName').fill('Test Person')
        page.locator('#inputPhoneNumber').fill('+90 532 123 45 67')
        page.locator('#btnSubmitRequest').click()
        page.wait_for_timeout(200)
        assert submissions[-1]['payload']['requested_count'] == 30
        assert len(submissions[-1]['key']) >= 32
        assert page.locator('#modalRequestSuccess').is_visible()
        page.locator('#btnTrackMyRequest').click()
        page.wait_for_timeout(100)
        assert not page.locator('#modalRequestSuccess').is_visible()
        assert page.locator('#inputTrackQuery').input_value() == access
        print('PASS portal hidden controls, 30 tickets, idempotent submission and secure tracking')
        assert not errors, errors
        context.route('**/api/auth/check', lambda route: route.abort())
        page.goto(base + '/admin.html', wait_until='networkidle')
        assert page.locator('#adminLoginOverlay').is_visible()
        assert not errors, errors
        print('PASS failed authentication check preserves the login screen without script errors')
        browser.close()
finally:
    server.shutdown()
