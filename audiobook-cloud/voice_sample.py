from __future__ import annotations

import argparse
from pathlib import Path
import tempfile

import numpy as np
import soundfile as sf

from worker import download, parse_docx, chunks_for, load_tts, gen_audio, silence, write_mp3, api

VOICES = {
    "mary": {"name": "Mary", "ttsLanguage": "english", "source": "mary"},
    "bill_boerst": {"name": "Bill Boerst", "ttsLanguage": "english", "source": "bill_boerst"},
    "stuart_bell": {"name": "Stuart Bell", "ttsLanguage": "english", "source": "stuart_bell"},
    "george": {"name": "George", "ttsLanguage": "english", "source": "george"},
    "narration_us_f": {
        "name": "Narration (US, f)",
        "ttsLanguage": "english",
        "source": "hf://kyutai/tts-voices/unmute-prod-website/ex04_narration_longform_00001.wav",
    },
}

def render_voice(section, voice_key: str, outdir: Path) -> Path:
    voice = VOICES[voice_key]
    work = outdir / ("work_" + voice_key)
    work.mkdir(parents=True, exist_ok=True)
    model, state = load_tts(voice["ttsLanguage"], voice["source"], work)
    rendered = []
    for chunk in chunks_for(section):
        rendered.append(gen_audio(model, state, chunk.text))
        rendered.append(silence(0.22, model.sample_rate))
    audio = np.concatenate(rendered) if rendered else np.zeros(1, dtype=np.float32)
    wav = work / (voice_key + ".wav")
    mp3 = outdir / ("THE_TESTIMONY_OF_SAND_CH01_" + voice_key.upper() + ".mp3")
    sf.write(wav, audio, model.sample_rate, subtype="PCM_16")
    write_mp3(wav, mp3)
    print(f"{voice_key.upper()}_SECONDS={len(audio) / float(model.sample_rate):.2f}")
    print(f"{voice_key.upper()}_MP3={mp3}")
    return mp3

def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--job-id", required=True)
    p.add_argument("--section-index", type=int, default=1)
    p.add_argument("--output-dir", default="voice-sample")
    args = p.parse_args()

    outdir = Path(args.output_dir)
    outdir.mkdir(parents=True, exist_ok=True)

    remote = api("workerManifest", {"jobId": args.job_id})
    source = outdir / "source.docx"
    download(remote["sourceUrl"], source)
    title, sections, _ = parse_docx(source)
    if args.section_index < 0 or args.section_index >= len(sections):
        raise SystemExit(f"Invalid section index {args.section_index}; manuscript has {len(sections)} sections")
    section = sections[args.section_index]
    print(f"BOOK={title}")
    print(f"SECTION_INDEX={args.section_index}")
    print(f"SECTION_TITLE={section.title}")
    print(f"SECTION_WORDS={len(section.text.split())}")

    render_voice(section, "mary", outdir)
    render_voice(section, "narration_us_f", outdir)
    render_voice(section, "bill_boerst", outdir)
    render_voice(section, "stuart_bell", outdir)
    render_voice(section, "george", outdir)
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
