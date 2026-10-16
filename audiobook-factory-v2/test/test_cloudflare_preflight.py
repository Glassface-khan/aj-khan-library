"""Offline-only checks for the R2/D1 connection probe. No Cloudflare network."""
import contextlib
import importlib.util
import io
import os
from pathlib import Path
import unittest
from unittest.mock import patch

path=Path(__file__).resolve().parents[1]/"scripts"/"cloudflare_readonly_preflight.py"
spec=importlib.util.spec_from_file_location("cloudflare_readonly_preflight",path)
module=importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
ACCOUNT="a"*32
DATABASE="a2d218c4-be71-4b8b-b6a9-c134a7367f11"

def fake_get(url,token):
    if "/d1/database" in url:
        return {"result":[{"name":module.EXPECTED_DATABASE,"uuid":DATABASE}]}
    if "/r2/buckets/" in url:
        return {"result":{"name":module.EXPECTED_BUCKET}}
    raise AssertionError("Unexpected API operation "+url)

class PreflightTests(unittest.TestCase):
    def test_exact_r2_and_d1_names_readonly(self):
        out=io.StringIO()
        with patch.dict(os.environ,{"CLOUDFLARE_API_TOKEN":"placeholder-test-value",
                                     "CLOUDFLARE_ACCOUNT_ID":ACCOUNT},clear=True),\
             patch.object(module,"get_json",side_effect=fake_get) as mock_get,\
             contextlib.redirect_stdout(out):
            module.main()
        self.assertEqual(mock_get.call_count,2)
        self.assertEqual(out.getvalue().count("SUCCESS:"),1)
        self.assertNotIn("placeholder-test-value",out.getvalue())
    def test_missing_credentials_fail_closed(self):
        with patch.dict(os.environ,{},clear=True):
            with self.assertRaises(SystemExit):
                module.main()
    def test_wrong_bucket_stops(self):
        def wrong_bucket(path,token):
            value=fake_get(path,token)
            if "/r2/buckets/" in path:return {"result":{"name":"wrong"}}
            return value
        with patch.dict(os.environ,{"CLOUDFLARE_API_TOKEN":"dummy",
                                     "CLOUDFLARE_ACCOUNT_ID":ACCOUNT},clear=True),\
             patch.object(module,"get_json",side_effect=wrong_bucket):
            with self.assertRaises(SystemExit):
                module.main()

if __name__=="__main__":
    unittest.main()
