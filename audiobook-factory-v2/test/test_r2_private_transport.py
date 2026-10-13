"""No-network mock tests of R2 object access boundaries and fail closed checks."""
import io
import pathlib
import sys
import unittest
from unittest.mock import patch

ROOT=pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/"production"))
import r2_private_transport as r2

JOB="e7d46a75-e8d9-4b91-8fab-437e6283dd3f"


class FakeClient:
    def __init__(self, objects=None):
        self.objects=objects or {}
        self.reads=[]
        self.writes=[]
    def get_object(self, **kwargs):
        self.reads.append(kwargs)
        blob=self.objects[kwargs["Key"]]
        return {"Body":io.BytesIO(blob),"ContentLength":len(blob)}
    def put_object(self, **kwargs):
        self.writes.append(kwargs)
        if kwargs["Key"] in self.objects:
            raise RuntimeError("already exists")
        self.objects[kwargs["Key"]]=kwargs["Body"]


class PrivateTransportTests(unittest.TestCase):
    def test_known_bucket_and_exact_keys(self):
        self.assertEqual(r2.BUCKET,"ajk-private-audiobooks-v2-test")
        self.assertEqual(r2.source_key(JOB),f"sources/{JOB}/manuscript.docx")
        self.assertEqual(r2.voice_key("jessica_en"),"private-voices/Jessica_EN_Factory_Reference.wav")
        self.assertEqual(r2.result_key(JOB,"jessica_en","beginning.wav"),
                         f"pilots/{JOB}/results/jessica_en/beginning.wav")

    def test_reject_unknown_voice_or_key_path_traversal(self):
        for key in ("fake","jessica_en/../../foo","MAGGIE","../../private"):
            with self.assertRaises(r2.PrivateTransportError):
                r2.voice_key(key)
        for filename in ("../private.wav","manuscript.docx","voice.wav","token.txt"):
            with self.assertRaises(r2.PrivateTransportError):
                r2.result_key(JOB,"jessica_en",filename)
        for job in ("", "../secrets", "anything", "aaaa/bbbb"):
            with self.assertRaises(r2.PrivateTransportError):
                r2.source_key(job)

    def test_private_read_is_bounded_and_no_public_access(self):
        s=r2.source_key(JOB)
        v=r2.voice_key("jessica_en")
        client=FakeClient({s:b"fake-synthetic-docx",v:b"fake-synthetic-wav"})
        self.assertEqual(r2.fetch_source(client,JOB),b"fake-synthetic-docx")
        self.assertEqual(r2.fetch_voice(client,"jessica_en"),b"fake-synthetic-wav")
        self.assertEqual([x["Bucket"] for x in client.reads],[r2.BUCKET]*2)
        self.assertNotIn("ACL",client.reads[0])

    def test_oversized_data_is_rejected_without_exposing_bytes(self):
        key=r2.source_key(JOB)
        fake=FakeClient({key:b"x"*128})
        with self.assertRaises(r2.PrivateTransportError):
            r2.fetch_limited(fake,key,64)

    def test_write_once_upload_fails_closed(self):
        f=FakeClient()
        key=r2.save_result(f,JOB,"jessica_en","beginning.wav",b"\0"*1024)
        self.assertEqual(f.writes[0]["IfNoneMatch"],"*")
        self.assertEqual(f.writes[0]["ContentType"],"audio/wav")
        self.assertEqual(f.objects[key],b"\0"*1024)
        with self.assertRaises(r2.PrivateTransportError):
            r2.save_result(f,JOB,"jessica_en","beginning.wav",b"duplicate")
        self.assertEqual(len(f.writes),2)
        self.assertFalse(hasattr(r2,"delete_object"))

    def test_credentials_are_not_optional_or_passed_by_callers(self):
        with patch.dict("os.environ",{},clear=True):
            with self.assertRaises(r2.PrivateTransportError):
                r2.client_from_environment()

if __name__=="__main__":
    unittest.main()
