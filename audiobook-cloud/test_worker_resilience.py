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
    test_transient_upload_retry()
    print("RESILIENCE_TESTS=PASS")
