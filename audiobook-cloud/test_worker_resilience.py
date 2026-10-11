#!/usr/bin/env python3
"""Non-private regression checks for chunking and transient upload recovery."""
from __future__ import annotations

import tempfile
from pathlib import Path
from types import SimpleNamespace

import worker

def assert_source_preserved(section: worker.Section) -> None:
    chunks = worker.chunks_for(section)
    assert chunks
    source = worker.words(section.spoken_text.replace("[[SCENE_BREAK]]", " "))
    generated = worker.words(" ".join(ch.text for ch in chunks))
    assert source == generated, (source, generated)
    assert all(0 < ch.word_count <= worker.MAX_CHUNK_WORDS for ch in chunks)
    assert all(len(ch.text) <= worker.MAX_CHUNK_CHARS for ch in chunks)
    assert all(ch.word_count > 1 for ch in chunks), [(ch.text,ch.word_count) for ch in chunks]

def test_tiny_chunk_merge():
    # Chapter 27's original failure was a 1-word second chunk after a short title.
    assert_source_preserved(worker.Section(
        27, "chapter", "Chapter Twenty-Seven", "Chapter Twenty-Seven",
        ["I.", "A tall stranger stepped into the light and looked at the empty corridor.",
         "There was no sign of the person who had called for help."]
    ))
    assert_source_preserved(worker.Section(
        8, "chapter", "CHAPTER 8", "An Unanswered Question",
        ["No.", "Nothing about this place was what she had expected when she arrived.",
         "He turned around.", "And left."]
    ))
    assert_source_preserved(worker.Section(
        10, "chapter", "CHAPTER 10", "The Gate",
        ["The old watchman had never spoken to the boy before.",
         "No.", "He said he had seen the lights through the window."]
    ))

def test_natural_sentence_packing():
    prose = [
        "The man unlocked the rusty garden gate.",
        "His neighbor was waiting under the tree.",
        "Neither of them had expected the visitor.",
        "They walked slowly toward the empty house.",
        "Someone had left a letter on the table.",
        "The paper was wet from yesterday's rain.",
        "He carefully opened it beside the window.",
        "The first sentence was difficult to understand.",
        "His neighbor asked him to continue reading.",
        "Outside, the sky began to turn orange.",
        "They had finally found the missing message.",
    ]
    section = worker.Section(6, "chapter", "Chapter Six", "Chapter Six", prose)
    chunks = worker.chunks_for(section)
    assert len(chunks) <= 5, (len(chunks), [c.text for c in chunks])
    assert worker.words(" ".join(prose)) == worker.words(" ".join(c.text for c in chunks))
    assert all(c.word_count <= worker.MAX_CHUNK_WORDS for c in chunks)
    assert all(len(c.text) <= worker.MAX_CHUNK_CHARS for c in chunks)
    # No chunk may join across a scene break.
    marked = worker.Section(8, "chapter", "Chapter Eight", "Chapter Eight", prose[:4]+["*"]+prose[4:])
    divided = worker.chunks_for(marked)
    assert any(c.pause_after >= worker.SCENE_PAUSE for c in divided[:-1]),divided
    assert worker.words(" ".join(prose)) == worker.words(" ".join(c.text for c in divided))


def test_german_chunk_transcript_gate():
    source = "Er ging am Morgen in den Garten und sah seine Schwester neben dem alten Baum stehen."
    good = "Er ging am Morgen in den Garten und sah seine Schwester neben dem alten Baum stehen."
    nonsense = "Bollek ach der brent Karhel ga na but ist wer"
    assert worker.german_chunk_text_pass(source,good)[0]
    passed,detail=worker.german_chunk_text_pass(source,nonsense)
    assert not passed and detail["reasons"],detail
    assert not worker.german_chunk_text_pass("Nein.","")[0], "Empty speech must never be accepted"


def test_transient_upload_retry():
    class Response:
        def __init__(self, status, data):
            self.status_code = status
            self.ok = 200 <= status < 300
            self.content = b"x"
            self._json = data
        def json(self):
            return self._json

    old_post = worker.requests.post
    old_oidc = worker.oidc_token
    old_sleep = worker.time.sleep
    tries = []
    replies = [Response(400, {"ok":False,"error":"Bad Gateway"}),
               Response(502, {"ok":False,"error":"Bad Gateway"}),
               Response(200, {"ok":True,"storagePath":"p/voice/section.mp3","byteSize":6})]
    def post(*args,**kw):
        body = kw.get("data")
        assert body is not None and body.read() == b"ABCDEF"
        tries.append(kw["headers"]["x-section-index"])
        return replies.pop(0)
    try:
        worker.oidc_token = lambda: "test-token"
        worker.requests.post = post
        worker.time.sleep = lambda secs: None
        with tempfile.TemporaryDirectory() as td:
            path = Path(td)/"section.mp3"
            path.write_bytes(b"ABCDEF")
            result = worker.api_upload_section("example",27,path)
            assert result["storagePath"] == "p/voice/section.mp3",result
            assert tries == ["27","27","27"],tries
            def hard_fail(*args,**kwargs):
                return Response(403,{"ok":False,"error":"WORKER_UNAUTHORIZED"})
            worker.requests.post = hard_fail
            try:
                worker.api_upload_section("example",27,path)
                raise AssertionError("Authorization failure was retried/accepted")
            except RuntimeError as exc:
                assert "non-retryable" in str(exc),str(exc)
    finally:
        worker.requests.post = old_post
        worker.oidc_token = old_oidc
        worker.time.sleep = old_sleep

if __name__ == "__main__":
    test_tiny_chunk_merge()
    test_natural_sentence_packing()
    test_german_chunk_transcript_gate()
    test_transient_upload_retry()
    print("RESILIENCE_TESTS=PASS")
