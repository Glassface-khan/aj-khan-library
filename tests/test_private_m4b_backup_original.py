"""Offline regression tests against the actual feature-branch backup worker."""
import contextlib
import hashlib
import importlib.util
import io
import os
from pathlib import Path
import unittest
from unittest.mock import patch

WORKER = Path(__file__).resolve().parents[1] / "ops/ajk_private_auto_m4b_backup.py"
if not WORKER.is_file():
    raise RuntimeError("Original worker missing; no simulated replacement permitted")
spec = importlib.util.spec_from_file_location("m4b_original_worker", WORKER)
w = importlib.util.module_from_spec(spec)
spec.loader.exec_module(w)

PARTS = [b"first part content", b"second part content"]
JOB = "00000000-0000-4000-8000-000000000001"
FILES = [{"name":f"m4b-{i:03d}.m4b","bytes":len(data)} for i,data in enumerate(PARTS,1)]

class FakeWorld:
    def __init__(self):
        self.remote={}
        self.uploads=[]
        self.finish_calls=0
        self.fail_second=False
        self.fail_finish=False
        self.bad_md5=False
        self.bad_sha=False
        self.downloads=[]
    def edge(self,op,extra=None):
        if op=="claim":
            return {"jobId":JOB,"files":FILES,"book":{"title":"Dummy","narrator":"Mock","language":"en"}}
        if op=="finish":
            self.finish_calls+=1
            if self.fail_finish: raise RuntimeError("FAKE_SECRET https://private.example/token")
            return {"finished":True,"partCount":len(FILES)}
        raise AssertionError(op)
    def folder(self,*a,**k):
        return "root" if k.get("create") is False else "book"
    def download(self,source,job_id,path):
        idx=int(source["name"][4:7])-1
        self.downloads.append(idx)
        if idx==1 and self.fail_second: raise RuntimeError("FAKE_SECRET https://private.example/token")
        data=PARTS[idx]
        path.write_bytes(data)
        return hashlib.sha256(data).hexdigest(),hashlib.md5(data).hexdigest()
    def find(self,token,key,name,parent):
        if name not in self.remote: return None
        data=self.remote[name]["data"]
        return {"id":self.remote[name]["id"],"name":name,"size":len(data),
                "md5Checksum":("0"*32 if self.bad_md5 else hashlib.md5(data).hexdigest())}
    def upload(self,token,folder,name,path,size):
        data=path.read_bytes()
        self.uploads.append(name)
        self.remote[name]={"id":"id-"+name,"data":data}
        return {"id":"id-"+name,"size":len(data),"md5Checksum":hashlib.md5(data).hexdigest()}
    def verified(self,token,folder,file_id,name,size,sha,md5):
        data=self.remote[name]["data"]
        if hashlib.md5(data).hexdigest()!=md5 or (self.bad_sha and name=="m4b-001.m4b") or hashlib.sha256(data).hexdigest()!=sha:
            raise RuntimeError("FAKE_SECRET https://private.example/token")
        return {"name":name,"id":file_id,"bytes":size,"md5":md5,"sha256":sha}
    @contextlib.contextmanager
    def mocked(self):
        with patch.dict(os.environ,{"TARGET_EXPORT_JOB_ID":""}), \
             patch.object(w,"edge",self.edge),patch.object(w,"drive_token",return_value="fake-token"), \
             patch.object(w,"folder",self.folder),patch.object(w,"source_download",self.download), \
             patch.object(w,"find_tag",self.find),patch.object(w,"upload",self.upload), \
             patch.object(w,"verified",self.verified),patch.object(w,"is_private",return_value=None), \
             patch.object(w,"request",side_effect=AssertionError("unexpected network")):
            yield
    def run(self):
        out=io.StringIO()
        with self.mocked(),contextlib.redirect_stdout(out),contextlib.redirect_stderr(out):
            try:
                w.execute()
                ok=True
            except Exception as e:
                ok=False
                # Same safe rendering contract as worker __main__; no exception details.
                if isinstance(e,w.BackupStageError):
                    print("AUTO_BACKUP_ERROR stage="+e.stage+" part="+e.part,file=out)
                else:
                    print("AUTO_BACKUP_ERROR stage=BACKUP_INTERNAL part=none",file=out)
                print("AUTO_BACKUP_FAILED_NO_SOURCE_DELETE_NO_PUBLIC_SHARE",file=out)
        return ok,out.getvalue()

class OriginalWorkerTests(unittest.TestCase):
    def test_resume_after_second_part_failure(self):
        f=FakeWorld()
        f.fail_second=True
        ok,log=f.run()
        self.assertFalse(ok)
        self.assertEqual(f.uploads,["m4b-001.m4b"])
        self.assertEqual(f.finish_calls,0)
        self.assertIn("SOURCE_DOWNLOAD part=m4b-002.m4b",log)
        f.fail_second=False
        ok,log=f.run()
        self.assertTrue(ok)
        self.assertEqual(f.uploads,["m4b-001.m4b","m4b-002.m4b"])
        self.assertEqual(f.finish_calls,1)
        self.assertEqual(f.downloads,[0,1,0,1])
    def test_md5_conflict_no_overwrite(self):
        f=FakeWorld()
        f.remote["m4b-001.m4b"]={"id":"old","data":PARTS[0]}
        f.bad_md5=True
        ok,log=f.run()
        self.assertFalse(ok)
        self.assertEqual(f.uploads,[])
        self.assertEqual(f.finish_calls,0)
    def test_sha_readback_mismatch_no_finish(self):
        f=FakeWorld()
        f.bad_sha=True
        ok,log=f.run()
        self.assertFalse(ok)
        self.assertEqual(f.finish_calls,0)
        self.assertIn("DRIVE_READBACK part=m4b-001.m4b",log)
    def test_sanitized_logging(self):
        f=FakeWorld()
        f.fail_second=True
        ok,log=f.run()
        self.assertFalse(ok)
        for secret in ["FAKE_SECRET","private.example","Traceback","fake-token"]:
            self.assertNotIn(secret,log)
        self.assertIn("SOURCE_DOWNLOAD part=m4b-002.m4b",log)
    def test_finish_failure_then_resume_no_duplicate(self):
        f=FakeWorld()
        f.fail_finish=True
        ok,log=f.run()
        self.assertFalse(ok)
        self.assertEqual(len(f.uploads),2)
        self.assertIn("DRIVE_FINISH part=none",log)
        f.fail_finish=False
        ok,log=f.run()
        self.assertTrue(ok)
        self.assertEqual(len(f.uploads),2)
        self.assertEqual(f.finish_calls,2)

if __name__=="__main__":
    unittest.main()
