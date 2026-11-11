import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
APP_DIR = ROOT / "bilet_app"
if str(APP_DIR) not in sys.path:
    sys.path.insert(0, str(APP_DIR))

import portal_storage  # noqa: E402


class PhoneMatchingTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.tmp_path = Path(self.tmp.name)
        self.phonebook_path = self.tmp_path / "phonebook.json"
        self.requests_path = self.tmp_path / "portal_requests.json"
        self.requests_path.write_text("[]", encoding="utf-8")

        self.patchers = [
            mock.patch.object(portal_storage, "PHONEBOOK_FILE", self.phonebook_path),
            mock.patch.object(portal_storage, "PORTAL_REQUESTS_FILE", self.requests_path),
            mock.patch.object(portal_storage, "supabase_upsert_request", lambda *args, **kwargs: None),
        ]
        for p in self.patchers:
            p.start()

    def tearDown(self):
        for p in reversed(self.patchers):
            p.stop()
        self.tmp.cleanup()

    def test_ambiguous_partial_name_returns_empty_while_unique_matches_resolve(self):
        portal_storage.save_phonebook({
            "Aysu Balcı": "+90 542 433 90 57",
            "Mehmet Antep": "+90 538 356 24 40",
            "Mehmet Yılmaz": "+90 532 111 22 33",
            "Lazar Ilınčıć": "+90 555 000 11 22",
        })
        self.assertEqual(portal_storage.get_person_phone("Mehmet"), "")
        self.assertEqual(portal_storage.get_person_phone("Mehmet Antep"), "+90 538 356 24 40")
        self.assertEqual(portal_storage.get_person_phone("Lazar Ilincic"), "+90 555 000 11 22")
        self.assertEqual(portal_storage.get_person_phone("Aysu"), "+90 542 433 90 57")

    def test_find_phone_owner_detects_other_person_without_matching_self(self):
        portal_storage.save_phonebook({
            "Aysu Balcı": "+90 542 433 90 57",
            "Çağlar Oskay": "+90 532 548 99 11",
        })
        self.assertEqual(portal_storage.find_phone_owner("05424339057", exclude_person="Çağlar Oskay"), "Aysu Balcı")
        self.assertEqual(portal_storage.find_phone_owner("05424339057", exclude_person="Aysu Balcı"), "")

    def test_save_person_phone_updates_existing_key_without_duplication(self):
        portal_storage.save_phonebook({"Aysu Balcı": "+90 542 000 00 00"})
        portal_storage.save_person_phone("aysu balci", "+90 542 433 90 57")
        pb = portal_storage.load_phonebook()
        self.assertEqual(list(pb.keys()), ["Aysu Balcı"])
        self.assertEqual(pb["Aysu Balcı"], "+90 542 433 90 57")

    def test_create_portal_request_never_overwrites_phonebook_with_other_staff_phone(self):
        portal_storage.save_phonebook({
            "Aysu Balcı": "+90 542 433 90 57",
            "Çağlar Oskay": "+90 532 548 99 11",
        })
        portal_storage.create_portal_request({
            "match_name": "Zeren Spor Kulübü – Eczacıbaşı",
            "person": "Çağlar Oskay",
            "phone": "05424339057",
            "requested_count": 2,
            "target_block": "121",
        })
        portal_storage.create_portal_request({
            "match_name": "Zeren Spor Kulübü – Eczacıbaşı",
            "person": "Yeni Misafir",
            "phone": "05424339057",
            "requested_count": 1,
            "target_block": "102",
        })
        pb = portal_storage.load_phonebook()
        self.assertEqual(pb["Çağlar Oskay"], "+90 532 548 99 11")
        self.assertNotIn("Yeni Misafir", pb)


if __name__ == "__main__":
    unittest.main()
