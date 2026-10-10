#!/usr/bin/env python3
"""Private, read-only Gandalf EN reference comparison (no manuscripts or audio artifacts)."""
from __future__ import annotations
import argparse
import gc
import json
import math
from pathlib import Path

import soundfile as sf
from worker import AsrChecker, download, load_tts, preflight_qc

PROBES = {
    "gandalf_en": [
        "The little house stood beyond the old bridge, where the river turned sharply beneath the willow trees.",
        "When the letter finally arrived, she read it twice before placing it on the kitchen table.",
        "The children watched the first rain of autumn fall against the windows and waited quietly for their mother.",
    ],
}

def safe_num(value):
    try:
        val = float(value)
        return round(val, 4) if math.isfinite(val) else None
    except (ValueError, TypeError, OverflowError):
        return None

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--voice-key", choices=["gandalf_en"], required=True)
    parser.add_argument("--response-file", type=Path, required=True)
    parser.add_argument("--workdir", type=Path, default=Path("/tmp/private-gandalf-en-probe"))
    args = parser.parse_args()
    resp = json.loads(args.response_file.read_text(encoding="utf8"))
    voice = resp.get("voice") or {}
    if resp.get("ok") is not True or voice.get("key") != args.voice_key:
        raise ValueError("Unexpected private voice response")
    url = str(voice.get("source") or "")
    if not url.startswith("https://") or "ipoqyjrojljmbqslmxxf.supabase.co/" not in url:
        raise ValueError("Private signed voice URL is invalid")
    workdir = args.workdir
    workdir.mkdir(parents=True, exist_ok=True)
    original = workdir / "private_reference.wav"
    download(url, original)
    samples, sr = sf.read(original, dtype="float32")
    if samples.ndim != 1 or sr != 24000:
        raise ValueError("Expected mono 24k WAV voice file")
    duration = len(samples) / sr
    if not 10 <= duration <= 35:
        raise ValueError("Unexpected reference length")
    # Cut whole, connected speech, avoiding leading/trailing handling noises.
    windows = {
        "original": (0, duration),
        "front_trimmed": (4.0, min(duration - 0.5, 17.0)),
        "mid_trimmed": (13.0, min(duration - 0.5, 30.0)),
    }
    if False:  # English-only diagnostics; no German jobs
        plans = [
            ("preview_native_original", "german_24l", None, "original"),
            ("preview_native_front", "german_24l", None, "front_trimmed"),
            ("distilled_native_front", "german", None, "front_trimmed"),
            ("preview_pinned_front", "german_24l", 0.3, "front_trimmed"),
        ]
        lang = "DE"
    else:
        plans = [
            ("english_pinned_original", "english", 0.3, "original"),
            ("english_native_front", "english", None, "front_trimmed"),
            ("english_pinned_front", "english", 0.3, "front_trimmed"),
            ("english_pinned_mid", "english", 0.3, "mid_trimmed"),
        ]
        lang = "EN"
    for key, (start, stop) in windows.items():
        sf.write(workdir / (key + ".wav"), samples[int(start*sr):int(stop*sr)], sr)
    original.unlink(missing_ok=True)
    checker = AsrChecker(lang)
    results = []
    for label, model_name, temp, window in plans:
        model = state = None
        result = {"candidate": label, "model": model_name, "window": window, "all_pass": False, "samples": []}
        try:
            model, state = load_tts(model_name, str(workdir / (window + ".wav")), workdir, temp=temp)
            for i, text in enumerate(PROBES[args.voice_key]):
                dst = workdir / (label + "_" + str(i) + ".wav")
                res = preflight_qc(model, state, model.sample_rate, checker, text, dst, lang)
                dst.unlink(missing_ok=True)
                result["samples"].append({
                    "passed": bool(res["passed"]),
                    "reasons": res["reasons"],
                    "duration_seconds": safe_num(res["duration_seconds"]),
                    "word_recall": safe_num(res["word_recall"]),
                    "wer_similarity": safe_num(res["wer_similarity"]),
                    "sequence_similarity": safe_num(res["sequence_similarity"]),
                    "silence_ratio": safe_num(res["silence_ratio"]),
                })
            result["all_pass"] = all(x["passed"] for x in result["samples"])
        except Exception as exc:
            result["error_type"] = type(exc).__name__
            # Never echo signed reference URLs or audio contents.
        finally:
            del model, state
            gc.collect()
        results.append(result)
        print("GANDALF_EN_QC " + json.dumps({"voice": args.voice_key, **result}, ensure_ascii=False), flush=True)
    passing = [x["candidate"] for x in results if x["all_pass"]]
    print("GANDALF_EN_QC_SUMMARY " + json.dumps({"voice": args.voice_key, "reference_seconds": round(duration,2),
                                             "passes": passing}, ensure_ascii=False), flush=True)
    return 0 if passing else 2

if __name__ == "__main__":
    raise SystemExit(main())
