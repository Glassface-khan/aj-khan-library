"""Network-isolated regression tests for the real backup worker. No external calls."""
import hashlib
import importlib.util
import io
import os
import pathlib
import socket
import unittest
from unittest.mock import patch

ROOT = pathlib.Path(__file__).resolve().parents[1]
SOURCE = ROOT / "ops" / "ajk_private_auto_m4b_backup.py"
spec = importlib.util.spec_from_file_location("ajk_backup_under_test", SOURCE)
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)
TARGET = "484d4afb-f4fb-4e91-a866-6cf3b1086d12"


class RecoveryRegressionTests(unittest.TestCase):
    def setUp(self):
        self.network_guard = patch.object(socket, "socket", side_effect=AssertionError("network_forbidden"))
        self.network_guard.start()

    def tearDown(self):
        self.network_guard.stop()

    def exercise_execute(self, target):
        files = [{"name": f"m4b-{i:03d}.m4b", "bytes":100+i} for i in range(1,7)]
        calls = []
        def fake_edge(op, payload):
            calls.append((op,payload))
            if op == "claim":
                return {"jobId":"offline-job", "files":files, "book":{"title":"Test","narrator":"Voice","language":"en"}}
            return {"finished":True,"partCount":6}
        def fake_source_download(source, job_id, path):
            path.write_bytes(b"x")
            i = int(source["name"][4:7])
            return f"sha-{i}",f"md5-{i}"
        def fake_find_tag(token, key, value, parent=None):
            i = int(value[4:7])
            return {"id":f"drive-{i}","name":value,"size":100+i,"md5Checksum":f"md5-{i}"}
        def fake_verified(token, folder_id, file_id, name, size, sha, md5):
            return {"name":name,"id":file_id,"bytes":size,"sha256":sha,"md5":md5}
        with patch.dict(os.environ, {"TARGET_EXPORT_JOB_ID":target}), \
             patch.object(worker,"edge",side_effect=fake_edge), \
             patch.object(worker,"drive_token",return_value="offline-token"), \
             patch.object(worker,"folder",side_effect=["root","destination"]), \
             patch.object(worker,"source_download",side_effect=fake_source_download), \
             patch.object(worker,"find_tag",side_effect=fake_find_tag), \
             patch.object(worker,"verified",side_effect=fake_verified) as verify, \
             patch.object(worker,"upload") as upload, \
             patch.object(worker,"is_private"), \
             patch.object(worker,"request",side_effect=AssertionError("network_forbidden")):
            worker.execute()
            self.assertEqual(upload.call_count,0)
            self.assertEqual(verify.call_count,6)
        return calls

    def test_manual_resume_six_verified_zero_upload(self):
        calls=self.exercise_execute(TARGET)
        self.assertEqual(calls[0],("claim",{"targetJobId":TARGET}))
        self.assertEqual(calls[-1][0],"finish")
        self.assertEqual(calls[-1][1]["targetJobId"],TARGET)
        self.assertEqual(len(calls[-1][1]["files"]),6)

    def test_schedule_finish_omits_manual_target(self):
        calls=self.exercise_execute("")
        self.assertEqual(calls[0],("claim",{}))
        self.assertNotIn("targetJobId",calls[-1][1])

    def check_readback(self, data, expected_sha):
        md5=hashlib.md5(data).hexdigest()
        meta={"name":"m4b-001.m4b","size":len(data),"md5Checksum":md5,"parents":["folder"]}
        with patch.object(worker,"google",return_value=meta), \
             patch.object(worker,"is_private"), \
             patch.object(worker,"request",return_value=io.BytesIO(data)):
            return worker.verified("token","folder","file","m4b-001.m4b",len(data),expected_sha,md5)

    def test_verified_valid_sha256(self):
        data=b"valid mock audiobook data"
        result=self.check_readback(data,hashlib.sha256(data).hexdigest())
        self.assertEqual(result["bytes"],len(data))

    def test_verified_rejects_corrupted_sha256(self):
        data=b"valid mock audiobook data"
        with self.assertRaisesRegex(RuntimeError,"drive_sha256_mismatch"):
            self.check_readback(data,hashlib.sha256(b"tampered data").hexdigest())


if __name__ == "__main__":
    unittest.main()
