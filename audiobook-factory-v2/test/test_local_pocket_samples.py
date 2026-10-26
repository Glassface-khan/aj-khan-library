"""Strictly offline mock tests for local Pocket TTS first-pass sample pipeline.

No actual model weights, no HuggingFace access, no real manuscripts.
"""
import hashlib
import io
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
import wave
import zipfile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "production"))
from local_pocket_samples import (PrivateProductionError,
                                  build_sample_plan, render_three, main)

class FakeTTS:
    def render_wav(self, text, output):
        # Pure synthetic audio (test tone bytes are all zero). NOT a real voice.
        assert len(text)>10
        with open(output, "xb") as stream:
            with wave.open(stream, "wb") as wav:
                wav.setnchannels(1)
                wav.setsampwidth(2)
                wav.setframerate(16000)
                wav.writeframes(b"\0\0" * 16000)
        return 1.0

def fake_docx(path):
    paragraphs = ["This is synthetic sentence number " + str(i)
        + " with invented characters and a full stop." for i in range(900)]
    document = '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>'
    document += "".join('<w:p><w:r><w:t>' + t + '</w:t></w:r></w:p>' for t in paragraphs)
    document += '</w:body></w:document>'
    with zipfile.ZipFile(path, "w") as zipf:
        zipf.writestr("word/document.xml", document)
    return paragraphs

class LocalPocketTests(unittest.TestCase):
    def test_plan_and_three_private_wav_with_fake_tts(self):
        with tempfile.TemporaryDirectory() as temp:
            docx = Path(temp)/"synthetic.docx"
            fake_docx(docx)
            plan = build_sample_plan(docx)
            self.assertEqual(set(plan["samples"]), {"beginning","middle","end"})
            folder=Path(temp)/"private-output"
            manifest=render_three(plan,folder,FakeTTS())
            self.assertEqual(manifest["status"],"SAMPLES_ONLY_AWAITING_AUTHOR_QC")
            self.assertEqual(set(manifest["samples"]), {"beginning","middle","end"})
            self.assertFalse(any(entry["approved"] for entry in manifest["samples"].values()))
            self.assertNotIn("text",str(manifest))
            for k in ("beginning","middle","end"):
                path=folder/(k+".wav")
                self.assertTrue(path.is_file())
                self.assertEqual(manifest["samples"][k]["audio_sha256"],
                                 hashlib.sha256(path.read_bytes()).hexdigest())
                with wave.open(str(path),"rb") as wav:
                    self.assertEqual(wav.getnframes(),16000)
            with self.assertRaises(PrivateProductionError):
                render_three(plan,folder,FakeTTS())  # cannot overwrite previous
    def test_dry_run_never_creates_output_and_model_not_needed(self):
        with tempfile.TemporaryDirectory() as temp:
            docx=Path(temp)/"synthetic.docx"
            fake_docx(docx)
            destination=Path(temp)/"never-created"
            self.assertEqual(main(["--docx",str(docx),"--output",str(destination)]),0)
            self.assertFalse(destination.exists())
    def test_render_refuses_missing_voice_and_rights(self):
        with tempfile.TemporaryDirectory() as temp:
            docx=Path(temp)/"synthetic.docx"
            fake_docx(docx)
            destination=Path(temp)/"never-created"
            self.assertEqual(main(["--docx",str(docx),"--render","--output",str(destination)]),2)
            self.assertFalse(destination.exists())
    def test_rights_reviewed_cc0_preset_renders_with_mock_in_private_dir(self):
        import local_pocket_samples as mod
        with tempfile.TemporaryDirectory() as temp:
            docx=Path(temp)/"synthetic.docx"
            fake_docx(docx)
            target=Path(temp)/"private-cc0"
            self.assertEqual(
                mod.LICENSED_PRESETS["kyutai-cc0-default"],
                "hf://kyutai/tts-voices/unmute-prod-website/default_voice.wav")
            with patch.object(mod, "PocketTTSRenderer", return_value=FakeTTS()) as model:
                result=main(["--docx",str(docx),"--language","EN",
                             "--render","--voice-preset","kyutai-cc0-default",
                             "--output",str(target)])
            self.assertEqual(result,0)
            model.assert_called_once_with("EN",mod.LICENSED_PRESETS["kyutai-cc0-default"])
            self.assertEqual(len(list(target.glob("*.wav"))),3)
            self.assertFalse((target/"manuscript.docx").exists())

    def test_no_output_inside_public_repo_and_no_invalid_docx(self):
        with tempfile.TemporaryDirectory() as temp:
            docx=Path(temp)/"invalid.docx"
            docx.write_bytes(b"invalid")
            with self.assertRaises(Exception):
                build_sample_plan(docx)
        with self.assertRaises(PrivateProductionError):
            from local_pocket_samples import ensure_outside_repo
            ensure_outside_repo(ROOT/"should-never-exist")

if __name__=="__main__":
    unittest.main()
