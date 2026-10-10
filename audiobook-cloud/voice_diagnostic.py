#!/usr/bin/env python3
"""Private Pocket TTS voice probe. No novel or audio is uploaded as a CI artifact."""
from __future__ import annotations

import argparse
import gc
import json
import math
import sys
from pathlib import Path

import numpy as np

from worker import AsrChecker, load_tts, preflight_qc

PROBES = (
    "Am frühen Morgen ging der Mann durch den leeren Garten. Er öffnete langsam die kleine Holztür und begrüßte die Nachbarin.",
    "Die Kinder saßen am Fenster und warteten auf den Regen. Niemand wusste, warum der alte Zug heute so spät kam.",
)
# Current preview model + pinned 0.3 versus released German models with default sampling.
CANDIDATES = (
    ("existing_preview_pinned", "german_24l", 0.3),
    ("preview_native_default", "german_24l", None),
    ("distilled_native_default", "german", None),
)

def safe_number(value):
    try:
        number = float(value)
        return round(number, 4) if math.isfinite(number) else None
    except Exception:
        return None

def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--voice-response-file", type=Path, required=True)
    parser.add_argument("--workdir", type=Path, default=Path("/tmp/gandalf-de-probe"))
    args = parser.parse_args()
    payload = json.loads(args.voice_response_file.read_text(encoding="utf-8"))
    voice = payload.get("voice") or {}
    if not payload.get("ok") or voice.get("key") != "gandalf_de":
        raise RuntimeError("Private voice response does not match Gandalf DE")
    source = str(voice.get("source") or "")
    if not source.startswith("https://") or "ipoqyjrojljmbqslmxxf.supabase.co/" not in source:
        raise RuntimeError("Signed voice URL is not an authorized private Supabase URL")
    args.workdir.mkdir(parents=True, exist_ok=True)
    checker = AsrChecker("DE")
    results = []
    for key, language, temp in CANDIDATES:
        model = state = None
        item = {"candidate": key, "model": language, "temperature": temp, "samples": [], "all_pass": False}
        try:
            model, state = load_tts(language, source, args.workdir, temp=temp)
            for ix, text in enumerate(PROBES):
                # Fresh content, no copyrighted manuscript or private text.
                outpath = args.workdir / (key + "_s" + str(ix) + ".wav")
                result = preflight_qc(model, state, model.sample_rate, checker, text, outpath, "DE")
                item["samples"].append({
                    "passed": bool(result["passed"]),
                    "reasons": result["reasons"],
                    "duration_seconds": safe_number(result["duration_seconds"]),
                    "word_recall": safe_number(result["word_recall"]),
                    "sequence_similarity": safe_number(result["sequence_similarity"]),
                    "wer_similarity": safe_number(result["wer_similarity"]),
                    "silence_ratio": safe_number(result["silence_ratio"]),
                })
                outpath.unlink(missing_ok=True)
            item["all_pass"] = all(x["passed"] for x in item["samples"])
        except Exception as exc:
            # Never log URL, model state or voice data.
            item["error_type"] = type(exc).__name__
            item["error_detail"] = str(exc).split("https://")[0][:130]
        finally:
            del state, model
            gc.collect()
        results.append(item)
        print("VOICE_DIAGNOSTIC " + json.dumps(item, ensure_ascii=False, sort_keys=True), flush=True)
    # This file remains only on the ephemeral job runner. Never upload as artifact.
    print("VOICE_DIAGNOSTIC_PASS_CANDIDATES " + json.dumps(
        [r["candidate"] for r in results if r["all_pass"]]
    ), flush=True)
    return 0 if any(r["all_pass"] for r in results) else 2

if __name__ == "__main__":
    raise SystemExit(main())
