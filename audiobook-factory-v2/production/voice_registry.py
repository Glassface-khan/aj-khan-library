"""Private local voice file selection; contains *filenames*, not audio or rights claims.

No WAV references are committed to public GitHub. The author keeps all four
files in a private folder, then selects Jessica or Gandalf in EN or DE.
Use only material the author is legally entitled to use.
"""
from pathlib import Path
import wave

VOICE_FILES = {
    "jessica_en": "Jessica_EN_Factory_Reference.wav",
    "jessica_de": "Jessica_DE_Factory_Reference.wav",
    "gandalf_en": "Gandalf_EN_Factory_Reference.wav",
    "gandalf_de": "Gandalf_DE_Factory_Reference.wav",
}

DEFAULT_VOICE = "jessica"

class VoiceReferenceError(ValueError):
    pass


def select_private_voice(voice_id, private_voice_folder, repository_root):
    if voice_id not in VOICE_FILES:
        raise VoiceReferenceError("unknown_voice_id")
    directory = Path(private_voice_folder).expanduser().resolve()
    repo = Path(repository_root).expanduser().resolve()
    if directory == repo or repo in directory.parents:
        raise VoiceReferenceError("private_voice_folder_must_be_outside_public_repository")
    if not directory.is_dir():
        raise VoiceReferenceError("private_voice_folder_missing")
    file = (directory / VOICE_FILES[voice_id]).resolve()
    if not file.is_relative_to(directory) or repo == file or repo in file.parents:
        raise VoiceReferenceError("voice_reference_outside_private_folder")
    if not file.is_file() or file.stat().st_size < 256:
        raise VoiceReferenceError("private_voice_reference_missing")
    try:
        with wave.open(str(file), "rb") as wav:
            rate = wav.getframerate()
            if wav.getnchannels() != 1 or wav.getsampwidth() != 2 or not 16000 <= rate <= 48000:
                raise VoiceReferenceError("voice_reference_bad_audio_format")
            seconds = wav.getnframes() / rate
            if seconds < 5 or seconds > 120:
                raise VoiceReferenceError("voice_reference_invalid_length")
    except (EOFError, OSError, wave.Error):
        raise VoiceReferenceError("voice_reference_invalid_wav") from None
    return file
