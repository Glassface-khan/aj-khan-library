"""Audiobook Factory 2.0: fail-closed, local-only three-sample QC.
No manuscript, voice recording or transcript is sent to any server by this file.
Call on a trusted *private* production runner; do NOT upload private audio to
public GitHub Actions artifacts or write them into a public Git repository.
"""
import argparse
import json
import re
import shutil
import struct
import subprocess
import sys
from pathlib import Path

SAMPLES = ("beginning", "middle", "end")
MIN_SIMILARITY = 0.92
MIN_WPM = 95
MAX_WPM = 195
MAX_CLIPPING = 0.0005
MAX_SILENCE = 0.32
MIN_DURATION = 10
MAX_DURATION = 240

def words(text):
    return re.findall(r"\w+(?:['’]\w+)?", text.casefold(), flags=re.UNICODE)

def word_error_rate(reference, transcript):
    a, b = words(reference), words(transcript)
    if not a: return 1.0
    dp = list(range(len(b) + 1))
    for i, x in enumerate(a, 1):
        new = [i] + [0] * len(b)
        for j, y in enumerate(b, 1):
            new[j] = min(dp[j] + 1, new[j-1] + 1, dp[j-1] + (x != y))
        dp = new
    return dp[-1] / len(a)

def decode_pcm(audio):
    if not shutil.which("ffmpeg"):
        raise RuntimeError("ffmpeg_missing")
    cmd = ["ffmpeg", "-nostdin", "-v", "error", "-i", str(audio),
           "-f", "s16le", "-ar", "16000", "-ac", "1", "-"]
    p = subprocess.run(cmd, capture_output=True, timeout=45)
    if p.returncode or not p.stdout or len(p.stdout) % 2:
        raise RuntimeError("audio_decode_failed")
    return p.stdout

def measure_pcm(pcm):
    """16kHz mono signed PCM; pauses in 250ms windows; conservative clipping check."""
    count = len(pcm) // 2
    if count < 16000: raise RuntimeError("audio_too_short")
    # 32 KB -> 1 sec decoded, not MP3 file-size guesses.
    duration = count / 16000
    clipped = 0
    silent_samples = 0
    frames = struct.iter_unpack("<h", pcm)
    window = []
    for (v,) in frames:
        clipped += abs(v) >= 32600
        window.append(v)
        if len(window) == 4000:
            # speech can contain ordinary silence; tolerate up to 32%.
            mean_square = sum(s*s for s in window) / len(window)
            if mean_square < 320**2:
                silent_samples += len(window)
            window.clear()
    return {
        "duration_seconds": round(duration, 2),
        "clipping_ratio": round(clipped / count, 6),
        "silence_ratio": round(silent_samples / count, 6),
    }

def evaluate_one(audio_path, source_text, asr_text):
    if not source_text.strip() or not asr_text.strip():
        return {"qc_status":"HOLD", "reasons":["missing_source_or_asr_transcript"]}
    pcm = decode_pcm(audio_path)
    m = measure_pcm(pcm)
    total = len(words(source_text))
    similarity = max(0, 1 - word_error_rate(source_text, asr_text))
    wpm = total * 60 / m["duration_seconds"]
    reasons = []
    if similarity < MIN_SIMILARITY: reasons.append("transcript_mismatch")
    if wpm < MIN_WPM or wpm > MAX_WPM: reasons.append("speech_rate_out_of_range")
    if m["clipping_ratio"] > MAX_CLIPPING: reasons.append("clipping")
    if m["silence_ratio"] > MAX_SILENCE: reasons.append("excessive_silence")
    if not MIN_DURATION <= m["duration_seconds"] <= MAX_DURATION:
        reasons.append("sample_duration_out_of_range")
    return {
        "qc_status":"PASS" if not reasons else "HOLD",
        "reasons":reasons,
        "transcript_similarity":round(similarity,5),
        "words_per_minute":round(wpm,2),
        **m
    }

def main(argv=None):
    ap=argparse.ArgumentParser()
    for s in SAMPLES:
        ap.add_argument(f"--{s}-audio",type=Path,required=True)
        ap.add_argument(f"--{s}-source",type=Path,required=True)
        ap.add_argument(f"--{s}-asr",type=Path,required=True)
    ap.add_argument("--report",type=Path,required=True)
    a=ap.parse_args(argv)
    report = {"schema":"ajk-v2-qc-v1","samples":{},"full_production_permitted":False,
              "author_listening_approval_required":True}
    for s in SAMPLES:
        try:
            result=evaluate_one(
                getattr(a,s+"_audio"),
                getattr(a,s+"_source").read_text(encoding="utf-8"),
                getattr(a,s+"_asr").read_text(encoding="utf-8"))
        except Exception:
            result={"qc_status":"HOLD","reasons":["sample_qc_unavailable"]}
        report["samples"][s]=result
    # PASS is a *necessary*, never sufficient condition. Author still must listen.
    report["technical_qc_passed"]=all(
        report["samples"][s]["qc_status"]=="PASS" for s in SAMPLES)
    a.report.parent.mkdir(parents=True,exist_ok=True)
    a.report.write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding="utf-8")
    return 0 if report["technical_qc_passed"] else 2

if __name__=="__main__":
    sys.exit(main())
