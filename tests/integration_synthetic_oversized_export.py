"""Real ffmpeg integration test using generated audio; no private data or network."""
import importlib.util
import json
import subprocess
import tempfile
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("worker", ROOT / "audiobook-cloud" / "download_worker.py")
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)

def probe(path):
    return json.loads(subprocess.check_output([
        "ffprobe", "-v", "error", "-show_format", "-show_chapters",
        "-of", "json", str(path)
    ]))

with tempfile.TemporaryDirectory() as tmp:
    folder = Path(tmp)
    source = folder / "synthetic-original.mp3"
    # ~50 MB synthetic MP3, generated locally; silence is adequate to test timing/size.
    subprocess.run([
        "ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i",
        "anullsrc=r=22050:cl=mono", "-t", "3200", "-c:a", "libmp3lame",
        "-b:a", "128k", str(source)
    ], check=True)
    assert source.stat().st_size > worker.LIMIT, source.stat().st_size
    original_bytes = source.stat().st_size
    original_duration = worker.duration(source)
    chapter = {"local": source, "seconds": original_duration,
               "chapter_index": 0, "title": "Synthetic long chapter"}
    parts = worker.split_oversized_chapters([chapter], folder)
    assert len(parts) >= 2, len(parts)
    assert all(p["local"].stat().st_size < worker.LIMIT for p in parts)
    assert abs(sum(p["seconds"] for p in parts) - original_duration) < 2, "split timing drift"
    assert source.stat().st_size == original_bytes, "original changed"
    zips = worker.pack_zip(parts, folder)
    m4bs = worker.pack_m4b(parts, {"title": "Synthetic Fixture"}, folder)
    assert zips and m4bs
    for output in zips + m4bs:
        assert 0 < output.stat().st_size <= worker.LIMIT, (output.name, output.stat().st_size)
    entries = []
    for path in zips:
        with zipfile.ZipFile(path) as archive:
            assert archive.testzip() is None
            entries.extend(archive.namelist())
    assert len(entries) == len(parts), (len(entries), len(parts))
    chapter_count = 0
    total_m4b_duration = 0
    for path in m4bs:
        metadata = probe(path)
        chapter_count += len(metadata["chapters"])
        total_m4b_duration += float(metadata["format"]["duration"])
    assert chapter_count == len(parts), (chapter_count, len(parts))
    assert abs(total_m4b_duration - original_duration) < 3, (total_m4b_duration, original_duration)
    print("SYNTHETIC_EXPORT_PASS", "source_bytes", original_bytes,
          "source_seconds", round(original_duration, 2),
          "parts", len(parts), "zips", len(zips), "m4bs", len(m4bs),
          "total_m4b_seconds", round(total_m4b_duration, 2))
