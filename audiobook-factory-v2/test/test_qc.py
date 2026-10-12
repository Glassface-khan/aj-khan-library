import unittest
from array import array
from pathlib import Path
import sys

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/"qc"))
from three_sample_gate import words,word_error_rate,measure_pcm

class AudioGateTests(unittest.TestCase):
    def test_unicode_words(self):
        self.assertEqual(words("Über das Licht. It’s here!"),["über","das","licht","it’s","here"])
    def test_wer_exact(self):
        self.assertEqual(word_error_rate("The book was on the table","The book was on the table"),0)
    def test_wer_one_substitution(self):
        self.assertAlmostEqual(word_error_rate("she was there","she was here"),1/3)
    def test_empty_input_fails_closed(self):
        self.assertEqual(word_error_rate("", ""),1)
    def test_pcm_quiet(self):
        data=array("h",[0]*16000).tobytes()
        m=measure_pcm(data)
        self.assertEqual(m["duration_seconds"],1)
        self.assertEqual(m["clipping_ratio"],0)
        self.assertEqual(m["silence_ratio"],1)
    def test_pcm_clipping_detected(self):
        data=array("h",[32767]*16000).tobytes()
        m=measure_pcm(data)
        self.assertEqual(m["clipping_ratio"],1)
        self.assertEqual(m["silence_ratio"],0)

if __name__=="__main__":
    unittest.main()
