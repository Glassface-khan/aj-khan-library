#!/usr/bin/env python3
"""Exact private last-title sample QC. Existing MP3 only, no writes, no transcripts in logs."""
import hashlib
import json
import os
import re
import statistics
import subprocess
import sys
import tempfile
from pathlib import Path

import requests
from docx import Document
from faster_whisper import WhisperModel
from audit_existing_audiobooks import best_alignment

BOOK="b4e3bde1-7d88-4a04-a68f-55ca249af0ce"
TITLE="The Man the World Forgot"
VOICE="peter_yearsley"
BASE="https://ipoqyjrojljmbqslmxxf.supabase.co"
DOC="THE_MAN_THE_WORLD_FORGOT_PUBLICATION_MASTER_FINAL_v1.docx"
DOC_PATH="qc-locked-sources/"+BOOK+"/"+DOC
DOC_SHA="10e279c192d271e0b36121c832ca18387c7b7887478ffcc1bbf94a35ee9a348a"
DOC_BYTES=3736790
CHAPTERS=48
MP3_BYTES=283195392
ORDINALS=["PROLOGUE","ONE","TWO","THREE","FOUR","FIVE","SIX","SEVEN","EIGHT",
"NINE","TEN","ELEVEN","TWELVE","THIRTEEN","FOURTEEN","FIFTEEN","SIXTEEN",
"SEVENTEEN","EIGHTEEN","NINETEEN","TWENTY","TWENTY-ONE","TWENTY-TWO",
"TWENTY-THREE","TWENTY-FOUR","TWENTY-FIVE","TWENTY-SIX","TWENTY-SEVEN",
"TWENTY-EIGHT","TWENTY-NINE","THIRTY","THIRTY-ONE","THIRTY-TWO",
"THIRTY-THREE","THIRTY-FOUR","THIRTY-FIVE","THIRTY-SIX","THIRTY-SEVEN",
"THIRTY-EIGHT","THIRTY-NINE","FORTY","FORTY-ONE","FORTY-TWO","FORTY-THREE",
"FORTY-FOUR","FORTY-FIVE","FORTY-SIX","FORTY-SEVEN"]

def fail(reason):
    raise RuntimeError(reason)

def snapshot():
    path=Path("/tmp/ajk_man_private_snapshot.json")
    if not path.is_file():fail("PRIVATE_SNAPSHOT_MISSING")
    try:d=json.loads(path.read_text())
    except Exception:fail("PRIVATE_SNAPSHOT_INVALID")
    prefix=BASE+"/storage/v1/object/sign/"
    if (d.get("ok") is not True or d.get("source_sha256")!=DOC_SHA or
       d.get("source_bytes")!=DOC_BYTES or d.get("source_path")!=DOC_PATH or
       not str(d.get("source_url","")).startswith(prefix+"audiobook-factory/") or
       len(d.get("chapters") or [])!=CHAPTERS or
       any(not str(c.get("url","")).startswith(prefix+"audiobooks/")
           for c in d["chapters"])):
       fail("PRIVATE_SNAPSHOT_MISMATCH")
    b=d["book"]
    if (b.get("id")!=BOOK or b.get("title")!=TITLE or b.get("voice_key")!=VOICE
        or b.get("site_book_id")!="b_the_man_the_world_forgot_v1" or
        b.get("language_code")!="EN" or b.get("status")!="ready" or
        b.get("is_active") is not True):
        fail("AUDIO_BOOK_SOURCE_CHANGED")
    cs=d["chapters"]
    if ([int(c["chapter_index"]) for c in cs]!=list(range(CHAPTERS)) or
        sum(int(c["byte_size"]) for c in cs)!=MP3_BYTES or
        len(set(c["storage_path"] for c in cs))!=CHAPTERS):
        fail("AUDIO_CHAPTER_SOURCE_CHANGED")
    return d

def signed_get(url,stream=False):
    if not url.startswith(BASE+"/storage/v1/object/sign/"):
        fail("UNEXPECTED_PRIVATE_SOURCE_HOST")
    r=requests.get(url,stream=stream,timeout=(15,180),allow_redirects=False)
    if r.status_code!=200:
        r.close()
        fail("PRIVATE_SOURCE_HTTP_"+str(r.status_code))
    return r

def get_docx(d,path):
    r=signed_get(d["source_url"])
    content=r.content
    r.close()
    if (len(content)!=DOC_BYTES or content[:2]!=b"PK" or
        hashlib.sha256(content).hexdigest()!=DOC_SHA):
        fail("LOCKED_ORIGINAL_SHA256_MISMATCH")
    path.write_bytes(content)

def split_source(path):
    doc=Document(str(path))
    paras=[p.text.strip() for p in doc.paragraphs]
    markers=[i for i,t in enumerate(paras) if t in ORDINALS]
    if (len(markers)!=CHAPTERS or [paras[i] for i in markers]!=ORDINALS or
        len(set(markers))!=CHAPTERS):
        fail("MANUSCRIPT_48_EXACT_ORDINALS_NOT_FOUND")
    endings=[i for i,t in enumerate(paras) if t=="Author’s Note" and i>markers[-1]]
    if len(endings)!=1:
        fail("MANUSCRIPT_BACKMATTER_BOUNDARY_CHANGED")
    sections=[]
    for idx,start in enumerate(markers):
        stop=markers[idx+1] if idx+1<len(markers) else endings[0]
        title=paras[start+1] if start+1<stop else ""
        if not title or len(title)>140:
            fail("MANUSCRIPT_CHAPTER_TITLE_MISSING_"+str(idx))
        content=[x for x in paras[start+2:stop] if x and x!="*"]
        txt=title+". "+" ".join(content)
        if len(txt.split())<200:
            fail("MANUSCRIPT_SECTION_TOO_SHORT_"+str(idx))
        sections.append((title,txt))
    print("LAST_BOOK_SOURCE_STRUCTURE "+json.dumps({
        "exact_sections":len(sections),"original_docx_bytes":DOC_BYTES,
        "sha256_verified":True,"section_indices_contiguous":True,
        "backmatter_excluded":True,"source_modified":False
    },sort_keys=True),flush=True)
    return sections

def retrieve_mp3(ch,path):
    r=signed_get(ch["url"],stream=True)
    n=0
    with path.open("wb") as f:
        for block in r.iter_content(262144):
            if block:
                f.write(block);n+=len(block)
                if n>50000000:fail("MP3_TOO_LARGE")
    r.close()
    if n!=int(ch["byte_size"]):fail("MP3_BYTES_MISMATCH")
    info=subprocess.run(["ffprobe","-v","error","-show_entries","format=duration",
             "-of","json",str(path)],capture_output=True,text=True,check=True,timeout=45)
    dur=float(json.loads(info.stdout)["format"]["duration"])
    if abs(dur-float(ch["duration_seconds"]))>8:fail("MP3_DURATION_MISMATCH")
    return dur

def sample(mp3,wav,dur,fraction):
    at=max(0.,min(dur*fraction,dur-37.))
    subprocess.run(["ffmpeg","-nostdin","-y","-hide_banner","-loglevel","error",
        "-ss",f"{at:.2f}","-i",str(mp3),"-t","35","-vn","-ac","1",
        "-ar","16000","-c:a","pcm_s16le",str(wav)],
        capture_output=True,check=True,timeout=90)
    if wav.stat().st_size<100000:fail("CLIP_TOO_SHORT")
    return round(at,1)

def main():
    if len(ORDINALS)!=CHAPTERS or len(set(ORDINALS))!=CHAPTERS:fail("CONSTANTS_INVALID")
    d=snapshot()
    with tempfile.TemporaryDirectory(prefix="ajk_last_readonly_") as root:
        p=Path(root)
        source=p/"locked.docx"
        get_docx(d,source)
        chapters=split_source(source)
        if sys.argv[1:]==["--source-probe"]:
            print("LAST_BOOK_SOURCE_PROBE=PASS",flush=True)
            return 0
        if len(sys.argv)!=1:fail("UNEXPECTED_ARGUMENT")
        model=WhisperModel("base.en",device="cpu",compute_type="int8",
                           cpu_threads=2,num_workers=1)
        scores=[]
        for idx,ch in enumerate(d["chapters"]):
            mp3,wav=p/"chapter.mp3",p/"sample.wav"
            title,text=chapters[idx]
            recorded=str(ch["title"])
            if idx==0:
                if "prologue" not in recorded.casefold():fail("PROLOGUE_MISMATCH")
            else:
                if not re.match(r"^Chapter "+str(idx)+r"\s*:",recorded,re.I):
                    fail("TRACK_LABEL_INDEX_MISMATCH_"+str(idx))
                norm=lambda x:re.sub(r"[^a-z0-9]+","",x.lower())
                if norm(title) not in norm(recorded):fail("TRACK_CHAPTER_TITLE_MISMATCH_"+str(idx))
            try:
                duration=retrieve_mp3(ch,mp3)
                at=sample(mp3,wav,duration,.46)
                segs,_=model.transcribe(str(wav),language="en",beam_size=3,
                       temperature=0.,vad_filter=False,condition_on_previous_text=False)
                recognized=" ".join(s.text.strip() for s in segs)
                score,n=best_alignment(recognized,text)
                scores.append(score)
                print("LAST_BOOK_QC_CHAPTER "+json.dumps({
                    "index":idx,"score":score,"recognized_words":n,"sample_second":at,
                    "no_transcript_in_logs":True
                },sort_keys=True),flush=True)
            finally:
                mp3.unlink(missing_ok=True)
                wav.unlink(missing_ok=True)
        med=statistics.median(scores)
        low=sum(x<78 for x in scores)
        passed=(len(scores)==CHAPTERS and min(scores)>=65 and med>=82 and low<=4)
        print("LAST_BOOK_QC_FINAL "+json.dumps({
            "book_id":BOOK,"chapters_checked":len(scores),
            "minimum":min(scores),"median":med,"below_78":low,
            "classification":"LOW_RISK_PER_CHAPTER_SAMPLE" if passed else "NEEDS_AUDIO_REVIEW",
            "not_full_transcript_qc":True,"no_audio_changes":True,
            "no_database_writes":True,"migration_started":False
        },sort_keys=True),flush=True)
        return 0 if passed else 2

if __name__=="__main__":
    try:sys.exit(main())
    except Exception as ex:
        reason=str(ex)
        allowed=reason.startswith(("PRIVATE_","AUDIO_","MANUSCRIPT_","LOCKED_","MP3_","CLIP_","TRACK_","PROLOGUE_","UNEXPECTED_","CONSTANTS_"))
        print("LAST_BOOK_QC_BLOCKED "+json.dumps({"exception_type":type(ex).__name__,
            "reason":reason[:110] if allowed else "QC_INTERNAL_ERROR"},sort_keys=True),flush=True)
        sys.exit(2)
