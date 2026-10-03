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
MAX_CHUNK_RETRIES = 3

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
        if self.title and not chapter_label:
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


def parse_docx(path: Path) -> tuple[str, list[Section], dict[str, Any]]:
    from docx import Document

    doc = Document(str(path))
    paras = [(p.text.strip(), p.style.name or "") for p in doc.paragraphs]
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

    starts: list[int] = []
    for i, t, st in nonempty:
        sl = st.lower()
        if "toc" in sl:
            continue
        if "chapter label" in sl or LABEL_RE.match(t):
            starts.append(i)

    heading_only = False
    if len(starts) < 2:
        heading_only = True
        starts = []
        for i, t, st in nonempty:
            sl = st.lower()
            if "toc" in sl or "back" in sl:
                continue
            if sl.startswith("heading 1") or sl in {"chapter", "book chapter"}:
                if not BACKMATTER_RE.match(t):
                    starts.append(i)

    if not starts:
        raise ValueError("No chapter/prologue structure could be detected")

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
            if "toc" in sl:
                continue
            if pos == len(starts) - 1 and ("back heading" in sl or BACKMATTER_RE.match(t)):
                break
            if "chapter label" in sl or (j in start_set):
                continue
            body.append(t)

        if not body:
            raise ValueError(f"Section {pos + 1} ({label}) has no body text")
        sections.append(Section(pos, kind, label, chapter_title, body))

    expected = len(toc_entries) if len(toc_entries) >= 2 else len(sections)
    diagnostics = {
        "toc_count": len(toc_entries),
        "body_section_count": len(sections),
        "expected_sections": expected,
        "title": title,
        "style_counts": dict(collections.Counter(st for _, _, st in nonempty)),
    }

    if toc_entries and len(toc_entries) != len(sections):
        raise ValueError(
            f"TOC/body mismatch: TOC has {len(toc_entries)} sections but body parser found {len(sections)}"
        )

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
    if section.title and not chapter_label:
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
    subprocess.run([
        "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
        "-i", str(wav_path), "-ac", "1", "-ar", "24000",
        "-codec:a", "libmp3lame", "-b:a", "96k", str(mp3_path),
    ], check=True)


def preflight_sample_text(section: Section, max_words: int = 16) -> str:
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
        detected_title, sections, diagnostics = parse_docx(source)
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

    if claim.get("resumeProduction"):
        gh_output("has_job", "true")
        return 0

    voice = claim["voice"]
    requested = normalize_text(job.get("requested_title") or "")
    detected = normalize_text(detected_title)
    title_similarity = difflib.SequenceMatcher(None, requested, detected).ratio() if requested and detected else 1.0

    try:
        model, state = load_tts(voice["ttsLanguage"], voice["source"], workdir)
        asr = AsrChecker(job["language_code"])
        picks = sorted(set([0, len(sections) // 2, len(sections) - 1]))
        sample_results = []
        for ix in picks:
            text = preflight_sample_text(sections[ix])
            result = preflight_qc(
                model, state, model.sample_rate, asr, text,
                workdir / f"preflight_{ix:03d}.wav", job["language_code"],
            )
            result["section_index"] = ix
            result["source_words"] = len(words(text))
            sample_results.append(result)
            api("workerHeartbeat", {"jobId": job_id})

        samples_pass = all(x["passed"] for x in sample_results)
        structure_pass = diagnostics.get("toc_count", 0) in (0, len(sections))
        title_pass = title_similarity >= 0.45
        passed = samples_pass and structure_pass and title_pass
        quality_values = [
            (r["sequence_similarity"] + r["word_recall"] + r["wer_similarity"]) / 3.0
            for r in sample_results
        ]
        qc_score = round(100.0 * sum(quality_values) / max(1, len(quality_values)), 2)
        summary = {
            "structure": diagnostics,
            "title_similarity": title_similarity,
            "sample_sections": sample_results,
            "samples_pass": samples_pass,
            "structure_pass": structure_pass,
            "title_pass": title_pass,
            "policy": {
                "full_production_requires_all_preflight_samples_pass": True,
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
    _, parsed_sections, _ = parse_docx(source)
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
