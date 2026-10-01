from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np
import soundfile as sf

from worker import api, load_tts, gen_audio, silence

SAMPLE_TEXT = (
    "There are places the wind remembers long after people have forgotten them. "
    "At dusk, the road disappears into silence, and every footstep seems to carry a story."
)

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
    audio = gen_audio(model, state, SAMPLE_TEXT)
    audio = np.concatenate([audio, silence(0.25, model.sample_rate)])

    wav = outdir / "john_d_voice_sample.wav"
    sf.write(wav, audio, model.sample_rate, subtype="PCM_16")

    print(f"SAMPLE_TEXT={SAMPLE_TEXT}")
    print(f"SAMPLE_SECONDS={len(audio) / float(model.sample_rate):.2f}")
    print(f"SAMPLE_WAV={wav}")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
