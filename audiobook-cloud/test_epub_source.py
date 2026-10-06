import sys
import unittest
from dataclasses import dataclass
from pathlib import Path
from tempfile import TemporaryDirectory
from zipfile import ZipFile
sys.path.insert(0, str(Path(__file__).resolve().parent))
from epub_source import parse_epub

@dataclass
class Section:
    index: int
    kind: str
    label: str
    title: str
    paragraphs: list

class EpubSourceTest(unittest.TestCase):
    def fixture(self, path, second=None):
        with ZipFile(path, "w") as z:
            z.writestr("META-INF/container.xml", '<container><rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles></container>')
            names = ["cover", "chapter2", "chapter1", "notes"]
            z.writestr("OEBPS/content.opf", '<package><metadata><title>Fixture Novel</title></metadata><manifest>' +
                "".join(f'<item id="{n}" href="{n}.xhtml" media-type="application/xhtml+xml"/>' for n in names) +
                '</manifest><spine>' + "".join(f'<itemref idref="{n}"/>' for n in ["cover", "chapter1", "chapter2", "notes"]) + '</spine></package>')
            z.writestr("OEBPS/cover.xhtml", '<html><body><h1>Cover</h1><p>Excluded.</p></body></html>')
            z.writestr("OEBPS/notes.xhtml", '<html><body><h1>Historical Background</h1><p>Excluded.</p></body></html>')
            z.writestr("OEBPS/chapter1.xhtml", '<html xmlns:epub="http://www.idpf.org/2007/ops"><body><h1><span class="chapter-number">Chapter One</span><span class="chapter-title">The Door</span><span class="chapter-ornament">◆</span></h1><p>Hello <em>dear</em> reader.<a epub:type="noteref">1</a> After the note.</p><hr/><blockquote><p>A quotation.</p></blockquote></body></html>')
            z.writestr("OEBPS/chapter2.xhtml", second or '<html><body><h1>Chapter Two</h1><p>Second chapter.</p></body></html>')

    def test_spine_text_and_metadata(self):
        with TemporaryDirectory() as d:
            path = Path(d) / "source.epub"
            self.fixture(path)
            title, sections, diagnostics = parse_epub(path, Section)
            self.assertEqual(title, "Fixture Novel")
            self.assertEqual([s.label for s in sections], ["Chapter One", "Chapter Two"])
            self.assertEqual(sections[0].title, "The Door")
            self.assertEqual(sections[0].paragraphs, ["Hello dear reader. After the note.", "***", "A quotation."])
            self.assertEqual(len(diagnostics["non_narrative_files_skipped"]), 2)

    def test_empty_section_blocks_production(self):
        with TemporaryDirectory() as d:
            path = Path(d) / "source.epub"
            self.fixture(path, '<html><body><h1>Chapter Two</h1></body></html>')
            with self.assertRaisesRegex(ValueError, "Empty narrative"):
                parse_epub(path, Section)

    def test_part_divider_preserved_in_following_chapter(self):
        with TemporaryDirectory() as d:
            path = Path(d) / 'source.epub'
            self.fixture(path)
            with ZipFile(path) as z:
                entries = [(n, z.read(n)) for n in z.namelist()]
            with ZipFile(path, 'w') as z:
                for n, data in entries:
                    if n == 'OEBPS/content.opf':
                        data = data.replace(b'</manifest>', b'<item id="part" href="part.xhtml" media-type="application/xhtml+xml"/></manifest>')
                        data = data.replace(b'<itemref idref="chapter1"/>', b'<itemref idref="part"/><itemref idref="chapter1"/>')
                    z.writestr(n, data)
                z.writestr('OEBPS/part.xhtml', '<html xmlns:epub="http://www.idpf.org/2007/ops"><body epub:type="bodymatter"><h1>Part One — The Life</h1></body></html>')
            _, sections, diagnostics = parse_epub(path, Section)
            self.assertEqual(len(sections), 2)
            self.assertEqual(sections[0].paragraphs[0], 'Part One — The Life')
            self.assertEqual(sections[0].paragraphs[1], 'Hello dear reader. After the note.')
            self.assertIn('OEBPS/part.xhtml', diagnostics['narrative_files'])

    def test_unclassified_text_blocks_production(self):
        with TemporaryDirectory() as d:
            path = Path(d) / "source.epub"
            self.fixture(path)
            # Replace a narrative spine item by an unclassified standalone page.
            with ZipFile(path) as z:
                entries = [(n, z.read(n)) for n in z.namelist()]
            with ZipFile(path, "w") as z:
                for n, data in entries:
                    if n == "OEBPS/content.opf":
                        data = data.replace(b'chapter2.xhtml', b'unknown.xhtml')
                    if n == "OEBPS/chapter2.xhtml":
                        n, data = "OEBPS/unknown.xhtml", b'<html><body><h1>Unclassified</h1><p>Do not silently omit this text.</p></body></html>'
                    z.writestr(n, data)
            with self.assertRaisesRegex(ValueError, "cannot be safely classified"):
                parse_epub(path, Section)

    def test_companion_pages_preserve_all_text(self):
        for filename in ('note', 'context', 'a_note_on_history'):
            with self.subTest(filename=filename), TemporaryDirectory() as d:
                path = Path(d) / 'source.epub'
                self.fixture(path)
                with ZipFile(path) as z:
                    entries = [(n, z.read(n)) for n in z.namelist()]
                with ZipFile(path, 'w') as z:
                    for n, data in entries:
                        if n == 'OEBPS/content.opf':
                            data = data.replace(b'chapter2.xhtml', (filename + '.xhtml').encode())
                        if n == 'OEBPS/chapter2.xhtml':
                            n = 'OEBPS/' + filename + '.xhtml'
                            data = b'<html><body><h1>Background to the story</h1><p>Preserve this entire companion text.</p></body></html>'
                        z.writestr(n, data)
                _, sections, _ = parse_epub(path, Section)
                self.assertEqual(sections[1].paragraphs, ['Preserve this entire companion text.'])
                self.assertEqual(sections[1].title, 'Background to the story')

if __name__ == "__main__":
    unittest.main()
