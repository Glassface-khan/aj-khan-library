"""Offline tests: ONLY synthetic WAV files; no proprietary voice clips in GitHub."""
import sys
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import wave

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/"production"))
from voice_registry import VOICE_FILES, DEFAULT_VOICE, VoiceReferenceError, select_private_voice
from test_local_pocket_samples import FakeTTS, fake_docx
from local_pocket_samples import main


def generate_synthetic_wav(folder, name, rate=24000):
    p=Path(folder)/name
    with wave.open(str(p), "wb") as audio:
        audio.setnchannels(1)
        audio.setsampwidth(2)
        audio.setframerate(rate)
        audio.writeframes(b"\x00\x10"*rate*6)
    return p


class VoiceRegistryTest(unittest.TestCase):
    def test_registered_files_match_expected_language_and_default(self):
        self.assertEqual(DEFAULT_VOICE,"jessica")
        self.assertEqual(VOICE_FILES,{
            "jessica_en":"Jessica_EN_Factory_Reference.wav",
            "jessica_de":"Jessica_DE_Factory_Reference.wav",
            "gandalf_en":"Gandalf_EN_Factory_Reference.wav",
            "gandalf_de":"Gandalf_DE_Factory_Reference.wav",
        })

    def test_select_four_local_references_only(self):
        with tempfile.TemporaryDirectory() as temp:
            for key, filename in VOICE_FILES.items():
                p=generate_synthetic_wav(temp, filename)
                self.assertEqual(select_private_voice(key,temp,ROOT.parent),p)
            with self.assertRaises(VoiceReferenceError):
                select_private_voice("unlisted_voice",temp,ROOT.parent)

    def test_missing_and_corrupt_voice_file_fail(self):
        with tempfile.TemporaryDirectory() as temp:
            with self.assertRaises(VoiceReferenceError):
                select_private_voice("jessica_en",temp,ROOT.parent)
            p=Path(temp)/VOICE_FILES["jessica_en"]
            p.write_bytes(b"bad"+b"\0"*500)
            with self.assertRaises(VoiceReferenceError):
                select_private_voice("jessica_en",temp,ROOT.parent)

    def test_jessica_english_default_private_render_mocked(self):
        import local_pocket_samples as mod
        with tempfile.TemporaryDirectory() as temp:
            base=Path(temp)
            private=base/"voices"
            private.mkdir()
            reference=generate_synthetic_wav(private, VOICE_FILES["jessica_en"])
            docx=base/"book.docx"
            fake_docx(docx)
            destination=base/"samples"
            with patch.object(mod,"PocketTTSRenderer",return_value=FakeTTS()) as runner:
                status=main(["--docx",str(docx),"--language","EN","--voice-dir",str(private),
                             "--render","--confirm-voice-rights","--output",str(destination)])
            self.assertEqual(status,0)
            runner.assert_called_once_with("EN",str(reference))
            import json
            manifest=json.loads((destination/"private_manifest.json").read_text(encoding="utf-8"))
            self.assertEqual(manifest["voice_id"],"jessica_en")
            self.assertFalse((destination/"manuscript.docx").exists())
            self.assertFalse(json.loads((destination/"preliminary_qc.json").read_text())["full_production_permitted"])

    def test_gandalf_german_and_rights_fail_closed(self):
        import local_pocket_samples as mod
        with tempfile.TemporaryDirectory() as temp:
            base=Path(temp)
            private=base/"voices"
            private.mkdir()
            reference=generate_synthetic_wav(private,VOICE_FILES["gandalf_de"])
            docx=base/"book.docx"
            fake_docx(docx)
            destination=base/"samples"
            with patch.object(mod,"PocketTTSRenderer",return_value=FakeTTS()) as runner:
                denied=main(["--docx",str(docx),"--language","DE","--voice","gandalf",
                             "--voice-dir",str(private),"--render","--output",str(destination)])
                self.assertEqual(denied,2)
                self.assertFalse(destination.exists())
                allowed=main(["--docx",str(docx),"--language","DE","--voice","gandalf",
                              "--voice-dir",str(private),"--confirm-voice-rights",
                              "--render","--output",str(destination)])
            self.assertEqual(allowed,0)
            runner.assert_called_once_with("DE",str(reference))
            import json
            m=json.loads((destination/"private_manifest.json").read_text(encoding="utf-8"))
            self.assertEqual(m["voice_id"],"gandalf_de")


if __name__=="__main__":
    unittest.main()
