"""Select three deterministic, private TTS sample passages from a DOCX manuscript.

Pure stdlib; no network, no telemetry and no automatic production.
Never log, publish, or commit input manuscript text or the selected excerpts.
Selection deliberately excludes the title page and keeps sentence boundaries.
"""
import io
import re
import zipfile
from xml.etree import ElementTree as ET

WORD_NS = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
MAX_DOCX_BYTES = 15_000_000
MAX_DOCUMENT_XML_BYTES = 60_000_000
WORDS = re.compile(r"\S+")
SENTENCE = re.compile(r"(?<=[.!?])\s+(?=[\"'“‘(]*[A-ZÄÖÜ0-9])")

class SampleSelectionError(ValueError):
    pass

def extract_docx_text(blob):
    """Read only word/document.xml from a size-bounded DOCX ZIP."""
    if not isinstance(blob, bytes) or not blob or len(blob) > MAX_DOCX_BYTES:
        raise SampleSelectionError("docx_size_invalid")
    try:
        with zipfile.ZipFile(io.BytesIO(blob)) as document:
            info = document.getinfo("word/document.xml")
            if info.file_size > MAX_DOCUMENT_XML_BYTES:
                raise SampleSelectionError("docx_xml_too_large")
            contents = document.read(info)
    except (zipfile.BadZipFile, KeyError, RuntimeError):
        raise SampleSelectionError("docx_invalid") from None
    if len(contents) > MAX_DOCUMENT_XML_BYTES:
        raise SampleSelectionError("docx_xml_too_large")
    try:
        root = ET.fromstring(contents)
    except ET.ParseError:
        raise SampleSelectionError("docx_xml_invalid") from None
    paragraphs = []
    for paragraph in root.iter(WORD_NS + "p"):
        s = "".join((node.text or "") for node in paragraph.iter(WORD_NS + "t"))
        s = re.sub(r"\s+", " ", s).strip()
        if s:
            paragraphs.append(s)
    return "\n".join(paragraphs)

def choose_three_samples(text, *, target_words=180, min_words=650):
    """Select beginning, middle and end; return private text excerpts.

    Does not produce audio; speaker approval and a TTS provider are separate.
    Fails closed on short/invalid source. Intended for single-language prose.
    """
    if not isinstance(text, str) or not (80 <= target_words <= 300):
        raise SampleSelectionError("invalid_parameters")
    cleaned = re.sub(r"\s+", " ", text).strip()
    words = WORDS.findall(cleaned)
    if len(words) < max(min_words, target_words * 3 + 40):
        raise SampleSelectionError("manuscript_too_short")
    # Sentence boundaries avoid clipping the first or final word of a sentence.
    sentences = [s.strip() for s in SENTENCE.split(cleaned) if s.strip()]
    entries = []
    pos = 0
    for sentence in sentences:
        length = len(WORDS.findall(sentence))
        entries.append((pos, pos + length, sentence))
        pos += length
    if len(entries) < 15:
        raise SampleSelectionError("insufficient_sentence_boundaries")

    samples = {}
    used_intervals = []
    for label, proportion in (("beginning", 0.05), ("middle", 0.5), ("end", 0.93)):
        intended = round(pos * proportion)
        start_idx = min(range(len(entries)), key=lambda i: abs(entries[i][0] - intended))
        # Center middle and end excerpts around the intended book location.
        if label != "beginning":
            desired_start = max(0, intended - target_words // 2)
            start_idx = min(range(len(entries)), key=lambda i: abs(entries[i][0] - desired_start))
        while start_idx < len(entries) and (entries[start_idx][1] - entries[start_idx][0]) < 2:
            start_idx += 1
        chunk, count = [], 0
        end_idx = start_idx
        while end_idx < len(entries) and count < target_words:
            sentence = entries[end_idx][2]
            chunk.append(sentence)
            count += len(WORDS.findall(sentence))
            end_idx += 1
        if count < target_words * 0.7:
            raise SampleSelectionError("insufficient_sample_text")
        interval = (entries[start_idx][0], entries[end_idx - 1][1])
        if any(interval[0] < old[1] and old[0] < interval[1] for old in used_intervals):
            raise SampleSelectionError("sample_overlap")
        used_intervals.append(interval)
        samples[label] = {
            "text": " ".join(chunk),
            "word_count": count,
            "start_word": interval[0],
            "end_word": interval[1],
        }
    return samples
