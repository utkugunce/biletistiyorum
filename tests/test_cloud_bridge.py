import ast
import io
import json
import os
from pathlib import Path
import sys
import tempfile
import time
import types
import typing
import unittest
from unittest.mock import patch, Mock

APP = Path(__file__).resolve().parents[1] / 'bilet_app'
sys.path.insert(0, str(APP))
import cloud_bridge
import folder_sync
import sync_helper


class CompanionTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.filename = '102 3 - -1.pdf'
        source = self.root / self.filename
        source.write_bytes(b'fixture PDF')
        self.assignments = {'102:3-1': {'group': 'Test Person', 'request_id': 'ZS-TEST'}}
        folder_sync.reconcile_folder(self.root, self.assignments, {'102:3-1': source})
        self.server = types.ModuleType('server')
        self.server._find_ticket_path_map = lambda folder: {'102:3-1': next(folder.rglob(self.filename))}
        self.desktop = types.ModuleType('desktop_helper')
        self.desktop.open_folder_on_user_desktop = Mock(return_value=True)
        self.commands = [{'id': 'command-1', 'match_id': 'fixture', 'ts': time.time()*1000,
                          'group': 'Test Person', 'request_id': 'ZS-TEST'}]

    def run_sync(self, cloud):
        with patch.dict(sys.modules, {'server': self.server, 'desktop_helper': self.desktop}), \
             patch.object(sync_helper, 'match_id_for', return_value='fixture'), \
             patch.object(sync_helper, 'call', side_effect=cloud):
            sync_helper.sync_cloud_assignments_to_folders(self.root)

    def state(self, match='fixture'):
        return [{'assigned_seats': {'match_id': match, 'virtual_assignments': self.assignments,
                                    'explorer_commands': self.commands}}]

    def test_command_is_not_opened_twice_after_a_lost_acknowledgement(self):
        failed = False
        acknowledgements = []
        def cloud(endpoint, method='GET', payload=None, **kwargs):
            nonlocal failed
            if endpoint.endswith('/state'):
                return self.state()
            if payload.get('command_id'):
                acknowledgements.append(payload)
                if not failed:
                    failed = True
                    raise OSError('lost acknowledgement')
            return {'ok': True}
        self.run_sync(cloud)
        self.run_sync(cloud)
        self.desktop.open_folder_on_user_desktop.assert_called_once()
        self.assertEqual(len(acknowledgements), 2)
        self.assertTrue(all(item['success'] for item in acknowledgements))

    def test_wrong_match_state_cannot_move_a_file_or_open_a_command(self):
        self.run_sync(lambda *args, **kwargs: self.state('other-match'))
        self.desktop.open_folder_on_user_desktop.assert_not_called()
        self.assertTrue((self.root / 'Test Person/ZS-TEST' / self.filename).exists())

    def test_missing_pdf_reports_failure_instead_of_opening_root(self):
        (self.root / 'Test Person/ZS-TEST' / self.filename).unlink()
        self.server._find_ticket_path_map = lambda folder: {}
        reports = []
        def cloud(endpoint, method='GET', payload=None, **kwargs):
            if endpoint.endswith('/state'):
                return self.state()
            reports.append(payload)
            return {'ok': True}
        self.run_sync(cloud)
        self.desktop.open_folder_on_user_desktop.assert_not_called()
        self.assertFalse(next(r for r in reports if r.get('command_id'))['success'])

    def test_direct_explorer_never_falls_back_to_another_request_folder(self):
        class HTTPError(Exception):
            def __init__(self, status_code, detail):
                self.status_code = status_code
        source = ast.parse((APP / 'server.py').read_text())
        function = next(n for n in source.body if isinstance(n, ast.FunctionDef) and n.name == 'api_open_explorer')
        function.decorator_list = []
        namespace = {'Path': Path, 'Optional': typing.Optional, 'OpenExplorerRequest': object,
                     'HTTPException': HTTPError, 'os': os, 're': __import__('re'),
                     'state_mgr': types.SimpleNamespace(active_folder=self.root),
                     'normalize_text': lambda s: s.casefold()}
        exec(compile(ast.Module(body=[function], type_ignores=[]), 'server.py', 'exec'), namespace)
        with patch.dict(os.environ, {'ZEREN_COMPANION_TOKEN': ''}), \
             patch.dict(sys.modules, {'desktop_helper': self.desktop}), \
             patch.object(sync_helper, 'sync_cloud_assignments_to_folders'):
            with self.assertRaises(HTTPError) as caught:
                namespace['api_open_explorer'](group='Test Person', request_id='ZS-MISSING')
            self.assertEqual(caught.exception.status_code, 409)
            self.desktop.open_folder_on_user_desktop.assert_not_called()
            result = namespace['api_open_explorer'](group='Test Person', request_id='ZS-TEST')
            self.assertEqual(Path(result['opened']), self.root / 'Test Person' / 'ZS-TEST')

    def test_inventory_metadata_has_no_absolute_paths_and_preserves_manual_owner(self):
        from ticket_inventory import build_inventory
        path = self.root / 'Manual' / 'Genel' / self.filename
        path.parent.mkdir(parents=True)
        path.write_bytes(b'fixture')
        inventory = build_inventory(self.root, {'102:3-1': path}, {})
        self.assertNotIn(str(self.root), json.dumps(inventory))
        owner = inventory['102']['tickets']['3-1']['external_owner']
        self.assertEqual(owner['group'], 'Manual')
        self.assertEqual(owner['subgroup'], 'Genel')

    def test_bridge_uses_only_companion_bearer_not_service_role_credentials(self):
        captured = []
        def open_request(request, **kwargs):
            captured.append(request)
            return io.BytesIO(b'[]')
        with patch.dict(os.environ, {'ZEREN_COMPANION_TOKEN': 'x'*64,
                                      'SUPABASE_SERVICE_ROLE_KEY': 'must-not-be-used'}), \
             patch.object(cloud_bridge.urllib.request, 'urlopen', side_effect=open_request):
            cloud_bridge.call('/api/companion/state', match_id='fixture')
        self.assertEqual(captured[0].get_header('Authorization'), 'Bearer '+'x'*64)
        self.assertIsNone(captured[0].get_header('Apikey'))
        self.assertIn('match_id=fixture', captured[0].full_url)
        self.assertNotIn('x'*64, captured[0].full_url)

    def test_unbound_folder_fails_closed(self):
        with patch.dict(os.environ, {}, clear=True):
            with self.assertRaises(ValueError):
                cloud_bridge.match_id_for(self.root)


class LocalSessionTests(unittest.TestCase):
    def manager(self):
        import hashlib
        import secrets
        namespace = {**vars(typing), 'Path': Path, 'hashlib': hashlib, 'secrets': secrets,
                     'time': time, 'os': os}
        source = ast.parse((APP / 'server.py').read_text())
        cls = next(node for node in source.body if isinstance(node, ast.ClassDef) and node.name == 'StateManager')
        exec(compile(ast.Module(body=[cls], type_ignores=[]), 'server.py', 'exec'), namespace)
        manager = namespace['StateManager'].__new__(namespace['StateManager'])
        manager.storage = {'admin_password': 'test-only-password', 'admin_tokens': []}
        manager._save_storage = lambda *args: None
        return manager

    def test_local_password_is_hashed_and_legacy_tokens_are_replaced(self):
        manager = self.manager()
        self.assertTrue(manager.check_admin_password('test-only-password'))
        self.assertNotIn('admin_password', manager.storage)
        self.assertIn('admin_password_hash', manager.storage)
        token = manager.create_admin_session()
        self.assertTrue(manager.verify_admin_token(token))
        self.assertNotIn(token, manager.storage['admin_tokens'])
        manager.revoke_admin_token(token)
        self.assertFalse(manager.verify_admin_token(token))

    def test_local_password_change_revokes_sessions_and_supports_unicode(self):
        manager = self.manager()
        token = manager.create_admin_session()
        manager.set_admin_password('Şifre-örnek-123456')
        self.assertFalse(manager.verify_admin_token(token))
        self.assertTrue(manager.check_admin_password('Şifre-örnek-123456'))

    def test_local_expired_session_is_rejected(self):
        manager = self.manager()
        token = manager.create_admin_session()
        for key in manager.storage['admin_tokens']:
            manager.storage['admin_tokens'][key] = time.time()-1
        self.assertFalse(manager.verify_admin_token(token))


if __name__ == '__main__':
    unittest.main()

class LocalProxyTests(unittest.IsolatedAsyncioTestCase):
    async def test_authenticated_local_state_uses_same_scoped_cloud_state(self):
        result, cloud, next_handler, sync = await self.invoke('/api/state', 'GET')
        self.assertEqual(result.status_code, 200)
        self.assertEqual(result.data['match_info']['match_id'], 'fixture')
        self.assertEqual(result.data['folder'], '/test/match')
        self.assertEqual(cloud.call_args.args[3], 'fixture')
        next_handler.assert_not_called()
        sync.assert_not_called()

    async def test_local_mutation_reconciles_only_after_cloud_acceptance(self):
        result, cloud, next_handler, sync = await self.invoke('/api/assign', 'POST')
        self.assertEqual(result.status_code, 200)
        sync.assert_called_once()
        next_handler.assert_not_called()

    async def test_rejected_cloud_mutation_never_moves_local_files(self):
        import urllib.error
        problem = urllib.error.HTTPError('https://cloud.test', 409, 'conflict', {}, io.BytesIO(b'{"detail":"seat conflict"}'))
        result, cloud, next_handler, sync = await self.invoke('/api/assign', 'POST', error=problem)
        self.assertEqual(result.status_code, 409)
        self.assertEqual(result.data['detail'], 'seat conflict')
        sync.assert_not_called()
        next_handler.assert_not_called()

    async def test_invalid_local_session_cannot_use_companion_privileges(self):
        result, cloud, next_handler, sync = await self.invoke('/api/state', 'GET', authenticated=False)
        self.assertEqual(result.status_code, 401)
        cloud.assert_not_called()
        sync.assert_not_called()

    async def invoke(self, path, method, authenticated=True, error=None):
        from unittest.mock import AsyncMock
        class Reply:
            def __init__(self, status_code=200, content=None):
                self.status_code = status_code
                self.data = content
        async def thread(function, *args):
            return function(*args)
        manager = types.SimpleNamespace(active_folder=Path('/test/match'), storage={'matches': []},
                                        verify_admin_token=lambda token: authenticated)
        namespace = {'Request': object, 'os': os, 'json': json, 're': __import__('re'),
                     'JSONResponse': Reply, 'run_in_threadpool': thread, 'state_mgr': manager}
        source = ast.parse((APP / 'server.py').read_text())
        function = next(n for n in source.body if isinstance(n, ast.AsyncFunctionDef) and n.name == 'admin_auth_middleware')
        function.decorator_list = []
        exec(compile(ast.Module(body=[function], type_ignores=[]), 'server.py', 'exec'), namespace)
        request = types.SimpleNamespace(url=types.SimpleNamespace(path=path), method=method,
            headers={}, cookies={'zeren_admin_token': 'test'}, json=AsyncMock(return_value={'seats': []}), base_url='http://localhost/')
        next_handler = AsyncMock()
        body = {'blocks': {}, 'match_info': {'match_id': 'fixture'}, 'folder': 'fixture'}
        with patch.dict(os.environ, {'ZEREN_COMPANION_TOKEN': 'x'*64}), \
             patch.object(cloud_bridge, 'match_id_for', return_value='fixture'), \
             patch.object(cloud_bridge, 'call', return_value=body, side_effect=error) as cloud, \
             patch.object(sync_helper, 'sync_cloud_assignments_to_folders') as sync:
            result = await namespace['admin_auth_middleware'](request, next_handler)
            return result, cloud, next_handler, sync
