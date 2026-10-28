"""Offline regression tests for oversized export chapters; no Supabase or TTS."""
import importlib.util
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("download_worker", ROOT / "audiobook-cloud" / "download_worker.py")
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)

class ExportSplitTests(unittest.TestCase):
    def test_small_chapter_unchanged(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "chapter.mp3"
            path.write_bytes(b"x" * 100)
            ch = {"local": path, "seconds": 60, "chapter_index": 0, "title": "One"}
            self.assertEqual(worker.split_oversized_chapters([ch], Path(tmp)), [ch])

    def test_oversized_chapter_split_and_original_preserved(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp)
            source = folder / "original.mp3"
            source.write_bytes(b"ORIGINAL")
            chapter = {"local": source, "seconds": 4000, "chapter_index": 0, "title": "Long"}
            def fake_run(*args):
                Path(args[-1]).write_bytes(b"segment")
                return ""
            with patch.object(worker, "LIMIT", 6), patch.object(worker, "run", fake_run), patch.object(worker, "duration", lambda path: 1):
                with self.assertRaisesRegex(ValueError, "MP3 segment too large"):
                    worker.split_oversized_chapters([chapter], folder)
            self.assertEqual(source.read_bytes(), b"ORIGINAL")

    def test_oversized_chapter_parts_fit_limit(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp)
            source = folder / "original.mp3"
            source.write_bytes(b"ORIGINAL")
            chapter = {"local": source, "seconds": 3700, "chapter_index": 2, "title": "Long"}
            durations = {}
            def fake_run(*args):
                dest = Path(args[-1])
                dest.write_bytes(b"part")
                durations[str(dest)] = float(args[args.index("-t") + 1])
                return ""
            with patch.object(worker, "run", fake_run), patch.object(worker, "duration", lambda path: durations[str(path)]):
                parts = worker.split_oversized_chapters([chapter], folder)
            self.assertEqual(len(parts), 3)
            self.assertAlmostEqual(sum(p["seconds"] for p in parts), 3700)
            self.assertEqual(source.read_bytes(), b"ORIGINAL")
            self.assertTrue(all(p["local"].stat().st_size < worker.LIMIT for p in parts))
            self.assertTrue(all("Abschnitt" in p["title"] for p in parts))

if __name__ == "__main__":
    unittest.main()
