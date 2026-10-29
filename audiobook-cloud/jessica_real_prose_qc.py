#!/usr/bin/env python3
"""Read-only Jessica DE prose QC. Download private DOCX ephemerally; never print prose."""
from __future__ import annotations

import io
import json
import os
import shutil
import tempfile
import urllib.parse
import urllib.request
from pathlib import Path

import soundfile as sf
from docx import Document
from worker import AsrChecker, Section, chunks_for, download, german_chunk_text_pass, load_tts, preflight_qc

FILE_NAME = "DIE_FORM_DES_LICHTS__MASTER.docx"
SCOPE = "https://www.googleapis.com/auth/drive.file"
DRIVE_API = "https://www.googleapis.com/drive/v3"


def private_book_bytes() -> bytes:
    env = ["GOOGLE_DRIVE_CLIENT_ID", "GOOGLE_DRIVE_CLIENT_SECRET", "GOOGLE_DRIVE_REFRESH_TOKEN"]
    if not all(os.getenv(k) for k in env):
        raise ValueError("Missing pre-existing Drive credentials")
    payload = urllib.parse.urlencode({
        "client_id": os.environ[env[0]], "client_secret": os.environ[env[1]],
        "refresh_token": os.environ[env[2]], "grant_type": "refresh_token",
    }).encode("utf-8")
    req = urllib.request.Request("https://oauth2.googleapis.com/token", data=payload, method="POST")
    with urllib.request.urlopen(req, timeout=35) as response:
        token_data = json.load(response)
    if set(token_data.get("scope", "").split()) != {SCOPE}:
        raise ValueError("Expected restricted Drive file scope")
    headers = {"Authorization": "Bearer " + token_data["access_token"]}
    q = "name = '" + FILE_NAME + "' and trashed = false"
    params = urllib.parse.urlencode({"q": q, "fields": "nextPageToken,files(id,name,size,mimeType)", "page_size": 100})
    req = urllib.request.Request(DRIVE_API + "/files?" + params, headers=headers)
    with urllib.request.urlopen(req, timeout=40) as response:
        found = json.load(response)
    matches = [f for f in found.get("files", []) if
               f.get("name") == FILE_NAME and
               f.get("mimeType") == "application/vnd.openxmlformats-officedocument.wordprocessingml.document"]
    if len(matches) != 1 or found.get("nextPageToken"):
        raise ValueError("Private master not uniquely accessible to restricted Drive app")
    meta = matches[0]
    if not 100000 < int(meta.get("size") or 0) < 5000000:
        raise ValueError("Unexpected private manuscript file size")
    req = urllib.request.Request(DRIVE_API + "/files/" + urllib.parse.quote(meta["id"], safe="") + "?alt=media", headers=headers)
    with urllib.request.urlopen(req, timeout=90) as response:
        body = response.read(5000001)
    if len(body) != int(meta["size"]):
        raise ValueError("Private source download incomplete")
    return body


def real_chapter_chunks(docx_bytes: bytes):
    paragraphs = [p.text.strip() for p in Document(io.BytesIO(docx_bytes)).paragraphs]
    if not any(p == "DIE FORM DES LICHTS" for p in paragraphs[:15]):
        raise ValueError("Unexpected publication master title")
    start = next((i for i, p in enumerate(paragraphs) if p == "KAPITEL 1"), None)
    if start is None:
        raise ValueError("Chapter one not found")
    end = next((i for i in range(start + 1, len(paragraphs)) if
                paragraphs[i].startswith("KAPITEL 2")), len(paragraphs))
    chapter_paragraphs = [p for p in paragraphs[start + 1:end] if p]
    if len(chapter_paragraphs) < 10:
        raise ValueError("Unexpected chapter structure")
    section = Section(index=1, kind="chapter", label="KAPITEL 1", title="KAPITEL 1",
                      paragraphs=chapter_paragraphs)
    chunks = chunks_for(section, min_chunk_words=12)
    if len(chunks) < 15:
        raise ValueError("Unexpectedly few real prose chunks")
    # Original chapter opening, then at least 150 words including natural sentence breaks.
    chosen = chunks[:12]
    if sum(ch.word_count for ch in chosen) < 120:
        raise ValueError("Too little original prose for a meaningful test")
    return chosen


def main() -> int:
    try:
        with tempfile.TemporaryDirectory(prefix="jessica-prose-") as d:
            root = Path(d)
            original_chunks = real_chapter_chunks(private_book_bytes())
            print("JESSICA_REAL_PROSE_SOURCE_OK chapter=1 chunks=" + str(len(original_chunks)), flush=True)
            voice_response = json.loads(Path("/tmp/private-jessica-voice.json").read_text())
            voice = voice_response.get("voice") or {}
            if voice_response.get("ok") is not True or voice.get("key") != "jessica_de":
                raise ValueError("Unexpected private voice identity")
            voice_url = str(voice.get("source") or "")
            parsed = urllib.parse.urlparse(voice_url)
            if (parsed.scheme != "https" or parsed.hostname != "ipoqyjrojljmbqslmxxf.supabase.co"
                    or not parsed.path.startswith("/storage/v1/")):
                raise ValueError("Unexpected private voice storage origin")
            recording = root / "reference.wav"
            download(voice_url, recording)
            samples, rate = sf.read(recording, dtype="float32")
            if rate != 24000 or samples.ndim != 1 or not 10 <= len(samples) / rate <= 35:
                raise ValueError("Invalid approved voice reference")
            front = root / "front.wav"
            sf.write(front, samples[int(.9 * rate):int(min(len(samples) / rate - .5, 13.9) * rate)], rate)
            checker = AsrChecker("DE")
            all_results = []
            for label, reference, count in (("production_original", recording, 12),
                                            ("front_comparison", front, 3)):
                model, state = load_tts("german_24l", str(reference), root, temp=None, voice_key="jessica_de")
                passed = 0
                failures = []
                for index, chunk in enumerate(original_chunks[:count]):
                    wav = root / ("probe_" + label + "_" + str(index) + ".wav")
                    try:
                        qc = preflight_qc(model, state, model.sample_rate, checker, chunk.text, wav, "DE")
                        recognized = checker.transcribe(wav)
                        transcript_ok, transcript = german_chunk_text_pass(
                            chunk.text, recognized, chapter_opener=(index < 2))
                        verdict = bool(qc["passed"] and transcript_ok)
                        passed += int(verdict)
                        if not verdict:
                            failures.append({
                                "chunk": index,
                                "word_count": chunk.word_count,
                                "reasons": list(dict.fromkeys(qc["reasons"] + transcript["reasons"])),
                                "recall": round(float(transcript["word_recall"]), 3),
                                "silence_ratio": round(float(qc["silence_ratio"]), 3),
                            })
                    finally:
                        wav.unlink(missing_ok=True)
                all_results.append({"candidate": label, "passed": passed, "total": count, "failures": failures})
                print("JESSICA_REAL_PROSE_QC " + json.dumps(all_results[-1], sort_keys=True), flush=True)
            print("JESSICA_REAL_PROSE_SUMMARY " + json.dumps({
                "source": "private_Drive_publication_master", "chapter": 1,
                "samples": len(original_chunks), "production_released": False,
                "factory_jobs_changed": False,
                "all_pass": all(x["passed"] == x["total"] for x in all_results),
            }, sort_keys=True), flush=True)
            return 0 if all(x["passed"] == x["total"] for x in all_results) else 2
    except Exception as exc:
        # No exception text: never disclose OAuth, source text, or signed voice URL.
        print("JESSICA_REAL_PROSE_BLOCKED type=" + type(exc).__name__, flush=True)
        return 3


if __name__ == "__main__":
    raise SystemExit(main())
