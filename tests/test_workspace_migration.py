"""Workspace migration uses only temporary repositories and fake PDFs."""
import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

SCRIPT = Path(__file__).resolve().parents[1] / 'scripts/migrate_windows_workspace.py'
spec = importlib.util.spec_from_file_location('workspace_migration', SCRIPT)
migration = importlib.util.module_from_spec(spec)
spec.loader.exec_module(migration)


class WorkspaceMigrationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.source = self.root / 'downloads' / '121 BLOK'
        self.source.mkdir(parents=True)
        subprocess.run(['git', 'init', '-q', str(self.source)], check=True)
        self.write(self.source / 'bilet_app/server.py', '# test application')
        subprocess.run(['git', 'add', 'bilet_app/server.py'], cwd=self.source, check=True)
        self.active = self.source.parent / 'Zeren_Bilet_Maclar' / 'Kuzeyboru'
        self.ticket = self.active / 'Test Person/ZS-TEST/102 3 - -1.pdf'
        self.write(self.ticket, 'fake PDF data')
        self.journal = {'version': 1, 'root': str(self.active), 'managed': {
            '102:3-1': {'path': 'Test Person/ZS-TEST/102 3 - -1.pdf', 'sha256': migration.digest(self.ticket)}
        }, 'commands': {'test-command': {'done': True}}}
        self.write_json(self.active / migration.JOURNAL, self.journal)
        self.storage = {'last_folder': str(self.active), 'admin_password_hash': 'test-only-hash',
                        'admin_tokens': {'test-only-hash': 123},
                        'matches': [{'folder': str(self.active)}, {'folder': str(self.source)}]}
        self.write_json(self.source / 'bilet_app/data/storage.json', self.storage)
        self.write(self.source / 'Old Person/121 1 - -1.pdf', 'legacy fake PDF')
        self.write(self.source / 'tickets/121 1 - -2.pdf', 'program pool PDF')
        self.write(self.source / '.pytest_cache/cache', 'disposable cache')
        self.destination = self.root / 'projects/biletistiyorum'

    def write(self, path, content):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding='utf-8')

    def write_json(self, path, data):
        self.write(path, json.dumps(data))

    def preview(self):
        return migration.plan_migration(self.source, self.destination, stamp='test-run')

    def apply(self):
        plan = self.preview()
        return plan, migration.apply_migration(plan, check_service=False)

    def test_preview_does_not_write_or_change_sources(self):
        before = {str(p): p.read_bytes() for p in self.source.rglob('*') if p.is_file()}
        plan = self.preview()
        self.assertEqual(plan['legacy'], ['Old Person'])
        self.assertFalse(self.destination.parent.exists())
        self.assertEqual(before, {str(p): p.read_bytes() for p in self.source.rglob('*') if p.is_file()})

    def test_verified_copy_rebinds_active_journal_and_preserves_credentials(self):
        plan, report = self.apply()
        active = plan['new_matches'] / 'Kuzeyboru'
        new_storage = migration.read_json(self.destination / 'bilet_app/data/storage.json')
        self.assertEqual(new_storage['last_folder'], str(active))
        self.assertEqual(new_storage['matches'][1]['folder'], str(plan['archive']))
        self.assertEqual(new_storage['admin_tokens'], self.storage['admin_tokens'])
        self.assertEqual(new_storage['admin_password_hash'], self.storage['admin_password_hash'])
        new_journal = migration.read_json(active / migration.JOURNAL)
        self.assertEqual(new_journal['root'], str(active))
        self.assertEqual(new_journal['managed'], self.journal['managed'])
        self.assertEqual(new_journal['commands'], self.journal['commands'])
        self.assertEqual((active / 'Test Person/ZS-TEST/102 3 - -1.pdf').read_bytes(), self.ticket.read_bytes())
        self.assertTrue((plan['archive'] / 'Old Person/121 1 - -1.pdf').is_file())
        self.assertFalse((self.destination / 'Old Person').exists())
        self.assertTrue((self.destination / 'tickets/121 1 - -2.pdf').is_file())
        self.assertFalse((self.destination / '.pytest_cache').exists())
        self.assertEqual(migration.read_json(self.source / 'bilet_app/data/storage.json'), self.storage)
        self.assertEqual(migration.read_json(self.active / migration.JOURNAL), self.journal)
        self.assertTrue(migration.read_json(report)['completed'])
        subprocess.run(['git', 'status', '--porcelain'], cwd=self.destination, capture_output=True, check=True)

    def test_existing_destination_is_never_overwritten(self):
        self.destination.mkdir(parents=True)
        self.write(self.destination / 'keep.txt', 'keep')
        with self.assertRaisesRegex(ValueError, 'already exists'):
            self.preview()
        self.assertEqual((self.destination / 'keep.txt').read_text(), 'keep')

    def test_existing_match_destination_is_never_merged(self):
        (self.destination.parent / 'Zeren_Bilet_Maclar').mkdir(parents=True)
        with self.assertRaisesRegex(ValueError, 'already exists'):
            self.preview()

    def test_running_service_blocks_all_writes(self):
        plan = self.preview()
        with patch.object(migration.socket, 'socket') as probe:
            probe.return_value.__enter__.return_value.connect_ex.return_value = 0
            with self.assertRaisesRegex(ValueError, 'halen acik'):
                migration.apply_migration(plan)
        self.assertFalse(self.destination.parent.exists())

    def test_invalid_journal_prevents_publication_and_preserves_originals(self):
        broken = {**self.journal, 'root': str(self.source)}
        self.write_json(self.active / migration.JOURNAL, broken)
        with self.assertRaisesRegex(ValueError, 'different folder'):
            self.apply()
        self.assertFalse(self.destination.exists())
        self.assertEqual(migration.read_json(self.active / migration.JOURNAL), broken)
        self.assertTrue(self.ticket.exists())

    def test_a_managed_program_root_is_never_reorganized_internally(self):
        self.write_json(self.source / migration.JOURNAL, {'version': 1, 'root': str(self.source), 'managed': {}})
        plan, _ = self.apply()
        self.assertEqual(plan['legacy'], [])
        self.assertTrue((self.destination / 'Old Person/121 1 - -1.pdf').exists())
        self.assertEqual(migration.read_json(self.destination / migration.JOURNAL)['root'], str(self.destination))

    def test_active_original_root_retains_pdf_relative_paths(self):
        self.storage['last_folder'] = str(self.source)
        self.write_json(self.source / 'bilet_app/data/storage.json', self.storage)
        plan, _ = self.apply()
        self.assertFalse(plan['legacy'])
        self.assertTrue((self.destination / 'Old Person/121 1 - -1.pdf').exists())
        self.assertEqual(migration.read_json(self.destination / 'bilet_app/data/storage.json')['last_folder'], str(self.destination))

    def test_corrupted_copy_never_becomes_the_live_workspace(self):
        original_digest = migration.digest
        def fail_staging(path):
            value = original_digest(path)
            return 'broken' if '.bilet-workspace-' in str(path) else value
        with patch.object(migration, 'digest', side_effect=fail_staging):
            with self.assertRaisesRegex(ValueError, 'verification failed'):
                self.apply()
        self.assertFalse(self.destination.exists())
        self.assertTrue(self.ticket.exists())

    def test_linked_person_folder_is_rejected(self):
        outside = self.root / 'external'
        self.write(outside / 'test.pdf', 'external')
        try:
            (self.source / 'Linked Person').symlink_to(outside, target_is_directory=True)
        except OSError:
            self.skipTest('Creating a symlink is unavailable for this user')
        with self.assertRaisesRegex(ValueError, 'Linked directory'):
            self.preview()


if __name__ == '__main__':
    unittest.main()
