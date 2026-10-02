#!/usr/bin/env python3
# Dedicated German narration validation for Arne B. — asset restored.
from pathlib import Path
import argparse

import numpy as np
import soundfile as sf

from worker import Section, api, load_tts, gen_audio, chunks_for, silence, write_mp3, AsrChecker, transcript_scores

TEST_PARAGRAPHS = [
    "Am frühen Morgen lag der Bahnhof noch fast leer. Nur ein Mann mit einem dunkelblauen Mantel stand unter der Uhr und wartete, obwohl längst kein Zug mehr angekündigt war. Als die ersten Schritte über den Bahnsteig hallten, hob er den Kopf, sah kurz zur Treppe und steckte die Hände wieder in die Taschen.",
    "Hinter dem Gebäude begann die Stadt langsam wach zu werden: eine Lieferwagen­tür schlug zu, irgendwo klirrte Geschirr, und aus einem geöffneten Fenster drang leise Musik. Nichts daran war ungewöhnlich, und doch hatte Daniel das Gefühl, dass dieser Morgen anders verlaufen würde als die vielen davor.",
    "Er nahm den gefalteten Zettel aus der Jackentasche. Darauf stand nur ein Satz: Wenn du wissen willst, warum dein Vater damals gegangen ist, komm allein. Daniel las ihn noch einmal, langsam, Wort für Wort, und bemerkte erst jetzt, dass auf der Rückseite mit Bleistift eine Uhrzeit notiert war."
]

PREFLIGHT_TEXT = "Der Morgen war still, bevor die ersten Schritte auf dem Bahnsteig zu hören waren."


def render_section(model, state, section: Section) -> np.ndarray:
    parts = []
    for chunk in chunks_for(section):
        parts.append(gen_audio(model, state, chunk.text))
        if chunk.pause_after > 0:
            parts.append(silence(chunk.pause_after, model.sample_rate))
    return np.concatenate(parts) if parts else np.zeros(1, dtype=np.float32)


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--output-dir", default="arne-validation")
    args = p.parse_args()

    outdir = Path(args.output_dir)
    outdir.mkdir(parents=True, exist_ok=True)
    workdir = outdir / "work"
    workdir.mkdir(parents=True, exist_ok=True)

    remote = api("workerVoice", {"voiceKey": "arne_b"})
    voice = remote["voice"]
    if not voice.get("source"):
        raise SystemExit("Arne voice source unavailable")

    model, state = load_tts(voice["ttsLanguage"], voice["source"], workdir)

    preflight = gen_audio(model, state, PREFLIGHT_TEXT)
    pre_wav = outdir / "ARNE_DE_PREFLIGHT.wav"
    sf.write(pre_wav, preflight, model.sample_rate, subtype="PCM_16")
    transcript = AsrChecker("DE").transcribe(pre_wav)
    scores = transcript_scores(PREFLIGHT_TEXT, transcript)
    print(f"ARNE_PREFLIGHT_TRANSCRIPT={transcript}")
    print(f"ARNE_PREFLIGHT_SCORES={scores}")
    if scores["word_recall"] < 0.55 or scores["sequence_similarity"] < 0.45:
        raise SystemExit("Arne preflight failed intelligibility gate")

    section = Section(0, "chapter", "Test", "", TEST_PARAGRAPHS)
    audio = render_section(model, state, section)
    wav = outdir / "ARNE_DE_VALIDATION.wav"
    mp3 = outdir / "ARNE_DE_VALIDATION.mp3"
    sf.write(wav, audio, model.sample_rate, subtype="PCM_16")
    write_mp3(wav, mp3)

    full_transcript = AsrChecker("DE").transcribe(wav)
    full_scores = transcript_scores(section.spoken_text, full_transcript)
    print(f"ARNE_FULL_TRANSCRIPT={full_transcript}")
    print(f"ARNE_FULL_SCORES={full_scores}")
    print(f"ARNE_SECONDS={len(audio) / float(model.sample_rate):.2f}")
    print(f"ARNE_MP3={mp3}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
