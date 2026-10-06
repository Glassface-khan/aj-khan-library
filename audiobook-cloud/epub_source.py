"""Read narrative EPUB sections in spine order; never extract archive files."""
import posixpath
import re
import xml.etree.ElementTree as ET
from urllib.parse import unquote
from zipfile import ZipFile

EPUB_TYPE = '{http://www.idpf.org/2007/ops}type'
LABEL = re.compile(r'^(?:chapter|kapitel|prologue|prolog|epilogue|epilog|coda|interlude|zwischenspiel)\b', re.I)
META = re.compile(r'^(?:cover|title(?:page)?|copyright|imprint|impressum|dedication|widmung|epigraph|contents|table of contents|inhaltsverzeichnis|historical (?:note|background|context)|historische notiz|author.?s? note|afterword|nachwort|glossary|glossar|acknowledg(?:e)?ments?|about the author|scholar.?safety|notes on|reading group guide|timeline|endnotes|footnotes|bibliography|disclaimer|colophon)\b', re.I)
META_TYPES = {'cover', 'titlepage', 'copyright-page', 'dedication', 'toc', 'landmarks', 'loi', 'lot', 'index', 'glossary', 'bibliography', 'endnotes', 'footnotes', 'acknowledgments', 'colophon'}
PART = re.compile(r'^(?:part|teil|book|buch)\s+(?:\d+|[ivxlcdm]+|one|two|three|four|five|six|seven|eight|nine|ten|eins|zwei|drei|vier|fünf)\b', re.I)
SUPPLEMENT = re.compile(r'^(?:a note on history|note|context)$', re.I)

def local(tag):
    return tag.rsplit('}', 1)[-1].lower()

def text(el):
    def pieces(node):
        cls = set(node.get('class', '').split())
        if 'chapter-ornament' in cls or node.get('aria-hidden') == 'true':
            return ''
        value = node.text or ''
        for child in node:
            child_cls = set(child.get('class', '').split())
            separated = local(child.tag) == 'br' or bool(child_cls & {'chapter-number', 'chapter-title'})
            value += (' ' if separated else '') + pieces(child) + (' ' if separated else '') + (child.tail or '')
        return value
    return ' '.join(pieces(el).split())

def parse_epub(path, section_class):
    with ZipFile(path) as z:
        infos = z.infolist()
        if len(infos) > 10000 or sum(i.file_size for i in infos) > 100 * 1024 * 1024:
            raise ValueError('EPUB exceeds safe uncompressed size')
        if 'META-INF/encryption.xml' in z.namelist():
            enc = ET.fromstring(z.read('META-INF/encryption.xml'))
            # Font obfuscation is harmless; encrypted narrative files are not.
            for node in enc.iter():
                if local(node.tag) == 'cipherreference' and not node.get('URI', '').lower().endswith(('.otf', '.ttf', '.woff', '.woff2')):
                    raise ValueError('Encrypted EPUB text is not supported')
        container = ET.fromstring(z.read('META-INF/container.xml'))
        roots = [n for n in container.iter() if local(n.tag) == 'rootfile']
        if not roots:
            raise ValueError('EPUB package is missing')
        opf_path = roots[0].get('full-path', '')
        package = ET.fromstring(z.read(opf_path))
        title = next((text(n) for n in package.iter() if local(n.tag) == 'title'), '')
        base = posixpath.dirname(opf_path)
        manifest = {n.get('id'): n for n in package.iter() if local(n.tag) == 'item'}
        sections, skipped, narrative_paths = [], [], []
        pending_part_headings = []
        for ref in (n for n in package.iter() if local(n.tag) == 'itemref'):
            item = manifest.get(ref.get('idref'))
            if item is None:
                raise ValueError('EPUB spine references a missing item')
            if item.get('media-type') not in ('application/xhtml+xml', 'text/html'):
                continue
            href = unquote(item.get('href', '').split('#')[0])
            if re.match(r'^[a-z]+:', href, re.I):
                raise ValueError('Remote EPUB narrative content is not supported')
            name = posixpath.normpath(posixpath.join(base, href))
            root = ET.fromstring(z.read(name))
            body = next((n for n in root.iter() if local(n.tag) == 'body'), None)
            if body is None:
                raise ValueError('EPUB content has no body: ' + name)
            types = set(body.get(EPUB_TYPE, '').split())
            semantic_types = types | {t for n in body.iter() for t in n.get(EPUB_TYPE, '').split()}
            heading_nodes = [n for n in body.iter() if local(n.tag) in ('h1', 'h2') and text(n)]
            headings = [text(n) for n in heading_nodes]
            first = headings[0] if headings else ''
            filename = re.sub(r'[_-]+', ' ', posixpath.basename(name).rsplit('.', 1)[0])
            if 'nav' in item.get('properties', '').split() or types & META_TYPES or META.match(first) or META.match(filename):
                skipped.append(name)
                continue
            blocks = []
            def walk(node):
                tag = local(node.tag)
                node_types = set(node.get(EPUB_TYPE, '').split())
                if tag in ('nav', 'script', 'style', 'aside') or node_types & {'footnote', 'endnote', 'noteref'}:
                    return
                if tag in ('h1', 'h2', 'h3', 'p', 'li', 'pre', 'dt', 'dd'):
                    # Remove note reference numbers but preserve their tails.
                    for child in list(node.iter()):
                        if set(child.get(EPUB_TYPE, '').split()) & {'noteref'}:
                            child.text = ''
                            for nested in list(child):
                                child.remove(nested)
                    value = text(node)
                    if value:
                        blocks.append((tag, value))
                    return
                if tag == 'hr':
                    blocks.append(('p', '***'))
                    return
                for child in node:
                    walk(child)
            walk(body)
            if not blocks:
                skipped.append(name)
                continue
            # A heading-only part divider is not an empty chapter. Preserve its
            # spoken text at the start of the following narrative section.
            # Never apply this exception to a chapter or a page with body text.
            if PART.match(first) and len(blocks) <= 2 and all(tag.startswith('h') and not LABEL.match(value) for tag, value in blocks):
                pending_part_headings.extend(value for _, value in blocks)
                narrative_paths.append(name)
                continue
            starts = [i for i, (tag, value) in enumerate(blocks) if tag.startswith('h') and LABEL.match(value)]
            # Preserve these editorial companion pages as spoken sections. Do
            # not silently discard ambiguous "note" or "context" content.
            supplement = bool(SUPPLEMENT.fullmatch(filename))
            narrative = bool(supplement or starts or semantic_types & {'bodymatter', 'chapter', 'prologue', 'epilogue'} or re.match(r'^(?:ch(?:apter)?|kapitel|prolog|epilog|coda)[ _-]*\d*\b', filename, re.I))
            if not narrative:
                raise ValueError('EPUB section cannot be safely classified: ' + name + '. Please use an audiobook DOCX.')
            if not starts:
                starts = [0]
            elif starts[0] > 0 and any(tag == 'p' for tag, _ in blocks[:starts[0]]):
                raise ValueError('Text before first narrative heading: ' + name)
            narrative_paths.append(name)
            for pos, start in enumerate(starts):
                end = starts[pos + 1] if pos + 1 < len(starts) else len(blocks)
                chunk = blocks[start:end]
                label = chunk[0][1] if chunk[0][0].startswith('h') else first or filename
                offset = 1 if chunk[0][0].startswith('h') else 0
                section_title = label
                for heading_node in heading_nodes:
                    if text(heading_node) == label:
                        title_node = next((n for n in heading_node.iter() if 'chapter-title' in n.get('class', '').split()), None)
                        number_node = next((n for n in heading_node.iter() if 'chapter-number' in n.get('class', '').split()), None)
                        if title_node is not None:
                            section_title = text(title_node)
                        if number_node is not None:
                            label = text(number_node)
                        break
                combined = re.match(r'^((?:CHAPTER|KAPITEL)\s+[^:]+):\s*(.+)$', section_title, re.I)
                if combined:
                    label, section_title = combined.groups()
                if offset < len(chunk) and chunk[offset][0].startswith('h') and not LABEL.match(chunk[offset][1]):
                    section_title = chunk[offset][1]
                    offset += 1
                paragraphs = [value for _, value in chunk[offset:]]
                if not paragraphs:
                    raise ValueError('Empty narrative EPUB section: ' + label)
                if pending_part_headings:
                    paragraphs = pending_part_headings + paragraphs
                    pending_part_headings = []
                kind = 'prologue' if re.match(r'^prolog', label, re.I) else 'epilogue' if re.match(r'^epilog', label, re.I) else 'coda' if re.match(r'^coda', label, re.I) else 'chapter'
                sections.append(section_class(len(sections), kind, label, section_title, paragraphs))
        if pending_part_headings:
            raise ValueError('EPUB part divider has no following narrative section')
        if len(sections) < 2:
            raise ValueError('EPUB yielded fewer than 2 narrative sections')
        return title, sections, {'source_format': 'epub', 'expected_sections': len(sections), 'body_section_count': len(sections), 'narrative_files': narrative_paths, 'non_narrative_files_skipped': skipped, 'title': title}
