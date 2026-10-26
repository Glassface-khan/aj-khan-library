"""Offline cross-check of deployed-code staging constants, with no network calls."""
from pathlib import Path
import re
import unittest
from test_private_m4b_backup_original import w

EDGE = Path(__file__).resolve().parents[1] / "ops/edge_staging/ajk-private-auto-m4b-backup/index.ts"

class EdgeWorkerCapacityContract(unittest.TestCase):
    def test_exact_server_client_limits(self):
        source = EDGE.read_text(encoding="utf-8")
        match = re.search(r"const SIZES=\\{maxFile:(\\d+),maxTotal:(\\d+),maxParts:(\\d+)\\};", source)
        self.assertIsNotNone(match, "Expected Edge limits declaration missing")
        max_file, max_total, max_parts = map(int, match.groups())
        self.assertEqual((max_file, max_total, max_parts), (50_000_000, 1_000_000_000, 30))
        self.assertEqual((w.MAX_TOTAL, w.MAX_PARTS), (max_total, max_parts))
        self.assertIn("size>50000000", __import__("inspect").getsource(w.source_download))

    def test_no_manifest_truncation(self):
        source = EDGE.read_text(encoding="utf-8")
        self.assertIn("declared.length>SIZES.maxParts)return null", source)
        self.assertNotIn("declared.slice(", source)
        self.assertIn("if(sum>SIZES.maxTotal)return null", source)

if __name__ == "__main__":
    unittest.main()
