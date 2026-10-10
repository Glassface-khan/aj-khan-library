from __future__ import annotations

import argparse
import collections
import difflib
import hashlib
import json
import math
import os
import re
import subprocess
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np
import requests
import soundfile as sf

API = "https://ipoqyjrojljmbqslmxxf.supabase.co/functions/v1/audiobook-factory"
OIDC_AUDIENCE = "ajk-audiobook-factory"
SHARD_COUNT_DEFAULT = 4  # German parser retry v2
MAX_CHUNK_WORDS = 24
MAX_CHUNK_CHARS = 220
TECHNICAL_CHUNK_PAUSE = 0.03
PARAGRAPH_PAUSE = 0.32
SCENE_PAUSE = 0.90
MODEL_RELOAD_EVERY_SECTIONS = 4
MAX_CHUNK_RETRIES = 3  # queue/parser repair wake 2026-10-05

SCENE_RE = re.compile(r"^(?:[◆◇◊*]+|[-–—]{1,3})$")
LABEL_RE = re.compile(r"^(PROLOGUE|PROLOG|EPILOGUE|EPILOG|CODA|CHAPTER(?:\s+.+)?|KAPITEL(?:\s+.+)?|[A-ZÄÖÜ][A-Za-zÄÖÜäöüß-]+\s+KAPITEL|INTERLUDE(?:\s+.+)?|ZWISCHENSPIEL(?:\s+.+)?)$", re.I)
BACKMATTER_RE = re.compile(
    r"^(HISTORICAL\s+NOTE|HISTORISCHE\s+NOTIZ|AUTHOR.*NOTE|ANMERKUNG\s+DES\s+AUTORS|AFTERWORD|NACHWORT|GLOSSARY|GLOSSAR(?:\s+.+)?|ANHANG|ACKNOWLEDG(?:E)?MENTS?|DANKSAGUNG|ABOUT\s+THE\s+AUTHOR|UEBER\s+DEN\s+AUTOR|IMPRINT|IMPRESSUM)$",
    re.I,
)


@dataclass
class Section:
    index: int
    kind: str
    label: str
    title: str
    paragraphs: list[str]

    @property
    def spoken_text(self) -> str:
        parts: list[str] = []
        chapter_label = bool(re.match(r"^(?:CHAPTER|KAPITEL)\s+|^[A-ZÄÖÜ][A-Za-zÄÖÜäöüß-]+\s+KAPITEL$", self.title, re.I))
        if self.title and not chapter_label and self.kind != "continuation":
            parts.append(self.title.strip().rstrip(".:") + ".")
        for p in self.paragraphs:
            if SCENE_RE.match(p.strip()):
                parts.append("[[SCENE_BREAK]]")
            else:
                parts.append(p.strip())
        return "\n\n".join(x for x in parts if x)

    @property
    def word_count(self) -> int:
        return len(words(self.spoken_text.replace("[[SCENE_BREAK]]", " ")))


@dataclass
class Chunk:
    text: str
    pause_after: float

    @property
    def word_count(self) -> int:
        return len(words(self.text))


def words(text: str) -> list[str]:
    return re.findall(r"\b[\w’'-]+\b", text, flags=re.UNICODE)


def normalize_text(text: str) -> str:
    text = text.lower().replace("’", "'")
    text = re.sub(r"[^\w'äöüß]+", " ", text, flags=re.UNICODE)
    return " ".join(text.split())


_ORDINAL_WORDS = {
    "one":"1","two":"2","three":"3","four":"4","five":"5","six":"6","seven":"7","eight":"8","nine":"9","ten":"10",
    "eleven":"11","twelve":"12","thirteen":"13","fourteen":"14","fifteen":"15","sixteen":"16","seventeen":"17",
    "eighteen":"18","nineteen":"19","twenty":"20","twenty-one":"21","twenty-two":"22","twenty-three":"23",
    "twenty-four":"24","twenty-five":"25","twenty-six":"26","twenty-seven":"27","twenty-eight":"28",
    "twenty-nine":"29","thirty":"30",
    "eins":"1","ein":"1","zwei":"2","drei":"3","vier":"4","fünf":"5","funf":"5","sechs":"6","sieben":"7",
    "acht":"8","neun":"9","zehn":"10","elf":"11","zwölf":"12","zwolf":"12","dreizehn":"13","vierzehn":"14",
    "fünfzehn":"15","funfzehn":"15","sechzehn":"16","siebzehn":"17","achtzehn":"18","neunzehn":"19","zwanzig":"20",
}

def _roman_to_int(value: str) -> int | None:
    vals = {"i":1,"v":5,"x":10,"l":50,"c":100}
    s = value.lower().strip()
    if not s or any(ch not in vals for ch in s):
        return None
    total = 0
    prev = 0
    for ch in reversed(s):
        v = vals[ch]
        if v < prev:
            total -= v
        else:
            total += v
            prev = v
    return total if 0 < total <= 99 else None

def _canonical_chapter_ordinal(raw: str) -> str:
    s = raw.strip().lower().replace("–", "-").replace("—", "-")
    s = re.sub(r"\s+", " ", s)
    m = re.fullmatch(r"(\d+)\s*([a-z]?)", s)
    if m:
        return m.group(1) + m.group(2)
    m = re.fullmatch(r"([a-zäöüß-]+)-([a-z])", s)
    if m and m.group(1) in _ORDINAL_WORDS:
        return _ORDINAL_WORDS[m.group(1)] + m.group(2)
    if s in _ORDINAL_WORDS:
        return _ORDINAL_WORDS[s]
    roman = _roman_to_int(s)
    if roman is not None:
        return str(roman)
    return normalize_text(s)

def canonical_section_label(text: str) -> str:
    """Match equivalent chapter labels used in Contents and body headings."""
    raw = str(text or "").strip()
    m = re.match(r"^(chapter|kapitel)\s+(.+?)\s*$", raw, re.I)
    if not m:
        return normalize_text(raw)
    rest = m.group(2).strip()
    ordinal = re.split(r"\s*:\s*|\s+[–—]\s+", rest, maxsplit=1)[0].strip()
    return f"{m.group(1).lower()}|{_canonical_chapter_ordinal(ordinal)}"


def is_section_label(text: str) -> bool:
    """Accept real section headings, but never prose merely starting with 'Chapter'."""
    raw = str(text or "").strip()
    if not raw or len(raw) > 180 or len(words(raw)) > 20:
        return False

    if re.fullmatch(
        r"(?:PROLOGUE|PROLOG|EPILOGUE|EPILOG|CODA|INTERLUDE|ZWISCHENSPIEL)"
        r"(?:\s*[:—–·-]\s*[^\n]{1,100})?",
        raw,
        re.I,
    ):
        return True

    if re.fullmatch(r"[A-ZÄÖÜ][A-Za-zÄÖÜäöüß-]+\s+KAPITEL", raw, re.I):
        return True

    # Some literary DOCX masters number chapters without the word CHAPTER:
    # "1 · Now, Day 40 · The Notice" and "46a · The Measure of Water".
    # Require a short, standalone numbered heading separated by a middle dot;
    # plain numbered prose or a list item must not be treated as a chapter.
    numeric_heading = re.fullmatch(r"(\d{1,2}[a-i]?)\s*·\s*([^\n]{2,125})", raw, re.I)
    if numeric_heading and len(words(numeric_heading.group(2))) <= 18:
        return True

    m = re.match(r"^(CHAPTER|KAPITEL)\s+(.+)$", raw, re.I)
    if not m:
        return False

    rest = m.group(2).strip()
    parts = re.split(r"\s*:\s*|\s+[—–]\s+|\s+-\s+|\s*·\s*", rest, maxsplit=1)
    ordinal = parts[0].strip()
    title = parts[1].strip() if len(parts) > 1 else ""

    # A true chapter ordinal is numeric, Roman, or a recognised number word.
    # This rejects prose such as "Chapter Seven, Additional Note The 2017..."
    # because the comma makes the entire prose fragment fail ordinal parsing.
    canonical = _canonical_chapter_ordinal(ordinal)
    if not re.fullmatch(r"\d+[a-z]?", canonical):
        joined = ordinal.lower().replace(" ", "-")
        canonical = _ORDINAL_WORDS.get(joined, canonical)
    if not re.fullmatch(r"\d+[a-z]?", canonical):
        return False

    if title and (len(title) > 110 or len(words(title)) > 14):
        return False
    return True


EDITORIAL_META_RE = re.compile(
    r"\b(?:pending\s+track|working\s+track|production\s+notes?|editorial\s+notes?|"
    r"handoff|scholar[-\s]?check|internal\s+notes?|review\s+notes?|draft\s+track)\b",
    re.I,
)

def is_editorial_meta_heading(text: str, style: str = "") -> bool:
    raw = str(text or "").strip()
    sl = str(style or "").lower()
    heading_like = sl.startswith("heading") or sl in {"chapter", "book chapter", "title", "subtitle"} or raw.isupper()
    return bool(raw and heading_like and EDITORIAL_META_RE.search(raw))


def detect_manuscript_language(sections: list[Section]) -> dict[str, Any]:
    """Lightweight deterministic DE/EN guard before any TTS is rendered."""
    sample = " ".join(
        s.spoken_text.replace("[[SCENE_BREAK]]", " ")
        for s in sections[: min(len(sections), 12)]
    )
    toks = normalize_text(sample).split()[:5000]
    counts = collections.Counter(toks)

    de_words = {
        "der","die","das","den","dem","des","und","ist","sind","war","waren","nicht","mit",
        "für","von","auf","zu","im","in","ein","eine","einer","einem","einen","dass","sich",
        "als","auch","aber","noch","nur","schon","wenn","wie","was","wer","sie","er","wir",
        "ihr","ich","hat","haben","hatte","durch","bei","aus","über","nach","vor","oder"
    }
    en_words = {
        "the","and","is","are","was","were","not","with","for","from","on","to","of","in",
        "a","an","that","this","it","he","she","we","they","but","also","still","only",
        "already","when","how","what","who","has","have","had","through","by","out","over",
        "after","before","or","his","her","their","you","i"
    }

    de_score = sum(counts[w] for w in de_words)
    en_score = sum(counts[w] for w in en_words)
    # Orthographic markers are strong evidence but never sufficient alone.
    de_score += 2 * sum(1 for token in toks if re.search(r"[äöüß]", token))
    total = de_score + en_score
    if total < 20:
        return {"language": "UNKNOWN", "de_score": de_score, "en_score": en_score, "confidence": 0.0}

    language = "DE" if de_score > en_score else "EN"
    confidence = max(de_score, en_score) / max(1, total)
    if confidence < 0.65:
        language = "UNKNOWN"
    return {
        "language": language,
        "de_score": de_score,
        "en_score": en_score,
        "confidence": round(confidence, 4),
        "sample_words": len(toks),
    }


def finite(value: Any, default: float = 0.0) -> float:
    try:
        v = float(value)
        return v if math.isfinite(v) else default
    except Exception:
        return default


def atomic_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(path)


def oidc_token() -> str:
    req_url = os.environ.get("ACTIONS_ID_TOKEN_REQUEST_URL", "")
    req_token = os.environ.get("ACTIONS_ID_TOKEN_REQUEST_TOKEN", "")
    if not req_url or not req_token:
        raise RuntimeError("GitHub OIDC environment is missing")
    sep = "&" if "?" in req_url else "?"
    url = req_url + sep + "audience=" + OIDC_AUDIENCE
    last_error: Exception | None = None
    for attempt in range(1, 5):
        try:
            r = requests.get(
                url,
                headers={"Authorization": "Bearer " + req_token},
                timeout=30,
            )
            r.raise_for_status()
            return r.json()["value"]
        except (requests.RequestException, KeyError, ValueError) as exc:
            last_error = exc
            if attempt == 4:
                break
            time.sleep(2 ** attempt)
    raise RuntimeError(f"GitHub OIDC token request failed after 4 attempts: {last_error}")


def api(op: str, payload: dict[str, Any] | None = None, timeout: int = 120) -> dict[str, Any]:
    token = oidc_token()
    body = {"op": op}
    if payload:
        body.update(payload)
    r = requests.post(API, json=body, headers={"Authorization": "Bearer " + token}, timeout=timeout)
    data = r.json() if r.content else {}
    if not r.ok or not data.get("ok"):
        raise RuntimeError(f"factory api {op} failed: {r.status_code} {data}")
    return data


def api_upload_section(job_id: str, section_index: int, mp3_path: Path) -> dict[str, Any]:
    token = oidc_token()
    with mp3_path.open("rb") as fh:
        r = requests.post(
            API,
            data=fh,
            headers={
                "Authorization": "Bearer " + token,
                "x-ajk-op": "worker-upload-section",
                "x-job-id": job_id,
                "x-section-index": str(section_index),
                "Content-Type": "audio/mpeg",
            },
            timeout=300,
        )
    data = r.json() if r.content else {}
    if not r.ok or not data.get("ok"):
        raise RuntimeError(f"upload section failed: {r.status_code} {data}")
    return data


def gh_output(key: str, value: str) -> None:
    out = os.environ.get("GITHUB_OUTPUT")
    if out:
        with open(out, "a", encoding="utf-8") as fh:
            fh.write(f"{key}={value}\n")
    print(f"OUTPUT {key}={value}", flush=True)


def download(url: str, path: Path, timeout: int = 600) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with requests.get(url, stream=True, timeout=timeout) as r:
        r.raise_for_status()
        with path.open("wb") as f:
            for block in r.iter_content(1024 * 1024):
                if block:
                    f.write(block)


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for b in iter(lambda: fh.read(1024 * 1024), b""):
            h.update(b)
    return h.hexdigest()


def pretty_title(raw: str) -> str:
    s = raw.strip()
    if s.isupper() and len(s) > 3:
        return " ".join(w if any(c.isdigit() for c in w) else w.capitalize() for w in s.lower().split())
    return s


def parse_source(path: Path) -> tuple[str, list[Section], dict[str, Any]]:
    from zipfile import ZipFile
    with ZipFile(path) as archive:
        is_epub = "META-INF/container.xml" in archive.namelist()
    if is_epub:
        from epub_source import parse_epub
        title, sections, diagnostics = parse_epub(path, Section)
    else:
        title, sections, diagnostics = parse_docx(path)
    sections, diagnostics = split_oversized_audio_sections(sections, diagnostics)
    return title, sections, diagnostics


# A single 75,000-word chapter cannot fit in a 50 MiB audio upload, even at
# 64 kbps. Split such sections before preflight, not after production, so the
# server's section manifest, per-track QC, and playback chapters all agree.
MAX_AUDIO_SECTION_WORDS = 4500


def split_oversized_audio_sections(sections: list[Section], diagnostics: dict[str, Any]) -> tuple[list[Section], dict[str, Any]]:
    result: list[Section] = []
    split_details: list[dict[str, Any]] = []

    for original in sections:
        if original.word_count <= MAX_AUDIO_SECTION_WORDS:
            result.append(Section(len(result), original.kind, original.label, original.title, list(original.paragraphs)))
            continue

        # Keep original paragraph order and all words. Only unusually large
        # individual paragraphs need a last-resort word-boundary split.
        paragraphs: list[str] = []
        for paragraph in original.paragraphs:
            if len(words(paragraph)) <= MAX_AUDIO_SECTION_WORDS:
                paragraphs.append(paragraph)
                continue
            tokens = paragraph.split()
            partial: list[str] = []
            partial_words = 0
            for token in tokens:
                token_words = len(words(token))
                if partial and partial_words + token_words > MAX_AUDIO_SECTION_WORDS:
                    paragraphs.append(" ".join(partial))
                    partial = []
                    partial_words = 0
                partial.append(token)
                partial_words += token_words
            if partial:
                paragraphs.append(" ".join(partial))

        batches: list[list[str]] = []
        current: list[str] = []
        current_words = 0
        for paragraph in paragraphs:
            paragraph_words = len(words(paragraph))
            if current and current_words + paragraph_words > MAX_AUDIO_SECTION_WORDS:
                batches.append(current)
                current = []
                current_words = 0
            current.append(paragraph)
            current_words += paragraph_words
        if current:
            batches.append(current)

        if len(batches) < 2:
            raise ValueError("Oversized audio section could not be segmented safely")
        split_details.append({"source_label": original.label, "source_words": original.word_count, "tracks": len(batches)})
        for part, body in enumerate(batches):
            first = part == 0
            title = original.title if first else f"{original.title} (Part {part + 1} of {len(batches)})"
            result.append(Section(
                len(result), original.kind if first else "continuation",
                original.label if first else f"{original.label} · {part + 1}/{len(batches)}",
                title, body,
            ))

    if not split_details:
        return result, diagnostics

    diagnostics = dict(diagnostics)
    diagnostics["original_body_section_count"] = len(sections)
    diagnostics["body_section_count"] = len(result)
    diagnostics["expected_sections"] = len(result)
    diagnostics["audio_section_max_words"] = MAX_AUDIO_SECTION_WORDS
    diagnostics["oversized_sections_split"] = split_details
    # A table of contents refers to original chapters, not to audio tracks.
    diagnostics["toc_count_advisory_only"] = True
    return result, diagnostics


def parse_docx(path: Path) -> tuple[str, list[Section], dict[str, Any]]:
    from docx import Document

    doc = Document(str(path))
    paras = [
        (p.text.strip(), ((getattr(p, "style", None) and getattr(p.style, "name", "")) or ""))
        for p in doc.paragraphs
    ]
    nonempty = [(i, t, st) for i, (t, st) in enumerate(paras) if t]

    title = ""
    for _, t, st in nonempty[:30]:
        sl = st.lower()
        if "front title" in sl or sl in {"title", "book title"}:
            title = t.strip()
            break
    if not title:
        for _, t, _ in nonempty[:10]:
            if 1 <= len(t.split()) <= 12:
                title = t.strip()
                break

    toc_entries = [t for _, t, st in nonempty if "toc" in st.lower()]

    explicit_start_rows: list[tuple[int, str]] = []
    for i, t, st in nonempty:
        sl = st.lower()
        if "toc" in sl:
            continue
        if "chapter label" in sl or is_section_label(t):
            explicit_start_rows.append((i, t))

    # A number of polished publication masters have Contents entries in Normal
    # style rather than a TOC style. The same chapter heading then appears twice:
    # once in Contents and once at the real chapter start. Keep the last
    # occurrence of an identical label, which is the body occurrence.
    by_label: dict[str, list[int]] = collections.defaultdict(list)
    for i, t in explicit_start_rows:
        by_label[canonical_section_label(t)].append(i)
    duplicate_toc_starts = {
        i
        for positions in by_label.values()
        if len(positions) > 1
        for i in positions[:-1]
    }
    explicit_starts = [i for i, _ in explicit_start_rows if i not in duplicate_toc_starts]

    # Some publication masters use explicit CHAPTER labels for most sections but
    # Heading 1 / Chapter styles for a few special sections. Recover those
    # without double-counting the chapter-title line immediately after a label.
    editorial_starts: list[int] = []
    styled_candidates: list[int] = []
    for i, t, st in nonempty:
        sl = st.lower()
        if "toc" in sl or "back" in sl or BACKMATTER_RE.match(t):
            continue
        if is_editorial_meta_heading(t, st):
            editorial_starts.append(i)
            continue
        if sl.startswith("heading 1") or sl in {"chapter", "book chapter"}:
            if any(0 < i - s <= 2 for s in explicit_starts):
                continue
            styled_candidates.append(i)

    starts = sorted(set(explicit_starts + styled_candidates))
    heading_only = len(explicit_starts) < 2

    if not starts:
        raise ValueError("No chapter/prologue structure could be detected")

    # Internal production/handoff blocks can be styled as Heading 1 inside a
    # working master. Exclude the whole block up to the next real section start.
    editorial_skip_rows: set[int] = set()
    for e_start in editorial_starts:
        later = [s for s in starts if s > e_start]
        e_end = min(later) if later else len(paras)
        editorial_skip_rows.update(range(e_start, e_end))

    sections: list[Section] = []
    start_set = set(starts)
    for pos, start in enumerate(starts):
        label = paras[start][0]
        next_start = starts[pos + 1] if pos + 1 < len(starts) else len(paras)

        if heading_only:
            chapter_title = label
            body_from = start + 1
            kind = "chapter"
        else:
            kind = "prologue" if label.upper().startswith(("PROLOGUE", "PROLOG")) else (
                "epilogue" if label.upper().startswith(("EPILOGUE", "EPILOG")) else ("coda" if label.upper().startswith("CODA") else "chapter")
            )
            chapter_title = label.title()
            body_from = start + 1
            if body_from < next_start:
                nt, ns = paras[body_from]
                if nt and ("book chapter" in ns.lower() or ns.lower() in {"chapter title", "heading 1"}):
                    chapter_title = pretty_title(nt)
                    body_from += 1

        body: list[str] = []
        for j in range(body_from, next_start):
            t, st = paras[j]
            if not t:
                continue
            sl = st.lower()
            if "toc" in sl or j in editorial_skip_rows:
                continue
            if pos == len(starts) - 1 and ("back heading" in sl or BACKMATTER_RE.match(t)):
                break
            if "chapter label" in sl or (j in start_set):
                continue
            body.append(t)

        if not body:
            raise ValueError(f"Section {pos + 1} ({label}) has no body text")
        sections.append(Section(pos, kind, label, chapter_title, body))

    toc_section_entries = [t for t in toc_entries if is_section_label(t)]
    expected = (
        len(toc_section_entries)
        if len(toc_section_entries) >= 2
        else len(sections)
    )
    diagnostics = {
        "toc_count": len(toc_entries),
        "toc_section_count": len(toc_section_entries),
        "toc_extra_count": max(0, len(toc_entries) - len(toc_section_entries)),
        "body_section_count": len(sections),
        "explicit_body_start_count": len(explicit_starts),
        "duplicate_contents_labels_ignored": len(duplicate_toc_starts),
        "styled_recovery_count": len([x for x in styled_candidates if x not in explicit_starts]),
        "editorial_meta_blocks_ignored": len(editorial_starts),
        "editorial_meta_rows_ignored": len(editorial_skip_rows),
        "expected_sections": expected,
        "title": title,
        "style_counts": dict(collections.Counter(st for _, _, st in nonempty)),
    }

    if toc_entries and len(toc_entries) != len(sections):
        # Publication TOCs often include dedication, notes, glossary, etc.
        # Only enforce an exact TOC/body count when the TOC's narrative labels
        # are themselves recognisable. If the TOC uses bare titles/numbers,
        # treat it as advisory and trust the non-empty body-section parse.
        if len(toc_section_entries) >= 2 and len(toc_section_entries) != len(sections):
            raise ValueError(
                f"TOC/body mismatch: TOC has {len(toc_entries)} entries "
                f"({len(toc_section_entries)} narrative sections) but body parser found {len(sections)}"
            )
        if not toc_section_entries:
            diagnostics["toc_count_advisory_only"] = True

    tiny = [s.index for s in sections if s.word_count < 40]
    if tiny:
        diagnostics["tiny_sections"] = tiny
    return title, sections, diagnostics


def split_sentences(text: str) -> list[str]:
    pieces = re.split(r"(?<=[.!?…])\s+(?=[\"“‘'A-ZÄÖÜ0-9])", text.strip())
    return [p.strip() for p in pieces if p.strip()]


def split_long_part(text: str) -> list[str]:
    """Split oversized text at natural punctuation before falling back to word limits."""
    text = text.strip()
    if not text:
        return []
    if len(words(text)) <= MAX_CHUNK_WORDS and len(text) <= MAX_CHUNK_CHARS:
        return [text]

    clauses = [x.strip() for x in re.split(r"(?<=[,;:—–])\\s+", text) if x.strip()]
    if len(clauses) > 1:
        packed: list[str] = []
        current = ""
        for clause in clauses:
            candidate = (current + " " + clause).strip()
            if current and (len(words(candidate)) > MAX_CHUNK_WORDS or len(candidate) > MAX_CHUNK_CHARS):
                packed.append(current)
                current = clause
            else:
                current = candidate
        if current:
            packed.append(current)
        if all(len(words(x)) <= MAX_CHUNK_WORDS and len(x) <= MAX_CHUNK_CHARS for x in packed):
            return packed

    # Final fallback: split only at word boundaries. Never cut through a word,
    # because partial tokens can produce audible artifacts at chunk joins.
    out: list[str] = []
    current_words: list[str] = []
    current_chars = 0
    for word in text.split():
        extra = len(word) + (1 if current_words else 0)
        if current_words and (
            len(current_words) + 1 > MAX_CHUNK_WORDS
            or current_chars + extra > MAX_CHUNK_CHARS
        ):
            out.append(" ".join(current_words))
            current_words = []
            current_chars = 0
        current_words.append(word)
        current_chars += len(word) + (1 if len(current_words) > 1 else 0)
    if current_words:
        out.append(" ".join(current_words))
    return out


def chunks_for(section: Section) -> list[Chunk]:
    """Preserve paragraph rhythm while splitting long text at natural boundaries."""
    chunks: list[Chunk] = []

    chapter_label = bool(re.match(
        r"^(?:CHAPTER|KAPITEL)\\s+|^[A-ZÄÖÜ][A-Za-zÄÖÜäöüß-]+\\s+KAPITEL$",
        section.title or "",
        re.I,
    ))
    if section.title and not chapter_label and section.kind != "continuation":
        title = section.title.strip().rstrip(".:") + "."
        if title:
            chunks.append(Chunk(title, PARAGRAPH_PAUSE))

    for raw in section.paragraphs:
        p = raw.strip()
        if not p:
            continue
        if SCENE_RE.match(p):
            if chunks:
                chunks[-1].pause_after = max(chunks[-1].pause_after, SCENE_PAUSE)
            continue

        pieces: list[str] = []
        for sentence in split_sentences(p):
            pieces.extend(split_long_part(sentence))
        if not pieces:
            pieces = split_long_part(p)

        for pi, piece in enumerate(pieces):
            pause_after = PARAGRAPH_PAUSE if pi == len(pieces) - 1 else TECHNICAL_CHUNK_PAUSE
            chunks.append(Chunk(piece, pause_after))

    chunks = [ch for ch in chunks if ch.text.strip() and words(ch.text)]
    if chunks:
        chunks[-1].pause_after = 0.0
    return chunks

def ensure_mono_float(audio: np.ndarray) -> np.ndarray:
    x = np.asarray(audio, dtype=np.float32)
    if x.ndim == 2:
        if x.shape[0] <= 2 and x.shape[1] > x.shape[0]:
            x = x.mean(axis=0)
        else:
            x = x.mean(axis=1)
    return np.clip(x.reshape(-1), -1.2, 1.2)


def signal_metrics(audio: np.ndarray, sample_rate: int, source_words: int) -> dict[str, float]:
    x = ensure_mono_float(audio)
    dur = len(x) / float(sample_rate) if sample_rate else 0.0
    absx = np.abs(x)
    clip = float(np.mean(absx >= 0.995)) if len(x) else 1.0
    rms = float(np.sqrt(np.mean(np.square(x)))) if len(x) else 0.0
    frame = max(1, int(sample_rate * 0.02))
    if len(x) >= frame:
        n = len(x) // frame
        frames = x[: n * frame].reshape(n, frame)
        frms = np.sqrt(np.mean(frames * frames, axis=1))
        silence_ratio = float(np.mean(frms < 0.0032))
    else:
        silence_ratio = 1.0
    wpm = (source_words / dur * 60.0) if dur > 0 else math.inf
    return {
        "duration_seconds": dur,
        "words_per_minute": wpm,
        "clipping_ratio": clip,
        "silence_ratio": silence_ratio,
        "rms": rms,
    }


def cheap_audio_pass(metrics: dict[str, float], source_words: int) -> tuple[bool, list[str]]:
    reasons: list[str] = []
    if metrics["duration_seconds"] < 0.35:
        reasons.append("audio_too_short")
    if source_words >= 25:
        if metrics["words_per_minute"] < 65:
            reasons.append("speech_implausibly_slow")
        if metrics["words_per_minute"] > 285:
            reasons.append("speech_implausibly_fast")
    if metrics["clipping_ratio"] > 0.008:
        reasons.append("excessive_clipping")
    if source_words >= 15 and metrics["silence_ratio"] > 0.72:
        reasons.append("excessive_silence")
    if metrics["rms"] < 0.002:
        reasons.append("audio_nearly_silent")
    return not reasons, reasons


class AsrChecker:
    def __init__(self, language_code: str):
        from faster_whisper import WhisperModel
        model_name = "base.en" if language_code == "EN" else "base"
        self.language = "en" if language_code == "EN" else "de"
        self.model = WhisperModel(model_name, device="cpu", compute_type="int8", cpu_threads=2, num_workers=1)

    def transcribe(self, path: Path) -> str:
        segments, _ = self.model.transcribe(
            str(path), language=self.language, beam_size=1, best_of=1,
            temperature=0.0, vad_filter=False, condition_on_previous_text=False,
        )
        return " ".join(s.text.strip() for s in segments if s.text.strip()).strip()


def transcript_scores(reference: str, hypothesis: str) -> dict[str, float]:
    ref = normalize_text(reference)
    hyp = normalize_text(hypothesis)
    if not ref or not hyp:
        return {"sequence_similarity": 0.0, "word_recall": 0.0, "wer_similarity": 0.0}
    seq = difflib.SequenceMatcher(None, ref, hyp, autojunk=False).ratio()
    rc = collections.Counter(ref.split())
    hc = collections.Counter(hyp.split())
    common = sum((rc & hc).values())
    recall = common / max(1, sum(rc.values()))
    try:
        import jiwer
        wer = float(jiwer.wer(ref, hyp))
        wer_sim = max(0.0, 1.0 - min(1.0, wer))
    except Exception:
        wer_sim = seq
    return {"sequence_similarity": seq, "word_recall": recall, "wer_similarity": wer_sim}


def transcript_pass(scores: dict[str, float], language_code: str, source_words: int) -> tuple[bool, list[str]]:
    if source_words < 12:
        return True, []
    seq_min = 0.50 if language_code == "EN" else 0.42
    recall_min = 0.58 if language_code == "EN" else 0.50
    wer_min = 0.40 if language_code == "EN" else 0.32
    reasons = []
    if scores["sequence_similarity"] < seq_min:
        reasons.append("low_sequence_similarity")
    if scores["word_recall"] < recall_min:
        reasons.append("low_word_recall")
    if scores["wer_similarity"] < wer_min:
        reasons.append("high_word_error_rate")
    return not reasons, reasons


def load_tts(language: str, voice_source: str, workdir: Path, temp: float = 0.3):
    from pocket_tts import TTSModel
    model = TTSModel.load_model(language=language, temp=temp)
    voice_path = voice_source
    downloaded_voice: Path | None = None
    normalized_voice: Path | None = None

    if voice_source.startswith("http://") or voice_source.startswith("https://"):
        lower = voice_source.lower()
        if ".safetensors" in lower:
            ext = ".safetensors"
        elif ".mp3" in lower:
            ext = ".mp3"
        else:
            ext = ".wav"

        vp = workdir / ("voice_source" + ext)
        download(voice_source, vp)
        downloaded_voice = vp

        if ext == ".safetensors":
            voice_path = str(vp)
        else:
            normalized_voice = workdir / "voice_reference_24k_mono.wav"
            subprocess.run([
                "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
                "-i", str(vp),
                "-ac", "1",
                "-ar", "24000",
                "-c:a", "pcm_s16le",
                str(normalized_voice),
            ], check=True)
            voice_path = str(normalized_voice)

    state = model.get_state_for_audio_prompt(voice_path)

    for temp_path in (downloaded_voice, normalized_voice):
        if temp_path is not None:
            try:
                temp_path.unlink(missing_ok=True)
            except Exception:
                pass
    return model, state


def load_tts_from_prepared(language: str, state_path: Path, temp: float = 0.3):
    from pocket_tts import TTSModel
    model = TTSModel.load_model(language=language, temp=temp)
    state = model.get_state_for_audio_prompt(str(state_path))
    return model, state


def gen_audio(model, state, text: str) -> np.ndarray:
    """Render with Pocket TTS 3.3 streaming; fade only the logical chunk onset."""
    text = str(text or "").strip()
    if not text or not words(text):
        raise ValueError("TTS prompt contains no speakable words")
    rendered: list[np.ndarray] = []
    first_packet = True
    fade_samples = max(1, int(0.005 * model.sample_rate))
    for tensor in model.generate_audio_stream(state, text, copy_state=True):
        try:
            tensor = tensor.detach().cpu()
        except Exception:
            pass
        audio = ensure_mono_float(tensor.numpy())
        if audio.size:
            if first_packet:
                n = min(fade_samples, audio.size)
                audio[:n] *= np.linspace(0.0, 1.0, n, dtype=np.float32)
                first_packet = False
            rendered.append(audio)
    return np.concatenate(rendered) if rendered else np.zeros(1, dtype=np.float32)

def silence(seconds: float, sr: int) -> np.ndarray:
    return np.zeros(max(0, int(seconds * sr)), dtype=np.float32)


def write_mp3(wav_path: Path, mp3_path: Path) -> None:
    # Mono speech can use 64 kbps for long chapters while fitting the storage
    # upload limit. Keep the established 96 kbps setting for ordinary chapters.
    duration = sf.info(wav_path).duration
    bitrate = 96 if duration * 12000 < 49 * 1024 * 1024 else 64
    if duration * bitrate * 125 >= 49 * 1024 * 1024:
        raise ValueError("Audio section exceeds upload limit even at 64 kbps; split the source section")
    subprocess.run([
        "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
        "-i", str(wav_path), "-ac", "1", "-ar", "24000",
        "-codec:a", "libmp3lame", "-b:a", f"{bitrate}k", str(mp3_path),
    ], check=True)
    if mp3_path.stat().st_size > 50 * 1024 * 1024:
        raise ValueError("Encoded audio section exceeds upload limit")


def preflight_sample_text(section: Section, max_words: int = 16) -> str:
    """Choose a substantive prose sample, not title cards, timestamps or metadata."""
    metadata_re = re.compile(
        r"^(?:\[?\d{1,2}:\d{2}\]?|@\S+|hochgeladen\b|uploaded\b|aufrufe\b|views\b|"
        r"top-kommentare\b|top comments\b|mirza home\b|video endet\b|video ends\b)",
        re.I,
    )
    candidates: list[str] = []

    for raw in section.paragraphs:
        p = raw.strip()
        if not p or SCENE_RE.match(p) or metadata_re.match(p):
            continue
        if p.isupper() and len(words(p)) <= 10:
            continue
        if re.match(r"^[A-ZÄÖÜ][A-ZÄÖÜ0-9 _.-]{1,30}:$", p):
            continue

        for sentence in split_sentences(p):
            cleaned = sentence.strip()
            wc = len(words(cleaned))
            if wc >= 12:
                candidates.append(cleaned)
                if wc >= max_words:
                    return " ".join(cleaned.split()[:max_words])

    if candidates:
        return " ".join(candidates[0].split()[:max_words])

    # Fallback: accumulate real prose tokens while excluding technical markers.
    prose: list[str] = []
    for raw in section.paragraphs:
        p = raw.strip()
        if not p or SCENE_RE.match(p) or metadata_re.match(p):
            continue
        if p.isupper() and len(words(p)) <= 10:
            continue
        prose.extend(p.split())
        if len(prose) >= max_words:
            break
    if prose:
        return " ".join(prose[:max_words])

    text = section.spoken_text.replace("[[SCENE_BREAK]]", " ")
    return " ".join(text.split()[:max_words])


def preflight_qc(model, state, sr: int, asr: AsrChecker, text: str, out_wav: Path, language_code: str) -> dict[str, Any]:
    audio = gen_audio(model, state, text)
    sf.write(out_wav, audio, sr, subtype="PCM_16")
    m = signal_metrics(audio, sr, len(words(text)))
    cheap_ok, cheap_reasons = cheap_audio_pass(m, len(words(text)))
    transcript = asr.transcribe(out_wav)
    scores = transcript_scores(text, transcript)
    tx_ok, tx_reasons = transcript_pass(scores, language_code, len(words(text)))
    return {
        **m, **scores,
        "transcript": transcript[:1000],
        "passed": cheap_ok and tx_ok,
        "reasons": cheap_reasons + tx_reasons,
    }


def save_prepared_manifest(workdir: Path, job: dict[str, Any], title: str, sections: list[Section], diagnostics: dict[str, Any]) -> None:
    sec_dir = workdir / "sections"
    sec_dir.mkdir(parents=True, exist_ok=True)
    manifest = {
        "job_id": job["id"], "title": title, "language_code": job["language_code"],
        "voice_key": job["voice_key"], "voice_name": job["voice_name"],
        "diagnostics": diagnostics, "sections": [],
    }
    for s in sections:
        item = {
            "index": s.index, "kind": s.kind, "label": s.label, "title": s.title,
            "paragraphs": s.paragraphs, "word_count": s.word_count,
        }
        atomic_json(sec_dir / f"{s.index:03d}.json", item)
        manifest["sections"].append({k: item[k] for k in ("index", "kind", "title", "word_count")})
    atomic_json(workdir / "manifest.json", manifest)


def prepare(args: argparse.Namespace) -> int:
    workdir = Path(args.workdir).resolve()
    workdir.mkdir(parents=True, exist_ok=True)
    if args.claim_file:
        claim = json.loads(Path(args.claim_file).read_text(encoding="utf-8"))
    elif args.job_id:
        remote = api("workerManifest", {"jobId": args.job_id})
        rjob = remote["job"]
        claim = {
            "job": rjob,
            "sourceUrl": remote["sourceUrl"],
            "voice": remote["voice"],
            "titleAliases": remote.get("titleAliases") or [],
            "resumeProduction": rjob.get("qc_status") == "passed" and int(rjob.get("detected_sections") or 0) > 0,
        }
    else:
        claim = api("workerClaim")
    job = claim.get("job")
    if not job:
        gh_output("has_job", "false")
        return 0

    job_id = job["id"]
    gh_output("job_id", job_id)
    gh_output("shard_count", str(args.shard_count))
    source = workdir / "source.docx"
    download(claim["sourceUrl"], source)

    detected_title = ""
    sections: list[Section] = []
    diagnostics: dict[str, Any] = {}
    try:
        detected_title, sections, diagnostics = parse_source(source)
        if len(sections) < 2:
            raise ValueError("Manuscript yielded fewer than 2 audio sections")
    except Exception as exc:
        api("workerPreflightResult", {
            "jobId": job_id, "qcStatus": "failed", "qcScore": 0,
            "qcSummary": {"structure": "failed", "error": str(exc)},
            "errorDetail": str(exc), "sections": [],
        })
        gh_output("has_job", "false")
        return 0

    language_guard = detect_manuscript_language(sections)
    detected_language = str(language_guard.get("language") or "UNKNOWN")
    selected_language = str(job.get("language_code") or "").upper()
    if detected_language in {"DE", "EN"} and selected_language in {"DE", "EN"} and detected_language != selected_language:
        api("workerPreflightResult", {
            "jobId": job_id,
            "qcStatus": "failed",
            "qcScore": 0,
            "qcSummary": {
                "language_guard": language_guard,
                "selected_language": selected_language,
                "detected_language": detected_language,
                "structure": diagnostics,
            },
            "detectedTitle": detected_title,
            "sourceSha256": sha256_file(source),
            "wordCount": sum(s.word_count for s in sections),
            "expectedSections": diagnostics.get("expected_sections", len(sections)),
            "detectedSections": len(sections),
            "sections": [],
            "errorCode": "SOURCE_LANGUAGE_MISMATCH",
            "errorDetail": f"Manuscript language appears to be {detected_language}, but the selected audiobook language/voice is {selected_language}.",
        }, timeout=180)
        gh_output("has_job", "false")
        return 0

    if claim.get("resumeProduction"):
        gh_output("has_job", "true")
        return 0

    voice = claim["voice"]
    requested = normalize_text(job.get("requested_title") or "")
    detected = normalize_text(detected_title)
    source_name_text = normalize_text(re.sub(r"[_-]+", " ", job.get("source_file_name") or ""))
    title_aliases = [normalize_text(x) for x in (claim.get("titleAliases") or []) if normalize_text(x)]
    title_similarity = difflib.SequenceMatcher(None, requested, detected).ratio() if requested and detected else 1.0
    title_in_filename = bool(requested and source_name_text and requested in source_name_text)
    title_alias_match = bool(
        detected and any(
            detected == alias or difflib.SequenceMatcher(None, alias, detected).ratio() >= 0.90
            for alias in title_aliases
        )
    )

    try:
        model, state = load_tts(voice["ttsLanguage"], voice["source"], workdir)
        asr = AsrChecker(job["language_code"])
        picks = sorted(set([0, len(sections) // 2, len(sections) - 1]))
        sample_results = []

        # A single stochastic TTS render can occasionally be bad even when the
        # voice/model is healthy. Re-render only the failed sample locally before
        # blocking an entire novel. Thresholds stay unchanged; full production
        # is still released only when every selected preflight sample passes.
        preflight_state_path = workdir / "preflight_voice.safetensors"
        try:
            from pocket_tts import export_model_state
            export_model_state(state, preflight_state_path)
        except Exception:
            preflight_state_path = None

        for ix in picks:
            text = preflight_sample_text(sections[ix])
            attempts = []
            result = None
            for sample_attempt in range(1, 4):
                out_wav = workdir / f"preflight_{ix:03d}_a{sample_attempt}.wav"
                result = preflight_qc(
                    model, state, model.sample_rate, asr, text,
                    out_wav, job["language_code"],
                )
                result["attempt"] = sample_attempt
                attempts.append({
                    "attempt": sample_attempt,
                    "passed": result["passed"],
                    "reasons": result["reasons"],
                    "sequence_similarity": result["sequence_similarity"],
                    "word_recall": result["word_recall"],
                    "wer_similarity": result["wer_similarity"],
                })
                api("workerHeartbeat", {"jobId": job_id})
                if result["passed"]:
                    break

                # Reinitialize generation for the retry while preserving the
                # exact same voice state. A lower temperature reduces transient
                # pronunciation failures without weakening QC thresholds.
                if sample_attempt < 3 and preflight_state_path is not None:
                    model, state = load_tts_from_prepared(
                        voice["ttsLanguage"],
                        preflight_state_path,
                        temp=max(0.20, 0.30 - 0.05 * sample_attempt),
                    )

            assert result is not None
            result["section_index"] = ix
            result["source_words"] = len(words(text))
            result["attempts"] = attempts
            result["attempt_count"] = len(attempts)
            sample_results.append(result)

        samples_pass = all(x["passed"] for x in sample_results)
        structure_pass = (
            bool(diagnostics.get("toc_count_advisory_only"))
            or diagnostics.get("toc_count", 0) in (0, len(sections))
            or (
                diagnostics.get("toc_section_count", 0) >= 2
                and diagnostics.get("toc_section_count") == len(sections)
            )
        )
        title_pass = title_similarity >= 0.45 or title_in_filename or title_alias_match
        passed = samples_pass and structure_pass and title_pass
        quality_values = [
            (r["sequence_similarity"] + r["word_recall"] + r["wer_similarity"]) / 3.0
            for r in sample_results
        ]
        qc_score = round(100.0 * sum(quality_values) / max(1, len(quality_values)), 2)
        summary = {
            "structure": diagnostics,
            "language_guard": language_guard,
            "title_similarity": title_similarity,
            "title_in_filename": title_in_filename,
            "title_aliases": title_aliases,
            "title_alias_match": title_alias_match,
            "sample_sections": sample_results,
            "samples_pass": samples_pass,
            "structure_pass": structure_pass,
            "title_pass": title_pass,
            "policy": {
                "full_production_requires_all_preflight_samples_pass": True,
                "preflight_sample_max_attempts": 3,
                "failed_samples_are_rerendered_without_lowering_qc_thresholds": True,
                "asr_model": "base.en" if job["language_code"] == "EN" else "base",
                "private_inputs_never_uploaded_as_github_artifacts": True,
            },
        }
        payload_sections = [
            {"sectionIndex": s.index, "kind": s.kind, "title": s.title, "wordCount": s.word_count}
            for s in sections
        ]
        api("workerPreflightResult", {
            "jobId": job_id,
            "qcStatus": "passed" if passed else "failed",
            "qcScore": qc_score,
            "qcSummary": summary,
            "detectedTitle": detected_title,
            "sourceSha256": sha256_file(source),
            "wordCount": sum(s.word_count for s in sections),
            "expectedSections": diagnostics.get("expected_sections", len(sections)),
            "detectedSections": len(sections),
            "sections": payload_sections,
            "errorDetail": "" if passed else "Pre-production QC failed; full production was not started.",
        }, timeout=180)
        gh_output("has_job", "true" if passed else "false")
        return 0
    except Exception as exc:
        try:
            api("workerPreflightResult", {
                "jobId": job_id, "qcStatus": "failed", "qcScore": 0,
                "qcSummary": {"structure": diagnostics, "exception": str(exc)},
                "detectedTitle": detected_title, "sourceSha256": sha256_file(source),
                "wordCount": sum(s.word_count for s in sections),
                "expectedSections": diagnostics.get("expected_sections", len(sections)),
                "detectedSections": len(sections), "sections": [],
                "errorDetail": "Pre-production QC exception: " + str(exc),
            })
        except Exception:
            pass
        gh_output("has_job", "false")
        raise

def section_from_json(path: Path) -> Section:
    d = json.loads(path.read_text(encoding="utf-8"))
    return Section(d["index"], d["kind"], d["label"], d["title"], d["paragraphs"])


def produce_section(job: dict[str, Any], section: Section, model, state, asr: AsrChecker, outdir: Path, job_id: str) -> tuple[bool, dict[str, Any]]:
    chunks = chunks_for(section)
    if not chunks:
        return False, {"reasons": ["no_chunks"]}
    sr = model.sample_rate
    rendered: list[np.ndarray] = []
    chunk_qc: list[dict[str, Any]] = []

    for ci, ch in enumerate(chunks):
        success = False
        last_detail: dict[str, Any] = {}
        for attempt in range(1, MAX_CHUNK_RETRIES + 1):
            audio = gen_audio(model, state, ch.text)
            m = signal_metrics(audio, sr, ch.word_count)
            ok, reasons = cheap_audio_pass(m, ch.word_count)
            last_detail = {**m, "chunk_index": ci, "attempt": attempt, "word_count": ch.word_count, "reasons": reasons}
            if ok:
                rendered.append(audio)
                if ch.pause_after > 0:
                    rendered.append(silence(ch.pause_after, sr))
                chunk_qc.append(last_detail)
                success = True
                break
            model, state = load_tts_from_prepared(
                job["tts_language"], Path(job["voice_state_path"]),
                temp=max(0.20, 0.30 - 0.05 * attempt),
            )
            sr = model.sample_rate
        if not success:
            return False, {"reasons": ["chunk_qc_failed"], "failed_chunk": last_detail, "chunks": chunk_qc}

    audio = np.concatenate(rendered) if rendered else np.zeros(1, dtype=np.float32)
    wav = outdir / f"section_{section.index:03d}.wav"
    mp3 = outdir / f"section_{section.index:03d}.mp3"
    sf.write(wav, audio, sr, subtype="PCM_16")
    write_mp3(wav, mp3)

    metrics = signal_metrics(audio, sr, section.word_count)
    cheap_ok, cheap_reasons = cheap_audio_pass(metrics, section.word_count)
    transcript = asr.transcribe(mp3)
    scores = transcript_scores(section.spoken_text.replace("[[SCENE_BREAK]]", " "), transcript)
    tx_ok, tx_reasons = transcript_pass(scores, job["language_code"], section.word_count)
    detail = {
        **metrics, **scores,
        "reasons": cheap_reasons + tx_reasons,
        "chunks": chunk_qc,
        "chunk_count": len(chunks),
        "transcript_preview": transcript[:1400],
        "source_word_count": section.word_count,
    }
    if not (cheap_ok and tx_ok):
        return False, detail
    upload = api_upload_section(job_id, section.index, mp3)
    detail["storagePath"] = upload["storagePath"]
    detail["byteSize"] = upload["byteSize"]
    return True, detail


def produce(args: argparse.Namespace) -> int:
    workdir = Path(args.workdir).resolve()
    workdir.mkdir(parents=True, exist_ok=True)
    job_id = args.job_id
    if not job_id:
        raise ValueError("--job-id is required for cloud production")

    remote = api("workerManifest", {"jobId": job_id})
    job = remote["job"]
    if job["status"] == "cancelled":
        return 0

    source = workdir / "source.docx"
    download(remote["sourceUrl"], source)
    _, parsed_sections, _ = parse_source(source)
    section_map = {s.index: s for s in parsed_sections}
    if len(section_map) != int(job.get("detected_sections") or len(section_map)):
        raise RuntimeError("Private source re-parse does not match pre-production manifest")

    ready = {
        int(s["section_index"]) for s in remote["sections"]
        if s["status"] == "ready" and s["qc_status"] == "passed"
    }

    voice = remote["voice"]
    tts_language = str(voice["ttsLanguage"])
    voice_state_path = workdir / "voice.safetensors"
    job_ctx = dict(job)
    job_ctx["tts_language"] = tts_language
    job_ctx["voice_state_path"] = str(voice_state_path)

    asr = AsrChecker(job["language_code"])
    model = state = None
    sections_since_reload = MODEL_RELOAD_EVERY_SECTIONS
    outdir = workdir / f"out_shard_{args.shard_index}"
    outdir.mkdir(parents=True, exist_ok=True)

    indices = [
        s.index for s in parsed_sections
        if s.index % args.shard_count == args.shard_index
    ]
    for ix in indices:
        if ix in ready:
            continue
        start = api("workerSectionStart", {"jobId": job_id, "sectionIndex": ix})
        if start.get("skip"):
            continue
        section = section_map[ix]
        try:
            if model is None or sections_since_reload >= MODEL_RELOAD_EVERY_SECTIONS:
                if not voice_state_path.exists():
                    model, state = load_tts(voice["ttsLanguage"], voice["source"], workdir)
                    from pocket_tts import export_model_state
                    export_model_state(state, voice_state_path)
                else:
                    model, state = load_tts_from_prepared(tts_language, voice_state_path)
                sections_since_reload = 0
            passed, detail = produce_section(job_ctx, section, model, state, asr, outdir, job_id)
            api("workerSectionResult", {
                "jobId": job_id,
                "sectionIndex": ix,
                "qcStatus": "passed" if passed else "failed",
                "durationSeconds": finite(detail.get("duration_seconds", 0)),
                "wordsPerMinute": finite(detail.get("words_per_minute", 0)),
                "transcriptSimilarity": finite(detail.get("sequence_similarity", 0)),
                "clippingRatio": finite(detail.get("clipping_ratio", 0)),
                "silenceRatio": finite(detail.get("silence_ratio", 0)),
                "qcDetail": detail,
                "storagePath": detail.get("storagePath", ""),
                "byteSize": detail.get("byteSize", 0),
            }, timeout=180)
            sections_since_reload += 1
            if not passed:
                model = state = None
                sections_since_reload = MODEL_RELOAD_EVERY_SECTIONS
        except Exception as exc:
            try:
                api("workerSectionResult", {
                    "jobId": job_id, "sectionIndex": ix, "qcStatus": "failed",
                    "qcDetail": {"reasons": ["worker_exception"], "error": str(exc)},
                })
            except Exception:
                pass
            model = state = None
            sections_since_reload = MODEL_RELOAD_EVERY_SECTIONS
        api("workerHeartbeat", {"jobId": job_id})
    return 0

def finalize(args: argparse.Namespace) -> int:
    data = api("workerFinalize", {"jobId": args.job_id}, timeout=180)
    print(json.dumps(data, ensure_ascii=False, indent=2))
    return 0


def parser_test(args: argparse.Namespace) -> int:
    title, sections, diag = parse_docx(Path(args.docx))
    print(json.dumps({
        "title": title, "count": len(sections), "diag": diag,
        "sections": [{"i": s.index, "kind": s.kind, "title": s.title, "words": s.word_count} for s in sections],
    }, ensure_ascii=False, indent=2))
    return 0


def main() -> int:
    p = argparse.ArgumentParser()
    sub = p.add_subparsers(dest="cmd", required=True)

    sp = sub.add_parser("prepare")
    sp.add_argument("--workdir", default="prepared")
    sp.add_argument("--shard-count", type=int, default=SHARD_COUNT_DEFAULT)
    sp.add_argument("--claim-file", default="")
    sp.add_argument("--job-id", default="")
    sp.set_defaults(func=prepare)

    sp = sub.add_parser("produce")
    sp.add_argument("--workdir", default="prepared")
    sp.add_argument("--job-id", default="")
    sp.add_argument("--shard-index", type=int, required=True)
    sp.add_argument("--shard-count", type=int, default=SHARD_COUNT_DEFAULT)
    sp.set_defaults(func=produce)

    sp = sub.add_parser("finalize")
    sp.add_argument("--job-id", required=True)
    sp.set_defaults(func=finalize)

    sp = sub.add_parser("parser-test")
    sp.add_argument("docx")
    sp.set_defaults(func=parser_test)

    args = p.parse_args()
    return int(args.func(args) or 0)


if __name__ == "__main__":
    raise SystemExit(main())
