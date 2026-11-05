"""No-network regressions for one-time ZIP-only cleanup gates."""
import importlib.util
import pathlib
import socket
import unittest
from unittest.mock import patch

PATH = pathlib.Path(__file__).resolve().parents[1] / "ops" / "af_zip_cleanup_owner_once.py"
spec = importlib.util.spec_from_file_location("af_zip_one", PATH)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

def status(n, size, m4bs=97):
    return {"ok":True, "kind":"read_only", "remaining_zip":n,
            "remaining_bytes":size, "m4bs_in_25_folders":m4bs}

class ZipCleanupTests(unittest.TestCase):
    def setUp(self):
        self.guard = patch.object(socket, "socket", side_effect=AssertionError("network forbidden"))
        self.guard.start()

    def tearDown(self):
        self.guard.stop()

    def test_pilot_exact_5_and_m4b_preservation(self):
        sequence = [status(225, mod.ORIGINAL_BYTES),
            {"ok":True,"kind":"zip_only","batch":0,"expected":5,"removed":5,
             "removed_bytes":mod.PILOT_BYTES,"m4b_guard":"unchanged"},
            status(220,mod.REST_BYTES)]
        with patch.object(mod,"remote",side_effect=sequence) as call:
            mod.pilot("fixture-jwt")
        self.assertEqual(call.call_count,3)
        self.assertEqual(call.call_args_list[1].args,("fixture-jwt","delete",0))

    def test_halts_before_any_delete_if_count_changes(self):
        with patch.object(mod,"remote",return_value=status(224,mod.ORIGINAL_BYTES)) as call:
            with self.assertRaisesRegex(RuntimeError,"unexpected_storage_inventory"):
                mod.pilot("fixture")
            self.assertEqual(call.call_count,1)

    def test_halts_if_pilot_changes_m4bs(self):
        sequence=[status(225,mod.ORIGINAL_BYTES,m4bs=97),
           {"ok":True,"kind":"zip_only","batch":0,"expected":5,"removed":5,
            "removed_bytes":mod.PILOT_BYTES,"m4b_guard":"unchanged"},
           status(220,mod.REST_BYTES,m4bs=96)]
        with patch.object(mod,"remote",side_effect=sequence):
            with self.assertRaisesRegex(RuntimeError,"pilot_m4b_changed"):
                mod.pilot("fixture")

    def test_remaining_exact_11_batches_then_zero_zip(self):
        per=mod.REST_BYTES//11
        sizes=[per]*10+[mod.REST_BYTES-per*10]
        batches=[{"ok":True,"kind":"zip_only","batch":i,"expected":20,"removed":20,
                  "removed_bytes":size,"m4b_guard":"unchanged"}
                 for i,size in enumerate(sizes,1)]
        sequence=[status(220,mod.REST_BYTES)]+batches+[status(0,0)]
        with patch.object(mod,"remote",side_effect=sequence) as call:
            mod.remaining("fixture")
        self.assertEqual(call.call_count,13)
        self.assertEqual([c.args[2] for c in call.call_args_list if c.args[1]=="delete"],list(range(1,12)))

    def test_rest_halts_on_any_bad_batch(self):
        sequence=[status(220,mod.REST_BYTES),{"ok":True,"kind":"zip_only",
                    "batch":1,"expected":20,"removed":19,
                    "removed_bytes":42,"m4b_guard":"unchanged"}]
        with patch.object(mod,"remote",side_effect=sequence) as call:
            with self.assertRaisesRegex(RuntimeError,"batch_validation_failed"):
                mod.remaining("fixture")
        self.assertEqual(call.call_count,2)

if __name__=="__main__":
    unittest.main()
