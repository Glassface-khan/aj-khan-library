#!/usr/bin/env python3
"""One-off, READ-ONLY legacy audiobook ASR-vs-locked-manuscript audit.

Only the two exact preflighted editions are eligible. No Supabase/Drive writes,
no new voice generation, no file publication, and no credentials/transcripts in logs.
The result is a *sample from each chapter*, NOT an exhaustive full-text QC pass.
"""
from __future__ import annotations

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
    dict(title="The Man the World Forgot", book_id="b4e3bde1-7d88-4a04-a68f-55ca249af0ce",
         voice="peter_yearsley", chapters=48, bytes=283195392,
         document="THE_MAN_THE_WORLD_FORGOT_PUBLICATION_MASTER_FINAL_v1.docx"),
)

def fail(reason):
    raise RuntimeError(reason)

def require_credentials():
    required = ("SUPABASE_SERVICE_ROLE_KEY", "GOOGLE_DRIVE_CLIENT_ID",
                "GOOGLE_DRIVE_CLIENT_SECRET", "GOOGLE_DRIVE_REFRESH_TOKEN")
    missing = [key for key in required if not os.getenv(key)]
    if missing:
        fail("MISSING_CONFIG_" + "_".join(missing))
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

def drive_access_token():
    r = requests.post(
        "https://oauth2.googleapis.com/token",
        data=dict(grant_type="refresh_token",
                  refresh_token=os.environ["GOOGLE_DRIVE_REFRESH_TOKEN"],
                  client_id=os.environ["GOOGLE_DRIVE_CLIENT_ID"],
                  client_secret=os.environ["GOOGLE_DRIVE_CLIENT_SECRET"]),
        timeout=30)
    if r.status_code != 200:
        fail("DRIVE_OAUTH_REJECTED_" + str(r.status_code))
    return r.json()["access_token"]

# Exact private Drive document IDs established through an authenticated metadata read.
# The branch-only QC uses these IDs solely to diagnose the legacy OAuth name-search gap.
PINNED_MASTER_IDS = {
    "THE_GUEST_PUBLICATION_MASTER_v1_0_FINAL.docx": "1s1JHjYUlb2RbFPNB6X-pv-YWF9Z0ifdN",
    "THE_MAN_THE_WORLD_FORGOT_PUBLICATION_MASTER_FINAL_v1.docx": "15GYGelGGAIPEVPGkXZeM5HpqrTRZzokq",
}

def read_locked_master(token, title, path):
    # No publicly accessible link or signed URL. Exact-name private Drive lookup.
    escaped = title.replace("'", "\\'")
    params = dict(q="name = '" + escaped +
                  "' and mimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' and trashed = false",
                  fields="nextPageToken,incompleteSearch,files(id,name,size,mimeType)", pageSize=100)
    headers = {"Authorization": "Bearer " + token}
    r = requests.get("https://www.googleapis.com/drive/v3/files",
                     headers=headers, params=params, timeout=40)
    if r.status_code != 200:
        fail("DRIVE_LIST_DENIED_" + str(r.status_code))
    payload = r.json()
    files = payload.get("files") or []
    if payload.get("incompleteSearch") or payload.get("nextPageToken") or len(files) > 1:
        fail("DRIVE_MASTER_SEARCH_NOT_UNIQUE_" + str(len(files)))
    if not files:
        # A drive.file-scoped GitHub OAuth token can fail to list user-owned legacy
        # files. Probe only the two independently verified private IDs, read-only.
        pinned_id = PINNED_MASTER_IDS.get(title)
        if not pinned_id:
            fail("DRIVE_MASTER_NOT_PINNED")
        probe = requests.get(
            "https://www.googleapis.com/drive/v3/files/" + quote(pinned_id, safe=""),
            headers=headers, params={"fields": "id,name,size,mimeType,trashed"},
            timeout=40, allow_redirects=False)
        if probe.status_code != 200:
            fail("DRIVE_PINNED_MASTER_METADATA_REJECTED_" + str(probe.status_code))
        info = probe.json()
        if (info.get("id") != pinned_id or info.get("name") != title
                or info.get("trashed") is not False
                or info.get("mimeType") != "application/vnd.openxmlformats-officedocument.wordprocessingml.document"):
            fail("DRIVE_PINNED_MASTER_METADATA_MISMATCH")
        files = [info]
    media = requests.get("https://www.googleapis.com/drive/v3/files/" +
                         quote(files[0]["id"], safe=""),
                         headers=headers, params={"alt": "media"}, timeout=100,
                         allow_redirects=False)
    if media.status_code != 200:
        fail("DRIVE_SOURCE_DOWNLOAD_DENIED_" + str(media.status_code))
    if not (10000 < len(media.content) < 20000000) or media.content[:2] != b"PK":
        fail("DRIVE_SOURCE_NOT_DOCX")
    path.write_bytes(media.content)
    return len(media.content)

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

def audit_edition(base, token, ed, model):
    with tempfile.TemporaryDirectory(prefix="ajk_legacy_qc_") as tmp:
        folder = Path(tmp)
        source = folder / "locked.docx"
        source_size = read_locked_master(token, ed["document"], source)
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
    assert len(EDITIONS) == 2
    assert EDITIONS[0]["book_id"] != EDITIONS[1]["book_id"]
    assert sum(e["chapters"] for e in EDITIONS) == 97
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
        required = ("GOOGLE_DRIVE_CLIENT_ID", "GOOGLE_DRIVE_CLIENT_SECRET", "GOOGLE_DRIVE_REFRESH_TOKEN")
        missing = [key for key in required if not os.getenv(key)]
        if missing:
            fail("DRIVE_PROBE_MISSING_CONFIG_" + "_".join(missing))
        token = drive_access_token()
        all_good = True
        with tempfile.TemporaryDirectory(prefix="ajk_source_probe_") as root:
            for ed in EDITIONS:
                try:
                    dest = Path(root) / "original.docx"
                    nbytes = read_locked_master(token, ed["document"], dest)
                    _, sections, _ = parse_source(dest)
                    indexes = [int(s.index) for s in sections]
                    aligned = indexes == list(range(ed["chapters"]))
                    print("LEGACY_SOURCE_PROBE " + json.dumps({
                        "book": ed["title"], "docx_bytes": nbytes,
                        "parsed_sections": len(indexes),
                        "expected_sections": ed["chapters"],
                        "index_continuity": aligned,
                        "classification": "SOURCE_READY" if aligned else "SOURCE_STRUCTURE_REVIEW"
                    }, sort_keys=True), flush=True)
                    all_good = aligned and all_good
                except Exception as exc:
                    print("LEGACY_SOURCE_PROBE " + json.dumps({
                        "book": ed["title"],
                        "classification": "BLOCKED",
                        "error_type": type(exc).__name__,
                        "reason": str(exc)[:120] if isinstance(exc, RuntimeError) else "SOURCE_PARSE_ERROR"
                    }, sort_keys=True), flush=True)
                    all_good = False
        print("LEGACY_SOURCE_FINAL " + json.dumps({
            "sources_ready": all_good, "no_audio_access": True,
            "no_writes": True}, sort_keys=True), flush=True)
        return 0 if all_good else 2
    if len(sys.argv) != 1:
        fail("UNRECOGNIZED_ARGUMENTS")
    base = require_credentials()
    print("LEGACY_QC_MODE=READ_ONLY_TWO_EXACT_EDITIONS", flush=True)
    token = drive_access_token()
    model = WhisperModel("base.en", device="cpu",
                         compute_type="int8", cpu_threads=2, num_workers=1)
    results = []
    for edition in EDITIONS:
        try:
            results.append(audit_edition(base, token, edition, model))
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
