"""Offline-only capacity and manifest regressions for the real backup worker.

No credentials, external services, production runs, or large file allocation.
"""
import unittest
from unittest.mock import patch
from test_private_m4b_backup_original import w, FakeWorld, JOB

class LargeManifestTests(unittest.TestCase):
    def test_worker_real_capacity_constants(self):
        self.assertEqual(w.MAX_PARTS,30)
        self.assertEqual(w.MAX_TOTAL,1_000_000_000)

    def make_manifest(self, n, declared_bytes=40_000_000):
        return [{"name":f"m4b-{i:03d}.m4b","bytes":declared_bytes} for i in range(1,n+1)]

    def test_legacy_limits_reject_20_parts_before_drive(self):
        f=FakeWorld()
        files=self.make_manifest(20)
        with f.mocked(), patch.object(f,"edge",return_value={
            "jobId":JOB,"files":files,"book":{"title":"Mock","narrator":"Mock","language":"en"}
        }), patch.object(w,"edge",side_effect=f.edge), patch.object(w,"MAX_PARTS",10),patch.object(w,"MAX_TOTAL",350_000_000):
            with self.assertRaisesRegex(RuntimeError,"claim_limits"):
                w.execute()
        self.assertEqual(f.uploads,[])

    def test_30_part_1gb_boundary_reaches_first_source_only(self):
        # Logical acceptance only; stop at first source without network or 1GB allocation.
        f=FakeWorld()
        files=self.make_manifest(30,33_000_000)  # 990 MB
        with f.mocked(), patch.object(f,"edge",return_value={
            "jobId":JOB,"files":files,"book":{"title":"Mock","narrator":"Mock","language":"en"}
        }),patch.object(w,"edge",side_effect=f.edge),patch.object(w,"MAX_PARTS",30),patch.object(w,"MAX_TOTAL",1_000_000_000),patch.object(w,"source_download",side_effect=RuntimeError("offline-stop")):
            with self.assertRaises(w.BackupStageError) as err:
                w.execute()
        self.assertEqual(err.exception.stage,"SOURCE_DOWNLOAD")
        self.assertEqual(err.exception.part,"m4b-001.m4b")
        self.assertEqual(f.uploads,[])

    def test_30_part_over_1gb_rejected_before_download(self):
        f=FakeWorld()
        files=self.make_manifest(30,34_000_000)  # 1.02 GB
        with f.mocked(),patch.object(f,"edge",return_value={
            "jobId":JOB,"files":files,"book":{"title":"Mock","narrator":"Mock","language":"en"}
        }),patch.object(w,"edge",side_effect=f.edge),patch.object(w,"MAX_PARTS",30),patch.object(w,"MAX_TOTAL",1_000_000_000):
            with self.assertRaisesRegex(RuntimeError,"claim_limits"):
                w.execute()
        self.assertEqual(f.uploads,[])

if __name__=="__main__":
    unittest.main()
