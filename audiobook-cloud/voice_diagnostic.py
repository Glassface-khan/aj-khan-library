#!/usr/bin/env python3
"""Private, read-only TTS diagnosis. No manuscript, voice or generated audio is uploaded."""
from __future__ import annotations

import argparse
import gc
import json
import math
from pathlib import Path

import numpy as np
import soundfile as sf
from worker import AsrChecker, download, load_tts, preflight_qc

PROBES = (
    "Am frühen Morgen ging der Mann durch den leeren Garten. Er öffnete langsam die kleine Holztür und begrüßte die Nachbarin.",
    "Die Kinder saßen am Fenster und warteten auf den Regen. Niemand wusste, warum der alte Zug heute so spät kam.",
)
# Compare upstream built-in against the same model on alternate crops of the
# user's own already-authorised voice reference. Strict QC stays unchanged.
CANDIDATES = (
    ("official_builtin_juergen", "german", None, "juergen"),
    ("user_first_17s", "german", None, "crop_4_17.wav"),
    ("user_mid_17s", "german", None, "crop_13_30.wav"),
    ("user_long_26s", "german", None, "crop_4_30.wav"),
    ("preview_user_first_17s", "german_24l", None, "crop_4_17.wav"),
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
    response = json.loads(args.voice_response_file.read_text(encoding="utf-8"))
    voice = response.get("voice") or {}
    if not response.get("ok") or voice.get("key") != "gandalf_de":
        raise RuntimeError("Private voice response is not Gandalf DE")
    url = str(voice.get("source") or "")
    if not url.startswith("https://") or "ipoqyjrojljmbqslmxxf.supabase.co/" not in url:
        raise RuntimeError("Voice reference URL is not an authorized signed URL")

    args.workdir.mkdir(parents=True, exist_ok=True)
    original = args.workdir / "private_reference.wav"
    download(url, original)
    samples, rate = sf.read(original, dtype="float32")
    if samples.ndim != 1 or rate != 24000 or len(samples) < rate * 30:
        raise RuntimeError("Stored voice reference is not 30+ seconds of mono 24kHz WAV")
    for start, end in ((4, 17), (13, 30), (4, 30)):
        sf.write(args.workdir / f"crop_{start}_{end}.wav", samples[start * rate:end * rate], rate)
    original.unlink(missing_ok=True)

    asr = AsrChecker("DE")
    results = []
    for key, language, temp, speaker in CANDIDATES:
        model = state = None
        item = {"candidate": key, "model": language, "samples": [], "all_pass": False}
        try:
            prompt = speaker if speaker == "juergen" else str(args.workdir / speaker)
            model, state = load_tts(language, prompt, args.workdir, temp=temp)
            for ix, text in enumerate(PROBES):
                audio = args.workdir / (key + "_s" + str(ix) + ".wav")
                result = preflight_qc(model, state, model.sample_rate, asr, text, audio, "DE")
                item["samples"].append({
                    "passed": bool(result["passed"]),
                    "reasons": result["reasons"],
                    "duration_seconds": safe_number(result["duration_seconds"]),
                    "word_recall": safe_number(result["word_recall"]),
                    "sequence_similarity": safe_number(result["sequence_similarity"]),
                    "wer_similarity": safe_number(result["wer_similarity"]),
                    "silence_ratio": safe_number(result["silence_ratio"]),
                })
                audio.unlink(missing_ok=True)
            item["all_pass"] = all(s["passed"] for s in item["samples"])
        except Exception as error:
            item["error_type"] = type(error).__name__
            item["error_detail"] = str(error).split("https://")[0][:120]
        finally:
            del model, state
            gc.collect()
        results.append(item)
        print("VOICE_DIAGNOSTIC " + json.dumps(item, ensure_ascii=False, sort_keys=True), flush=True)
    print("VOICE_DIAGNOSTIC_PASS_CANDIDATES " + json.dumps([r["candidate"] for r in results if r["all_pass"]]), flush=True)
    return 0 if any(r["all_pass"] and r["candidate"] != "official_builtin_juergen" for r in results) else 2

if __name__ == "__main__":
    raise SystemExit(main())
