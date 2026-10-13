"""Offline tests only. These do not read personal manuscripts or call TTS."""
import io
from pathlib import Path
import sys
import unittest
import zipfile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "qc"))
from sample_selection import (SampleSelectionError, extract_docx_text,
                              choose_three_samples)

def synthetic_docx():
    xml = (b'<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
           b'<w:body><w:p><w:r><w:t>Chapter One</w:t></w:r></w:p>'
           b'<w:p><w:r><w:t>Hello reader. This is a synthetic test.</w:t></w:r></w:p>'
           b'</w:body></w:document>')
    stream = io.BytesIO()
    with zipfile.ZipFile(stream, 'w') as file:
        file.writestr('word/document.xml', xml)
    return stream.getvalue()

class ThreeSamplesTest(unittest.TestCase):
    def test_synthetic_docx_parse(self):
        self.assertEqual(extract_docx_text(synthetic_docx()),
                         'Chapter One\nHello reader. This is a synthetic test.')

    def test_invalid_docx_fails_closed(self):
        with self.assertRaises(SampleSelectionError):
            extract_docx_text(b'NOT A DOCX')

    def test_three_deterministic_nonoverlapping_samples(self):
        text = ' '.join(
            f'This fictional sentence number {i} contains enough unique simple '
            f'words to test sample positions in a long manuscript.'
            for i in range(900))
        samples = choose_three_samples(text, target_words=160)
        self.assertEqual(set(samples), {'beginning', 'middle', 'end'})
        self.assertEqual(samples, choose_three_samples(text,target_words=160))
        intervals = [samples[k] for k in ('beginning','middle','end')]
        self.assertLess(intervals[0]['end_word'], intervals[1]['start_word'])
        self.assertLess(intervals[1]['end_word'], intervals[2]['start_word'])
        for sample in intervals:
            self.assertGreaterEqual(sample['word_count'], 160)
            self.assertTrue(sample['text'].endswith('.'))

    def test_short_source_is_not_sent_to_tts(self):
        with self.assertRaises(SampleSelectionError):
            choose_three_samples('Hello world. This is too short.')
        with self.assertRaises(SampleSelectionError):
            choose_three_samples('Anything', target_words=99999)

if __name__ == '__main__':
    unittest.main()
