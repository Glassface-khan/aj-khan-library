#!/usr/bin/env python3
"""PRIVATE, local-only Pocket TTS sample renderer for AJK Factory V2.

First stage: DOCX -> deterministic three private excerpts -> WAV samples.
No manuscript, voice or audio ever goes to GitHub, Cloudflare or a hosted API.
Model weights may be downloaded from upstream on first real use.
No commercial or unauthorized voice use is granted by this tool.

Without --render, this prints *counts only*, never passage content.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import sys
import wave

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(ROOT / "qc"))
from sample_selection import extract_docx_text, choose_three_samples, SampleSelectionError
from voice_registry import VOICE_FILES, DEFAULT_VOICE, VoiceReferenceError, select_private_voice

LANGUAGES = {"EN": "english", "DE": "german"}
PARTS = ("beginning", "middle", "end")
# Preferred project voices: Jessica (default), Gandalf (alternative).
# WAV references live only in a private local folder, never in this repo.
LICENSED_PRESETS = {"kyutai-cc0-default": "hf://kyutai/tts-voices/unmute-prod-website/default_voice.wav"}
MIN_PROMPT_BYTES = 256


class PrivateProductionError(ValueError):
    pass


def ensure_outside_repo(path):
    """Never write source audio/manifests into this publicly hosted repo."""
    target = Path(path).expanduser().resolve()
    repo = ROOT.parent.resolve()
    if target == repo or repo in target.parents:
        raise PrivateProductionError("private_output_must_be_outside_public_repository")
    return target


def build_sample_plan(docx_path, language="EN"):
    if language not in LANGUAGES:
        raise PrivateProductionError("unsupported_language")
    source = Path(docx_path).expanduser().resolve()
    if source.suffix.lower() != ".docx" or not source.is_file():
        raise PrivateProductionError("source_must_be_local_docx")
    if source == ROOT.parent.resolve() or ROOT.parent.resolve() in source.parents:
        raise PrivateProductionError("source_must_be_outside_public_repository")
    if source.stat().st_size > 15_000_000:
        raise PrivateProductionError("docx_size_invalid")
    raw = source.read_bytes()
    text = extract_docx_text(raw)
    samples = choose_three_samples(text, target_words=160)
    return {"language": language, "source_sha256": hashlib.sha256(raw).hexdigest(),
            "samples": samples}


class PocketTTSRenderer:
    """Lazy-load CPU model. Never sends passages or voice prompt to a remote TTS API."""
    def __init__(self, language, authorized_voice_wav):
        import numpy as np  # optional, installed by Pocket TTS
        from pocket_tts import TTSModel
        self.np = np
        self.model = TTSModel.load_model(language=LANGUAGES[language])
        self.state = self.model.get_state_for_audio_prompt(str(authorized_voice_wav))

    def render_wav(self, text, output):
        audio = self.model.generate_audio(self.state, text)
        pcm = audio.detach().cpu().numpy().reshape(-1)
        if not len(pcm) or not self.np.isfinite(pcm).all():
            raise PrivateProductionError("invalid_synthesized_audio")
        data = (self.np.clip(pcm, -1, 1) * 32767).astype("<i2").tobytes()
        # Exclusive create: do not overwrite previous approved or unreviewed results.
        with open(output, "xb") as target:
            with wave.open(target, "wb") as wav:
                wav.setnchannels(1)
                wav.setsampwidth(2)
                wav.setframerate(int(self.model.sample_rate))
                wav.writeframes(data)
        return len(pcm) / float(self.model.sample_rate)


def render_three(plan, dest, renderer):
    """Testable output boundary: renderer is injected in offline/mock tests."""
    dest = ensure_outside_repo(dest)
    if dest.exists():
        raise PrivateProductionError("output_directory_must_not_exist")
    dest.mkdir(parents=True, mode=0o700)
    manifest = {"status": "SAMPLES_ONLY_AWAITING_AUTHOR_QC",
                "language": plan["language"],
                "source_sha256": plan["source_sha256"],
                "samples": {}}
    for part in PARTS:
        entry = plan["samples"][part]
        target = dest / f"{part}.wav"
        seconds = renderer.render_wav(entry["text"], target)
        if not target.is_file() or target.stat().st_size < 44 or seconds <= 0:
            raise PrivateProductionError("sample_audio_invalid")
        manifest["samples"][part] = {
            "file": target.name,
            "duration_seconds": round(seconds, 2),
            "word_count": entry["word_count"],
            "start_word": entry["start_word"],
            "end_word": entry["end_word"],
            "audio_sha256": hashlib.sha256(target.read_bytes()).hexdigest(),
            "approved": False,
        }
    # No text, voice samples, tokens or book title in this manifest.
    with (dest / "private_manifest.json").open("x", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2)
    return manifest


def main(argv=None):
    ap = argparse.ArgumentParser(description="Private EPUB-factory precursor: local DOCX to three WAV samples")
    ap.add_argument("--docx", required=True, help="Private local DOCX; never add to GitHub")
    ap.add_argument("--language", choices=sorted(LANGUAGES), default="EN")
    ap.add_argument("--render", action="store_true", help="Actually synthesize 3 samples on this computer")
    ap.add_argument("--output", help="New private folder OUTSIDE the public git repository")
    ap.add_argument("--voice-wav", help="Custom local WAV reference with verified rights")
    ap.add_argument("--voice", choices=("jessica", "gandalf"), default=None,
                    help="Use supplied Jessica or Gandalf reference; Jessica is default")
    ap.add_argument("--voice-dir", help="Private folder containing the four reference WAVs")
    ap.add_argument("--voice-preset", choices=sorted(LICENSED_PRESETS),
                    help="Whitelisted rights-reviewed CC0 reference voice")
    ap.add_argument("--confirm-voice-rights", action="store_true",
                    help="You are authorized to synthesize with this particular voice reference")
    args = ap.parse_args(argv)
    try:
        plan = build_sample_plan(args.docx, args.language)
        print("PRIVATE PLAN: language", args.language, "sample counts",
              ", ".join(f"{part}={plan['samples'][part]['word_count']}" for part in PARTS))
        if not args.render:
            print("DRY RUN ONLY: no TTS, no files uploaded, no private excerpts printed")
            return 0
        if not args.output:
            raise PrivateProductionError("render_requires_private_output")
        if (args.voice_wav or args.voice_preset) and (args.voice or args.voice_dir):
            raise PrivateProductionError("multiple_voice_sources")
        if not args.voice_wav and not args.voice_preset:
            if not args.voice_dir:
                raise PrivateProductionError("private_voice_dir_required")
            if not args.confirm_voice_rights:
                raise PrivateProductionError("local_voice_requires_explicit_rights_confirmation")
            selected_id = (args.voice or DEFAULT_VOICE) + "_" + args.language.lower()
            voice_source = str(select_private_voice(selected_id, args.voice_dir, ROOT.parent))
        elif args.voice_preset:
            voice_source = LICENSED_PRESETS[args.voice_preset]
        else:
            if not args.confirm_voice_rights:
                raise PrivateProductionError("local_voice_requires_explicit_rights_confirmation")
            voice = Path(args.voice_wav).expanduser().resolve()
            if not voice.is_file() or voice.suffix.lower() != ".wav" or voice.stat().st_size < MIN_PROMPT_BYTES:
                raise PrivateProductionError("voice_reference_must_be_valid_local_wav")
            if ROOT.parent.resolve() in voice.parents:
                raise PrivateProductionError("voice_reference_must_be_outside_public_repository")
            voice_source = str(voice)
        out = ensure_outside_repo(args.output)
        if out.exists():
            raise PrivateProductionError("output_directory_must_not_exist")
        renderer = PocketTTSRenderer(args.language, voice_source)
        manifest = render_three(plan, out, renderer)
        # A successful WAV is never a production approval. Acoustic checks
        # are preliminary only; there is no offline ASR connected yet.
        from local_wav_preflight import report_for_directory
        preflight = report_for_directory(out)
        with (out / "preliminary_qc.json").open("x", encoding="utf-8") as result:
            json.dump(preflight, result, indent=2)
        print("SUCCESS: three local private WAV files created; NOT approved; NOT uploaded.")
        print("PRELIMINARY QC HOLD: ASR and personal listening approval are still required.")
        print("Result files:", ", ".join(manifest["samples"][p]["file"] for p in PARTS))
        return 0
    except (PrivateProductionError, VoiceReferenceError, SampleSelectionError, OSError) as e:
        # All errors are controlled codes; no manuscript passages or paths.
        msg = str(e) if isinstance(e, (PrivateProductionError, VoiceReferenceError, SampleSelectionError)) else "local_file_error"
        print("STOP:", msg, file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
