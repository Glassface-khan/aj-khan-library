"""Offline stage-diagnostic regression for second-part failure. No credentials or network."""
import unittest
from unittest.mock import patch
from test_private_m4b_backup_original import FakeWorld, w

class SecondPartStages(unittest.TestCase):
    def test_second_part_upload_failure_is_identified(self):
        f=FakeWorld()
        original=f.upload
        def upload(token,folder,name,path,size):
            if name=="m4b-002.m4b":
                raise RuntimeError("SECRET_DO_NOT_LOG")
            return original(token,folder,name,path,size)
        with patch.object(f,"upload",side_effect=upload):
            # FakeWorld.mocked patches w.upload from f.upload at context entry.
            ok,log=f.run()
        self.assertFalse(ok)
        self.assertEqual(f.uploads,["m4b-001.m4b"])
        self.assertIn("DRIVE_UPLOAD part=m4b-002.m4b",log)
        self.assertNotIn("SECRET_DO_NOT_LOG",log)
        self.assertEqual(f.finish_calls,0)

    def test_second_part_readback_failure_is_identified(self):
        f=FakeWorld()
        original=f.verified
        def verified(token,folder,file_id,name,size,sha,md5):
            if name=="m4b-002.m4b":
                raise RuntimeError("SECRET_DO_NOT_LOG")
            return original(token,folder,file_id,name,size,sha,md5)
        with patch.object(f,"verified",side_effect=verified):
            ok,log=f.run()
        self.assertFalse(ok)
        self.assertEqual(f.uploads,["m4b-001.m4b","m4b-002.m4b"])
        self.assertIn("DRIVE_READBACK part=m4b-002.m4b",log)
        self.assertNotIn("SECRET_DO_NOT_LOG",log)
        self.assertEqual(f.finish_calls,0)

if __name__=="__main__":
    unittest.main()
