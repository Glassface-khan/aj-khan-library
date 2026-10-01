from __future__ import annotations

from pathlib import Path
import numpy as np
import soundfile as sf
from pocket_tts import TTSModel

VOICES = ["peter_yearsley", "stuart_bell", "bill_boerst"]
LINES = [
    "The road was quiet beneath the evening sky.",
    "A warm wind carried dust across the empty fields.",
    "He stopped at the edge of the ruined village.",
    "Nothing moved except the cloth above the doorway.",
    "For a moment, he thought someone was waiting inside.",
]

def mono(x):
    a = np.asarray(x.detach().cpu().numpy(), dtype=np.float32)
    return a.reshape(-1)

def main():
    out = Path("voice-comparison")
    out.mkdir(exist_ok=True)
    model = TTSModel.load_model(language="english")
    sr = model.sample_rate
    pause = np.zeros(int(sr * 0.35), dtype=np.float32)
    for voice in VOICES:
        state = model.get_state_for_audio_prompt(voice)
        parts = []
        for line in LINES:
            parts.append(mono(model.generate_audio(state, line, copy_state=True)))
            parts.append(pause)
        audio = np.concatenate(parts)
        path = out / f"{voice}.wav"
        sf.write(path, audio, sr, subtype="PCM_16")
        print(f"{voice}: {len(audio)/sr:.2f}s -> {path}")

if __name__ == "__main__":
    main()
