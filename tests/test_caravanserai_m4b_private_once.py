"""Pure offline tests. Network and remote mutations prohibited."""
import hashlib
import importlib.util
import io
import os
import pathlib
import socket
import tempfile
import unittest
from unittest.mock import patch

MODULE = pathlib.Path(__file__).resolve().parents[1] / "ops" / "caravanserai_m4b_private_once.py"
spec = importlib.util.spec_from_file_location("caravanserai_once", MODULE)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)


class Tests(unittest.TestCase):
    def setUp(self):
        self.guard = patch.object(socket, "socket", side_effect=AssertionError("network_disabled"))
        self.guard.start()

    def tearDown(self):
        self.guard.stop()

    def test_exact_six_fixed_manifest(self):
        self.assertEqual(mod.PARTS, (37310395, 37444721, 39925212, 38929494, 37993062, 18733474))
        self.assertEqual(sum(mod.PARTS), 210336358)
        self.assertEqual(mod.JOB, "8e27c3f1-897a-4671-b95f-70547a004fe9")
        self.assertEqual(mod.FOLDER, "1PyURHFMnsHsF6JLMvtbAq20Gl021KFCa")

    def test_no_auth_token_no_network(self):
        with patch.dict(os.environ, {}, clear=True):
            with self.assertRaisesRegex(RuntimeError, "missing_drive_oauth"):
                mod.credentials()

    def test_detect_broad_sharing_before_upload(self):
        def fake_google(_, endpoint, *args, **kwargs):
            if "permissions" in endpoint:
                return {"permissions": [{"type": "anyone", "role": "reader"}]}
            return {"id": mod.FOLDER, "mimeType": "application/vnd.google-apps.folder"}
        with patch.object(mod, "google", side_effect=fake_google):
            with self.assertRaisesRegex(RuntimeError, "not_owner_only"):
                mod.private("token", mod.FOLDER, folder=True)

    def test_checksum_readback_success_and_corruption_detection(self):
        data = b"private m4b test fixture" * 19
        sha = hashlib.sha256(data).hexdigest()
        md5 = hashlib.md5(data).hexdigest()
        meta = {"id": "file", "name": "m4b-001.m4b", "size": len(data), "md5Checksum": md5,
                "parents": [mod.FOLDER], "trashed": False}
        with patch.object(mod, "google", return_value=meta), patch.object(mod, "private"), \
             patch.object(mod, "request", side_effect=lambda *a, **k: io.BytesIO(data)):
            row = mod.readback("token", "file", "m4b-001.m4b", len(data), sha, md5)
            self.assertEqual(row["sha256"], sha)
            with self.assertRaisesRegex(RuntimeError, "drive_sha256_mismatch"):
                mod.readback("token", "file", "m4b-001.m4b", len(data), hashlib.sha256(b"bad").hexdigest(), md5)

    def _fake_run(self, mismatch=False):
        saved = []
        def source(key, name, size, path):
            path.write_bytes(b"test")
            return "a" * 64, "b" * 32
        def found(token, name):
            i = int(name[4:7])
            return [{"id": f"file-{i}", "name": name, "size": mod.PARTS[i-1] + (1 if mismatch and i==3 else 0),
                     "md5Checksum": "b" * 32, "parents": [mod.FOLDER]}]
        def checked(token, file_id, name, size, sha, md5):
            saved.append(name)
            return {"name": name, "bytes": size}
        with patch.object(mod, "credentials", return_value=("drive-token", "supabase-secret")), \
             patch.object(mod, "private"), patch.object(mod, "get_source", side_effect=source), \
             patch.object(mod, "candidates", side_effect=found), \
             patch.object(mod, "readback", side_effect=checked), \
             patch.object(mod, "upload", side_effect=AssertionError("must_not_upload_existing")), \
             patch.object(mod, "request", side_effect=AssertionError("network_forbidden")):
            mod.run()
        return saved

    def test_idempotent_six_existing_no_duplicate_upload(self):
        self.assertEqual(self._fake_run(), [f"m4b-{i:03d}.m4b" for i in range(1,7)])

    def test_conflict_stops_without_overwrite(self):
        with self.assertRaisesRegex(RuntimeError, "existing_target_conflict_no_overwrite"):
            self._fake_run(mismatch=True)

    def test_source_full_byte_size_and_sha(self):
        data = b"known fixed audio bytes"
        class Response(io.BytesIO):
            status = 200
        with tempfile.TemporaryDirectory() as t:
            path = pathlib.Path(t) / "m4b-001.m4b"
            with patch.object(mod, "request", return_value=Response(data)):
                sha, md5 = mod.get_source("secret", "m4b-001.m4b", len(data), path)
            self.assertEqual(path.read_bytes(), data)
            self.assertEqual(sha, hashlib.sha256(data).hexdigest())
            self.assertEqual(md5, hashlib.md5(data).hexdigest())


if __name__ == "__main__":
    unittest.main()
