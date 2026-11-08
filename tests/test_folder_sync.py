"""Filesystem regressions; fixtures never access Supabase or real ticket folders."""

import importlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

APP = Path(__file__).resolve().parents[1] / 'bilet_app'
sys.path.insert(0, str(APP))
import folder_sync
from ticket_inventory import classify_ticket_directory, is_inventory_directory

KEY = '102:3-1'
FILENAME = '102 3 - -1.pdf'
ASSIGNED = {KEY: {'group': 'Test Person', 'request_id': 'ZS-TEST'}}


class FolderSyncTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name).resolve()

    def ticket(self, directory='', content=b'test ticket'):
        path = self.root / directory / FILENAME
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content)
        return path

    def assigned_ticket(self):
        path = self.ticket()
        folder_sync.reconcile_folder(self.root, ASSIGNED, {KEY: path})
        return self.root / 'Test Person' / 'ZS-TEST' / FILENAME

    def journal(self):
        return json.loads((self.root / folder_sync.JOURNAL_NAME).read_text())

    def test_unknown_manual_ticket_is_preserved(self):
        path = self.ticket('Manual/ZS-MANUAL')
        folder_sync.reconcile_folder(self.root, {}, {KEY: path})
        self.assertTrue(path.exists())
        self.assertFalse((self.root / FILENAME).exists())

    def test_companion_entrypoint_recovers_and_rejects_invalid_cloud_state(self):
        import io
        import types
        import sync_helper

        path = self.assigned_ticket()
        fake_server = types.ModuleType('server')
        fake_server._find_ticket_path_map = lambda folder: {KEY: path}
        fake_server.normalize_text = lambda text: text.casefold()

        def response(state):
            return io.BytesIO(json.dumps([{'assigned_seats': state}]).encode())

        with patch.dict(sys.modules, {'server': fake_server}):
            with patch.object(sync_helper.urllib.request, 'urlopen',
                              return_value=response({'explorer_cmd': {}})):
                sync_helper.sync_cloud_assignments_to_folders(self.root)
            self.assertTrue(path.exists(), 'Missing cloud assignments must not mean unassign all')
            with patch.object(sync_helper.urllib.request, 'urlopen',
                              return_value=response({'virtual_assignments': {}})):
                sync_helper.sync_cloud_assignments_to_folders(self.root)
        self.assertFalse(path.exists())
        self.assertTrue((self.root / FILENAME).exists())

    def test_normal_assignment_and_return(self):
        path = self.assigned_ticket()
        self.assertTrue(path.exists())
        folder_sync.reconcile_folder(self.root, {}, {KEY: path})
        self.assertEqual((self.root / FILENAME).read_bytes(), b'test ticket')
        self.assertFalse(path.exists())
        self.assertNotIn(KEY, self.journal()['managed'])

    def test_locked_return_is_retried_after_lock_released(self):
        path = self.assigned_ticket()
        with patch.object(folder_sync, '_move_without_overwrite', side_effect=PermissionError('locked')):
            folder_sync.reconcile_folder(self.root, {}, {KEY: path})
        self.assertIn(KEY, self.journal()['managed'])
        folder_sync.reconcile_folder(self.root, {}, {KEY: path})
        self.assertTrue((self.root / FILENAME).exists())
        self.assertFalse(path.exists())

    def test_locked_return_survives_module_restart(self):
        path = self.assigned_ticket()
        with patch.object(folder_sync, '_move_without_overwrite', side_effect=PermissionError('locked')):
            folder_sync.reconcile_folder(self.root, {}, {KEY: path})
        importlib.reload(folder_sync)
        folder_sync.reconcile_folder(self.root, {}, {})
        self.assertTrue((self.root / FILENAME).exists())

    def test_offline_removal_survives_a_new_python_process(self):
        path = self.assigned_ticket()
        result = subprocess.run([
            sys.executable, '-c',
            'import sys; from pathlib import Path; sys.path.insert(0, sys.argv[1]); '
            'from folder_sync import reconcile_folder; '
            'reconcile_folder(Path(sys.argv[2]), {}, {})',
            str(APP), str(self.root),
        ], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue((self.root / FILENAME).exists())
        self.assertFalse(path.exists())

    def test_switch_match_does_not_move_other_match_manual_ticket(self):
        self.assigned_ticket()
        second = self.root / 'Second Match'
        path = second / 'Manual' / 'ZS-MANUAL' / FILENAME
        path.parent.mkdir(parents=True)
        path.write_bytes(b'other match ticket')
        folder_sync.reconcile_folder(second, {}, {KEY: path})
        self.assertTrue(path.exists())
        self.assertFalse((second / FILENAME).exists())

    def test_two_matches_keep_independent_pending_returns(self):
        path = self.assigned_ticket()
        second = self.root / 'Second Match'
        second.mkdir()
        source = second / FILENAME
        source.write_bytes(b'other match ticket')
        folder_sync.reconcile_folder(second, ASSIGNED, {KEY: source})
        folder_sync.reconcile_folder(self.root, {}, {KEY: path})
        self.assertEqual((self.root / FILENAME).read_bytes(), b'test ticket')
        self.assertTrue((second / 'Test Person' / 'ZS-TEST' / FILENAME).exists())

    def test_reassignment_goes_to_new_request_only(self):
        path = self.assigned_ticket()
        other = {KEY: {'group': 'Test Person', 'request_id': 'ZS-OTHER'}}
        folder_sync.reconcile_folder(self.root, other, {KEY: path})
        self.assertFalse(path.exists())
        self.assertTrue((self.root / 'Test Person' / 'ZS-OTHER' / FILENAME).exists())

    def test_duplicate_scanner_entry_does_not_replace_recorded_owner(self):
        path = self.assigned_ticket()
        manual = self.ticket('Manual', content=b'an unrelated duplicate')
        folder_sync.reconcile_folder(self.root, ASSIGNED, {KEY: manual})
        self.assertTrue(manual.exists())
        self.assertTrue(path.exists())
        self.assertEqual(self.journal()['managed'][KEY]['path'], str(path.relative_to(self.root)))
        folder_sync.reconcile_folder(self.root, {}, {KEY: manual})
        self.assertEqual(manual.read_bytes(), b'an unrelated duplicate')
        self.assertEqual((self.root / FILENAME).read_bytes(), b'test ticket')

    def test_different_destination_is_not_overwritten_and_return_retries(self):
        path = self.assigned_ticket()
        existing = self.ticket(content=b'manual root ticket')
        folder_sync.reconcile_folder(self.root, {}, {KEY: path})
        self.assertEqual(existing.read_bytes(), b'manual root ticket')
        self.assertTrue(path.exists())
        self.assertIn(KEY, self.journal()['managed'])
        existing.unlink()
        folder_sync.reconcile_folder(self.root, {}, {KEY: path})
        self.assertEqual(existing.read_bytes(), b'test ticket')

    def test_manually_replaced_file_is_not_returned(self):
        path = self.assigned_ticket()
        path.write_bytes(b'manually replaced contents')
        folder_sync.reconcile_folder(self.root, {}, {KEY: path})
        self.assertEqual(path.read_bytes(), b'manually replaced contents')
        self.assertFalse((self.root / FILENAME).exists())

    def test_manually_relocated_file_is_not_returned(self):
        path = self.assigned_ticket()
        manual = self.root / 'Manual' / FILENAME
        manual.parent.mkdir()
        path.rename(manual)
        folder_sync.reconcile_folder(self.root, {}, {KEY: manual})
        self.assertTrue(manual.exists())
        self.assertFalse((self.root / FILENAME).exists())

    def test_failed_journal_write_prevents_pdf_move(self):
        source = self.ticket()
        with patch.object(folder_sync, '_save', side_effect=PermissionError('journal read-only')):
            folder_sync.reconcile_folder(self.root, ASSIGNED, {KEY: source})
        self.assertTrue(source.exists())
        self.assertFalse((self.root / 'Test Person' / 'ZS-TEST' / FILENAME).exists())

    def test_move_completed_but_journal_update_failed_can_recover(self):
        source = self.ticket()
        save = folder_sync._save
        calls = 0

        def fail_second_write(root, journal):
            nonlocal calls
            calls += 1
            if calls == 2:
                raise OSError('simulated crash before journal confirmation')
            save(root, journal)

        with patch.object(folder_sync, '_save', side_effect=fail_second_write):
            folder_sync.reconcile_folder(self.root, ASSIGNED, {KEY: source})
        folder_sync.reconcile_folder(self.root, {}, {})
        self.assertEqual(source.read_bytes(), b'test ticket')

    def test_corrupt_journal_fails_closed(self):
        path = self.ticket('Manual')
        (self.root / folder_sync.JOURNAL_NAME).write_text('not json')
        with self.assertRaises(ValueError):
            folder_sync.reconcile_folder(self.root, {}, {KEY: path})
        self.assertTrue(path.exists())

    def test_copied_other_match_journal_is_not_used(self):
        self.assigned_ticket()
        other = self.root / 'Other'
        other.mkdir()
        (other / folder_sync.JOURNAL_NAME).write_text(
            (self.root / folder_sync.JOURNAL_NAME).read_text())
        with self.assertRaises(ValueError):
            folder_sync.reconcile_folder(other, {}, {})

    def test_traversal_and_windows_reserved_names_are_safe(self):
        self.assertEqual(folder_sync.sanitize_filename_component('CON'), '_CON')
        source = self.ticket()
        assignment = {KEY: {'group': '../Elsewhere', 'request_id': '../../outside'}}
        folder_sync.reconcile_folder(self.root, assignment, {KEY: source})
        path = self.root / self.journal()['managed'][KEY]['path']
        self.assertTrue(path.resolve().is_relative_to(self.root))
        self.assertTrue(path.exists())

    def test_symlink_escape_is_rejected(self):
        with tempfile.TemporaryDirectory() as outside:
            link = self.root / 'Test Person'
            try:
                link.symlink_to(outside, target_is_directory=True)
            except OSError:
                self.skipTest('symlinks unavailable')
            source = self.ticket()
            folder_sync.reconcile_folder(self.root, ASSIGNED, {KEY: source})
            self.assertTrue(source.exists())
            self.assertEqual(list(Path(outside).iterdir()), [])


class InventoryTests(unittest.TestCase):
    def test_real_scanner_counts_inventory_and_nested_person_folders(self):
        # Execute the real scanner and parser without starting FastAPI or the
        # global StateManager, which would modify the developer's match folders.
        import ast
        import os
        import re
        import shutil
        import types
        import typing
        from blocks_data import ARENA_ZONES, BLOCKS_DB, CLOSED_BLOCKS, get_block_layout
        from ticket_inventory import assignment_directory_parts

        namespace = {
            **vars(typing), 'Path': Path, 'os': os, 're': re, 'shutil': shutil,
            'json': json, 'IGNORED_DIRS': {'.git', 'bilet_app', '__pycache__'},
            'PLAN_FILENAME': 'mac_bilet_plani.json', 'ASSETS_DIR': APP / 'assets',
            'ARENA_ZONES': ARENA_ZONES, 'BLOCKS_DB': BLOCKS_DB,
            'CLOSED_BLOCKS': CLOSED_BLOCKS, 'get_block_layout': get_block_layout,
            'assignment_directory_parts': assignment_directory_parts,
            'classify_ticket_directory': classify_ticket_directory,
            'normalize_text': lambda text: text.casefold(),
            'extract_pdf_match_info': lambda path: {},
            'state_mgr': types.SimpleNamespace(
                storage={}, undo_stack=[], redo_stack=[],
                ensure_group_in_templates=lambda *args: None,
                get_group_color=lambda *args: '#123456',
                _ensure_match_registered=lambda *args: None,
            ),
        }
        tree = ast.parse((APP / 'server.py').read_text(encoding='utf-8'))
        selected = []
        for node in tree.body:
            if isinstance(node, ast.Assign) and any(
                isinstance(target, ast.Name) and target.id in {'TICKET_REGEX', 'SAHA_REGEX'}
                for target in node.targets
            ):
                selected.append(node)
            if isinstance(node, ast.FunctionDef) and node.name in {
                'parse_ticket_filename', 'load_match_plan', 'save_match_plan',
                'scan_match_folder', 'build_groups_summary', 'format_seat_ranges',
            }:
                selected.append(node)
        exec(compile(ast.Module(body=selected, type_ignores=[]), 'server.py', 'exec'), namespace)
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            paths = ['Havuz', 'Havuz/Person A/ZS-111', '121 BLOK/Person B/Genel', 'Saha Ekibi/ZS-333']
            for seat, directory in enumerate(paths, start=1):
                path = root / directory / f'102 3 - -{seat}.pdf'
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(b'parser fixture')
            result = namespace['scan_match_folder'](root)
            tickets = result['blocks']['102']['tickets']
            self.assertEqual(result['assigned_tickets'], 3)
            self.assertEqual(result['unassigned_tickets'], 1)
            self.assertEqual(tickets['3-2']['group'], 'Person A')
            self.assertEqual(tickets['3-3']['subgroup'], 'Genel')
            self.assertEqual(tickets['3-4']['group'], 'Saha Ekibi')

    def test_inventory_names_match_whole_directory_only(self):
        for name in ['121 BLOK', '102', 'Blok 121', 'SAHA İÇİ', 'Biletler', 'Havuz']:
            with self.subTest(name=name):
                self.assertTrue(is_inventory_directory(name))
        for name in ['Saha Ekibi', 'Blok Sorumlusu', 'Blokaj', 'Sahakyan', 'Havuz Misafirleri']:
            with self.subTest(name=name):
                self.assertFalse(is_inventory_directory(name))

    def test_owner_and_request_survive_inventory_wrappers(self):
        self.assertEqual(classify_ticket_directory(['Havuz', 'Person A', 'ZS-111']),
                         ('Person A', 'ZS-111', 'assigned'))
        self.assertEqual(classify_ticket_directory(['121 BLOK', 'Person A', 'Genel']),
                         ('Person A', 'Genel', 'assigned'))

    def test_inventory_word_in_subgroup_does_not_erase_owner(self):
        for subgroup in ['Genel', 'Havuz', 'Saha Ekibi', '121 BLOK']:
            with self.subTest(subgroup=subgroup):
                self.assertEqual(classify_ticket_directory(['Person A', subgroup]),
                                 ('Person A', subgroup, 'assigned'))

    def test_pure_inventory_remains_unassigned(self):
        self.assertEqual(classify_ticket_directory(['Biletler', '121 BLOK']),
                         ('', '', 'unassigned'))

    def test_diger_status_is_preserved(self):
        self.assertEqual(classify_ticket_directory(['121 BLOK', 'Diğer']),
                         ('Diğer', '', 'diger'))


if __name__ == '__main__':
    unittest.main()
