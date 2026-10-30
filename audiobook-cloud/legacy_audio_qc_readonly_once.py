#!/usr/bin/env python3
"""One-off, READ-ONLY legacy audiobook ASR-vs-locked-manuscript audit.

Only the two exact preflighted editions are eligible. No Supabase/Drive writes,
no new voice generation, no file publication, and no credentials/transcripts in logs.
The result is a *sample from each chapter*, NOT an exhaustive full-text QC pass.
"""
from __future__ import annotations

import hashlib
import json
import os
import statistics
import subprocess
import sys
import tempfile
from pathlib import Path
from urllib.parse import quote

import requests
from faster_whisper import WhisperModel

sys.path.insert(0, str(Path(__file__).parent))
from worker import parse_source
from audit_existing_audiobooks import best_alignment

BASE = "https://ipoqyjrojljmbqslmxxf.supabase.co"
EDITIONS = (
    dict(title="The Guest", book_id="9b8e8520-4aa2-4337-aa61-5c3a10ce2a6f",
         voice="narration_us_f", chapters=49, bytes=312821132,
         document="THE_GUEST_PUBLICATION_MASTER_v1_0_FINAL.docx"),
)

def fail(reason):
    raise RuntimeError(reason)

def require_credentials():
    if not os.getenv("SUPABASE_SERVICE_ROLE_KEY"):
        fail("MISSING_CONFIG_SUPABASE_SERVICE_ROLE_KEY")
    base = os.getenv("SUPABASE_URL", BASE).rstrip("/")
    if base != BASE:
        fail("SUPABASE_PROJECT_MISMATCH")
    return base

def supa_get(base, endpoint, params=None, stream=False):
    key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    headers = {"apikey": key, "Authorization": "Bearer " + key}
    r = requests.get(base + endpoint, params=params, headers=headers,
                     timeout=(15, 180), stream=stream, allow_redirects=False)
    if r.status_code != 200:
        r.close()
        fail("SUPABASE_READ_REJECTED_" + str(r.status_code))
    return r

LOCKED_BUCKET = "audiobook-factory"
LOCKED_PATH = ("qc-locked-sources/9b8e8520-4aa2-4337-aa61-5c3a10ce2a6f/"
               "THE_GUEST_PUBLICATION_MASTER_v1_0_FINAL.docx")
LOCKED_SHA256 = "f73d674a3f6bcdbf63d8880c085eb447e080946128ade41b521a81b76789f9d6"
LOCKED_BYTES = 243128


def read_locked_master(base, title, path):
    if title != "THE_GUEST_PUBLICATION_MASTER_v1_0_FINAL.docx":
        fail("UNEXPECTED_MANUSCRIPT_TITLE")
    r = supa_get(base, "/storage/v1/object/" + LOCKED_BUCKET + "/" +
                 quote(LOCKED_PATH, safe="/"))
    data = r.content
    r.close()
    if (len(data) != LOCKED_BYTES or data[:2] != b"PK"
            or hashlib.sha256(data).hexdigest() != LOCKED_SHA256):
        fail("PRIVATE_MANUSCRIPT_INTEGRITY_FAILURE")
    path.write_bytes(data)
    return len(data)


def list_private_chapters(base, ed):
    book = supa_get(base, "/rest/v1/audio_books",
                    {"id": "eq." + ed["book_id"],
                     "select": "id,title,voice_key,language_code,is_active,status"}).json()
    if len(book) != 1 or book[0]["title"] != ed["title"] or (
        book[0]["voice_key"] != ed["voice"]
        or book[0]["status"] != "ready" or not book[0]["is_active"]
        or book[0]["language_code"] != "EN"):
        fail("AUDIO_EDITION_NOT_EXACTLY_READY")
    c = supa_get(base, "/rest/v1/audio_chapters",
                 {"audio_book_id": "eq." + ed["book_id"], "select":
                  "chapter_index,title,storage_path,byte_size,duration_seconds",
                  "order": "chapter_index.asc", "limit": "1000"}).json()
    if len(c) != ed["chapters"] or [int(x["chapter_index"]) for x in c] != list(range(ed["chapters"])):
        fail("AUDIO_CHAPTER_INDEX_OR_COUNT_MISMATCH")
    if len({x["storage_path"] for x in c}) != len(c):
        fail("AUDIO_DUPLICATE_PATH")
    if sum(int(x["byte_size"]) for x in c) != ed["bytes"]:
        fail("AUDIO_BYTES_SOURCE_CHANGED")
    for x in c:
        if (int(x["byte_size"]) <= 1000 or int(x["byte_size"]) >= 50000000
                or float(x["duration_seconds"]) < 45
                or not x["storage_path"].endswith(".mp3")):
            fail("AUDIO_CHAPTER_INVALID_METADATA")
    return c

def retrieve_private_mp3(base, chapter, dest):
    path = chapter["storage_path"]
    r = supa_get(base, "/storage/v1/object/audiobooks/" + quote(path, safe="/"),
                 stream=True)
    length = 0
    with dest.open("wb") as out:
        for block in r.iter_content(262144):
            if block:
                out.write(block)
                length += len(block)
                if length > 50000000:
                    fail("AUDIO_FILE_EXCEEDS_SIZE_GATE")
    r.close()
    if length != int(chapter["byte_size"]):
        fail("AUDIO_FILE_BYTES_MISMATCH")
    result = subprocess.run(["ffprobe", "-v", "error", "-show_entries",
                             "format=duration", "-of", "json", str(dest)],
                            capture_output=True, text=True, timeout=35, check=True)
    duration = float(json.loads(result.stdout)["format"]["duration"])
    if abs(duration - float(chapter["duration_seconds"])) > 8:
        fail("AUDIO_DURATION_MISMATCH")
    return duration

def sample_mp3(path, dest, duration):
    start = max(0., min(duration * .46, duration - 37.))
    subprocess.run(["ffmpeg", "-nostdin", "-y", "-hide_banner", "-loglevel", "error",
                    "-ss", f"{start:.2f}", "-i", str(path), "-t", "35",
                    "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le",
                    str(dest)], check=True, capture_output=True, timeout=90)
    if dest.stat().st_size < 100000:
        fail("AUDIO_DECODED_CLIP_TOO_SHORT")
    return round(start, 1)

def audit_edition(base, ed, model):
    with tempfile.TemporaryDirectory(prefix="ajk_legacy_qc_") as tmp:
        folder = Path(tmp)
        source = folder / "locked.docx"
        source_size = read_locked_master(base, ed["document"], source)
        _, sections, _ = parse_source(source)
        chapters = list_private_chapters(base, ed)
        by_index = {int(s.index): s for s in sections}
        if len(by_index) != ed["chapters"] or set(by_index) != set(range(ed["chapters"])):
            fail("MANUSCRIPT_PARSER_CHAPTER_COUNT_MISMATCH")
        scores = []
        for ch in chapters:
            idx = int(ch["chapter_index"])
            s = by_index[idx]
            if len(s.spoken_text.split()) < 70:
                fail("MANUSCRIPT_SOURCE_SECTION_TOO_SHORT_AT_" + str(idx))
            audio, wav = folder / "audio.mp3", folder / "clip.wav"
            try:
                duration = retrieve_private_mp3(base, ch, audio)
                offset = sample_mp3(audio, wav, duration)
                segments, _ = model.transcribe(str(wav), language="en",
                    beam_size=3, temperature=0., vad_filter=False,
                    condition_on_previous_text=False)
                text = " ".join(part.text.strip() for part in segments)
                score, n = best_alignment(text, s.spoken_text)
                scores.append(score)
                # Never print text/audio, storage paths, URLs, or transcripts.
                print("LEGACY_QC_CHAPTER " + json.dumps(
                    {"book": ed["title"], "chapter_index": idx,
                     "score": score, "recognized_words": n,
                     "sample_second": offset}, sort_keys=True), flush=True)
            finally:
                audio.unlink(missing_ok=True)
                wav.unlink(missing_ok=True)
        middle = statistics.median(scores)
        below = sum(v < 78 for v in scores)
        # These numeric bounds classify only the per-chapter sample,
        # never a full word-by-word audit or a production factory QC pass.
        passed = len(scores) == ed["chapters"] and min(scores) >= 65 and (
            middle >= 82 and below <= max(2, ed["chapters"] // 10))
        print("LEGACY_QC_BOOK " + json.dumps({
            "book": ed["title"], "book_id": ed["book_id"],
            "narrator": ed["voice"], "original_docx_bytes": source_size,
            "chapters_checked": len(scores), "expected_chapters": ed["chapters"],
            "source_mp3_bytes": ed["bytes"], "min_score": min(scores),
            "median_score": middle, "chapters_below_78": below,
            "classification": "LOW_RISK_PER_CHAPTER_SAMPLE" if passed else "NEEDS_AUDIO_REVIEW",
            "not_full_transcript_qc": True, "source_modified": False,
            "audio_modified": False, "database_modified": False,
            "migration_started": False}, sort_keys=True), flush=True)
        return passed

def self_test():
    assert len(EDITIONS) == 1
    assert EDITIONS[0]["book_id"] == "9b8e8520-4aa2-4337-aa61-5c3a10ce2a6f"
    assert sum(e["chapters"] for e in EDITIONS) == 49
    test = "the old house stood beside the river at dawn and waited for the visitor"
    score, words = best_alignment(test,
        "before the rain, " + test + " until the last light faded across the water")
    assert words >= 10 and score >= 75, (score, words)
    print("LEGACY_QC_SYNTHETIC_TESTS=PASS")

def main():
    if len(sys.argv) == 2 and sys.argv[1] == "--self-test":
        self_test()
        return 0
    if len(sys.argv) == 2 and sys.argv[1] == "--source-probe":
        base = require_credentials()
        ed = EDITIONS[0]
        with tempfile.TemporaryDirectory(prefix="ajk_guest_source_probe_") as root:
            dest = Path(root) / "original.docx"
            nbytes = read_locked_master(base, ed["document"], dest)
            _, sections, _ = parse_source(dest)
            indexes = [int(s.index) for s in sections]
            aligned = indexes == list(range(ed["chapters"]))
            print("GUEST_SOURCE_PROBE " + json.dumps({
                "book": ed["title"], "docx_bytes": nbytes,
                "sha256_verified": True,
                "parsed_sections": len(indexes),
                "expected_sections": ed["chapters"],
                "index_continuity": aligned,
                "classification": "SOURCE_READY" if aligned else "SOURCE_STRUCTURE_REVIEW",
                "no_audio_access": True, "no_writes": True
            }, sort_keys=True), flush=True)
            return 0 if aligned else 2
    if len(sys.argv) != 1:
        fail("UNRECOGNIZED_ARGUMENTS")
    base = require_credentials()
    print("LEGACY_QC_MODE=READ_ONLY_GUEST_EXACT_EDITION", flush=True)
    model = WhisperModel("base.en", device="cpu",
                         compute_type="int8", cpu_threads=2, num_workers=1)
    results = []
    for edition in EDITIONS:
        try:
            results.append(audit_edition(base, edition, model))
        except Exception as e:
            # Deliberately log only a bounded error TYPE and known fail-closed
            # error codes. Avoid HTTP exception messages containing private data.
            print("LEGACY_QC_BOOK " + json.dumps({
                "book": edition["title"], "classification": "BLOCKED",
                "error_type": type(e).__name__,
                "reason": str(e)[:150] if isinstance(e, RuntimeError) else "AUDIT_EXCEPTION"
            }, sort_keys=True), flush=True)
            results.append(False)
    print("LEGACY_QC_FINAL " + json.dumps(
        {"books_checked": len(results), "books_sample_passed": sum(results),
         "no_writes": True, "no_migration": True}, sort_keys=True), flush=True)
    return 0 if all(results) else 2

if __name__ == "__main__":
    raise SystemExit(main())
