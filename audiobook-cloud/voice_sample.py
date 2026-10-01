from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np
import soundfile as sf

from worker import api, load_tts, gen_audio, silence

SAMPLE_LINES = [
    "The road was quiet beneath the evening sky.",
    "A warm wind carried dust across the empty fields.",
    "Somewhere ahead, a door opened into the dark.",
]

def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--job-id", required=True)
    p.add_argument("--output-dir", default="voice-sample")
    args = p.parse_args()

    outdir = Path(args.output_dir)
    outdir.mkdir(parents=True, exist_ok=True)

    remote = api("workerManifest", {"jobId": args.job_id})
    voice = remote["voice"]

    model, state = load_tts(voice["ttsLanguage"], voice["source"], outdir)
    rendered = []
    for line in SAMPLE_LINES:
        rendered.append(gen_audio(model, state, line))
        rendered.append(silence(0.35, model.sample_rate))
    audio = np.concatenate(rendered)

    wav = outdir / "john_d_voice_sample.wav"
    sf.write(wav, audio, model.sample_rate, subtype="PCM_16")

    print("SAMPLE_TEXT=" + " ".join(SAMPLE_LINES))
    print(f"SAMPLE_SECONDS={len(audio) / float(model.sample_rate):.2f}")
    print(f"SAMPLE_WAV={wav}")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
