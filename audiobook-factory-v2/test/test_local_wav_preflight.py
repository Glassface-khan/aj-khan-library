"""Offline checks of fail-closed private WAV acoustic preflight. No real TTS."""
import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest
import wave

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/"qc"))
from local_wav_preflight import check_wav, report_for_directory


def audio(path, clip=False, seconds=12):
    with wave.open(str(path),"wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(16000)
        value=b"\xfe\x7f" if clip else b"\x00\x20"
        w.writeframes(value*16000*seconds)


class AcousticPreflightTests(unittest.TestCase):
    def test_report_stays_hold_even_when_acoustics_look_good(self):
        with tempfile.TemporaryDirectory() as temp:
            p=Path(temp)
            samples={}
            for label in ("beginning","middle","end"):
                dest=p/(label+".wav")
                audio(dest)
                samples[label]={"file":dest.name,
                                "audio_sha256":hashlib.sha256(dest.read_bytes()).hexdigest()}
            (p/"private_manifest.json").write_text(
                json.dumps({"status":"SAMPLES_ONLY_AWAITING_AUTHOR_QC","samples":samples}))
            result=report_for_directory(p)
            self.assertFalse(result["technical_qc_passed"])
            self.assertFalse(result["full_production_permitted"])
            self.assertFalse(result["asr_text_fidelity_checked"])
            for row in result["samples"].values():
                self.assertEqual(row["qc_status"],"HOLD")
                self.assertIn("asr_transcript_missing",row["reasons"])
                self.assertIn("author_listening_approval_missing",row["reasons"])
                self.assertNotIn("clipping",row["reasons"])
                self.assertNotIn("excessive_silence",row["reasons"])
            (p/"middle.wav").write_bytes(b"tampered")
            result=report_for_directory(p)
            self.assertEqual(result["samples"]["middle"]["reasons"],["audio_checksum_mismatch"])

    def test_clipping_or_silence_never_passes(self):
        with tempfile.TemporaryDirectory() as temp:
            path=Path(temp)/"test.wav"
            audio(path,clip=True)
            result=check_wav(path)
            self.assertEqual(result["qc_status"],"HOLD")
            self.assertIn("clipping",result["reasons"])
            path.write_bytes(b"invalid")
            result=check_wav(path)
            self.assertEqual(result["reasons"],["unreadable_wav"])

    def test_invalid_manifest_is_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            with self.assertRaises(ValueError):
                report_for_directory(temp)


if __name__=="__main__":
    unittest.main()
