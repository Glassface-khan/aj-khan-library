#!/usr/bin/env python3
"""Preliminary fail-closed QC for PRIVATE local TTS WAV files.

Measures format, duration, clipping and long silence. No ASR model is connected;
therefore a perfect acoustic result is ALWAYS HOLD until source-to-ASR checks
and explicit author listening approval have occurred.
"""
import argparse
import hashlib
import json
from pathlib import Path
import struct
import wave

SAMPLES=("beginning", "middle", "end")
MAX_SECONDS=300

def check_wav(path):
    try:
        with wave.open(str(path),"rb") as w:
            rate=w.getframerate()
            frames=w.getnframes()
            if w.getnchannels()!=1 or w.getsampwidth()!=2 or not 8000<=rate<=48000:
                raise ValueError("unsupported_wav_format")
            if frames<=0 or frames>MAX_SECONDS*rate:
                raise ValueError("wav_duration_outside_test_limits")
            raw=w.readframes(frames)
        if len(raw)!=frames*2:
            raise ValueError("short_wav_payload")
        clipped=silent=0
        window=max(1,rate//4)
        n=0
        power=0
        for (x,) in struct.iter_unpack("<h",raw):
            clipped+=int(abs(x)>=32600)
            power+=x*x
            n+=1
            if n==window:
                if power/n < 320*320:silent+=n
                n=0
                power=0
        duration=round(frames/rate,2)
        silence=round(silent/frames,5)
        ratio=round(clipped/frames,6)
        reasons=["asr_transcript_missing","author_listening_approval_missing"]
        if not 10<=duration<=240: reasons.append("duration_out_of_range")
        if ratio>0.0005: reasons.append("clipping")
        if silence>0.32: reasons.append("excessive_silence")
        return {"qc_status":"HOLD","reasons":reasons,"duration_seconds":duration,
                "clipping_ratio":ratio,"silence_ratio":silence}
    except (OSError,ValueError,EOFError,wave.Error,struct.error):
        return {"qc_status":"HOLD","reasons":["unreadable_wav"]}


def report_for_directory(folder):
    p=Path(folder).expanduser().resolve()
    manifest_path=p/"private_manifest.json"
    try:
        manifest=json.loads(manifest_path.read_text(encoding="utf-8"))
        if manifest["status"]!="SAMPLES_ONLY_AWAITING_AUTHOR_QC":
            raise ValueError("invalid_manifest_status")
        if set(manifest["samples"])!=set(SAMPLES):
            raise ValueError("missing_samples")
    except (OSError,ValueError,KeyError,TypeError):
        raise ValueError("private_manifest_invalid") from None
    report={"schema":"ajk-private-acoustic-preflight-v1",
            "asr_text_fidelity_checked":False,
            "technical_qc_passed":False,
            "full_production_permitted":False,
            "author_listening_approval_required":True,
            "samples":{}}
    for label in SAMPLES:
        entry=manifest["samples"][label]
        name=entry.get("file","") if isinstance(entry,dict) else ""
        if name!=label+".wav":
            raise ValueError("unexpected_audio_filename")
        path=p/name
        result=check_wav(path)
        if not path.is_file() or hashlib.sha256(path.read_bytes()).hexdigest()!=entry.get("audio_sha256"):
            result={"qc_status":"HOLD","reasons":["audio_checksum_mismatch"]}
        report["samples"][label]=result
    return report


def main(argv=None):
    parser=argparse.ArgumentParser(description="PRIVATE fail-closed WAV audio preflight, NO ASR")
    parser.add_argument("folder",help="Private sample output folder")
    args=parser.parse_args(argv)
    try:
        report=report_for_directory(args.folder)
        output=Path(args.folder)/"preliminary_qc.json"
        with output.open("x",encoding="utf-8") as f:
            json.dump(report,f,indent=2)
        print("PRELIMINARY QC ONLY: all samples HOLD until local ASR and author listening approval")
        return 0
    except (OSError,ValueError):
        print("STOP: sample QC could not be safely completed")
        return 2


if __name__=="__main__":
    raise SystemExit(main())
