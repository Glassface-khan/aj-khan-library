from __future__ import annotations

import argparse
from pathlib import Path
import tempfile
import subprocess

import numpy as np
import soundfile as sf

from worker import download, parse_docx, chunks_for, load_tts, gen_audio, silence, write_mp3, api, AsrChecker, transcript_scores

VOICES = {
    "mary": {"name": "Mary", "ttsLanguage": "english", "source": "mary"},
    "bill_boerst": {"name": "Bill Boerst", "ttsLanguage": "english", "source": "bill_boerst"},
    "stuart_bell": {"name": "Stuart Bell", "ttsLanguage": "english", "source": "stuart_bell"},
    "george": {"name": "George", "ttsLanguage": "english", "source": "george"},
    "tommy": {"name": "Tommy", "ttsLanguage": "english", "source": "https://raw.githubusercontent.com/Glassface-khan/aj-khan-library/main/audiobook-cloud/RPReplay_Final1790942161.mp3"},
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
    print(f"SECTION_WORDS={section.word_count}")

    ref_mp3 = Path(__file__).resolve().parent / "RPReplay_Final1790942161.mp3"
    ref_wav = Path(__file__).resolve().parent / "tommy_reference_24k.wav"
    subprocess.run(["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-i", str(ref_mp3), "-ac", "1", "-ar", "24000", "-c:a", "pcm_s16le", str(ref_wav)], check=True)

    work = outdir / "work_tommy_preflight"
    work.mkdir(parents=True, exist_ok=True)
    model, state = load_tts("english", str(ref_wav), work)
    test_text = "The desert was quiet before the first light reached the ridge."
    test_audio = gen_audio(model, state, test_text)
    test_wav = work / "tommy_preflight.wav"
    test_mp3 = outdir / "TOMMY_PREFLIGHT.mp3"
    sf.write(test_wav, test_audio, model.sample_rate, subtype="PCM_16")
    write_mp3(test_wav, test_mp3)
    transcript = AsrChecker("EN").transcribe(test_wav)
    scores = transcript_scores(test_text, transcript)
    print(f"TOMMY_PREFLIGHT_TRANSCRIPT={transcript}")
    print(f"TOMMY_PREFLIGHT_SCORES={scores}")
    if scores["word_recall"] < 0.55 or scores["sequence_similarity"] < 0.45:
        raise SystemExit("Tommy preflight failed intelligibility gate; chapter render blocked")

    render_voice(section, "tommy", outdir)

    return 0

if __name__ == "__main__":
    raise SystemExit(main())
