#!/usr/bin/env python3
"""Read-only, privacy-preserving audiobook quality sampling.

Each completed narrator edition gets independently re-transcribed MP3 samples
from beginning/middle/end chapters. Samples are compared to the ORIGINAL
uploaded manuscript instead of trusting stored production QC. Only numerical
scores and book names are printed. Audio and prose never leave the CI runner.
"""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import time
import unicodedata

import requests
from rapidfuzz import fuzz
from faster_whisper import WhisperModel

sys.path.insert(0, str(Path(__file__).parent))
from worker import parse_source

API = "https://ipoqyjrojljmbqslmxxf.supabase.co/functions/v1/audiobook-factory"

def api(token, op, **kwargs):
    r = requests.post(API, headers={"Authorization":"Bearer "+token},
                      json={"op":op, **kwargs}, timeout=180)
    r.raise_for_status()
    data = r.json()
    if not data.get("ok"):
        raise RuntimeError("Audit operation rejected: " + str(data.get("error","unknown"))[:100])
    return data

def download(url, target):
    if not url.startswith("https://") or "supabase.co/storage/" not in url:
        raise ValueError("Unexpected private signed storage URL")
    with requests.get(url,stream=True,timeout=240) as response:
        response.raise_for_status()
        with target.open("wb") as handle:
            for block in response.iter_content(chunk_size=262144):
                if block: handle.write(block)
    if target.stat().st_size<512:
        raise RuntimeError("Unexpected empty source/audio")

def token_normalize(value):
    value=unicodedata.normalize("NFKC",str(value)).casefold().replace("’","'")
    return re.findall(r"[\wäöüß']+",value,flags=re.UNICODE)

def best_alignment(transcript,reference):
    """Best local sequential string match, rather than chapter-wide averaged QC."""
    heard=token_normalize(transcript)
    original=token_normalize(reference)
    if len(heard)<4 or len(original)<12:
        return 0., len(heard)
    best=0.
    h=len(heard)
    # Compare the 40-second passage against all similarly sized passages
    # in the original text: chapter headings and speaking offsets do not matter.
    for window in {max(12,int(h*.85)), h, int(h*1.12)+1}:
        step=max(4,min(10,h//8))
        for start in range(0,max(1,len(original)-window+1),step):
            probe=" ".join(original[start:start+window])
            candidate=fuzz.ratio(" ".join(heard),probe)
            if candidate>best:best=candidate
            if best>96:break
        if best>96:break
    return round(best,1),len(heard)

def sample_audio(mp3,wav,at):
    cmd=["ffmpeg","-nostdin","-y","-hide_banner","-loglevel","error",
         "-ss",str(round(at,1)),"-i",str(mp3),
         "-t","40","-vn","-ac","1","-ar","16000",
         "-c:a","pcm_s16le",str(wav)]
    subprocess.run(cmd,check=True,timeout=150)
    if not wav.exists() or wav.stat().st_size<64000:
        raise RuntimeError("Audio sample too short")

def assess(scores):
    if len(scores)<2:
        return "REVIEW_INSUFFICIENT"
    matches=[s["matching_score"] for s in scores]
    if min(matches)<50 or sum(v<60 for v in matches)>=2:
        return "HIGH_RISK"
    if min(matches)<68 or sum(v<78 for v in matches)>=2:
        return "REVIEW"
    return "LOW_RISK_SAMPLE_ONLY"

def main():
    p=argparse.ArgumentParser()
    p.add_argument("--shard",type=int,required=True)
    p.add_argument("--shards",type=int,default=8)
    p.add_argument("--max-books",type=int,default=0)
    p.add_argument("--manifest-only",action="store_true")
    args=p.parse_args()
    token=os.environ.get("AUDIT_OIDC_TOKEN","").strip()
    if not token:raise RuntimeError("Missing ephemeral audit-only worker identity")
    books=api(token,"workerAudioAuditCatalog")["books"]
    books.sort(key=lambda b:(str(b["voice_key"]),str(b["title"]),str(b["id"])))
    chosen=[b for i,b in enumerate(books) if i%args.shards==args.shard]
    if args.max_books:chosen=chosen[:args.max_books]
    print("AUDIO_AUDIT_SHARD "+json.dumps({"shard":args.shard,"total_editions":len(books),
                                             "assigned":len(chosen),"sampled_chapters_per_edition":3}),
          flush=True)
    if args.manifest_only:
        return 0
    checkers={}
    passes=reviews=failures=0
    with tempfile.TemporaryDirectory(prefix="private_audio_qc_") as root:
      folder=Path(root)
      for book in chosen:
        result={"title":book["title"],"narrator":book["narrator_name"],
                "voice_key":book["voice_key"],"edition_id":book["id"],
                "language":book["language_code"],"classification":"UNAVAILABLE","samples":[]}
        try:
          payload=api(token,"workerAudioAuditEdition",bookId=book["id"])
          samples=payload.get("samples",[])
          if not samples or not payload.get("source_url"):
              result["reason"]=payload.get("reason","MISSING_SOURCE")
          else:
              name=str(payload.get("source_file") or "book.docx")
              ext=".epub" if name.lower().endswith(".epub") else ".docx"
              source=folder/("source"+ext)
              download(payload["source_url"],source)
              _,original_sections,_=parse_source(source)
              section_map={int(section.index):section for section in original_sections}
              source.unlink(missing_ok=True)
              language=book["language_code"]
              if language not in checkers:
                  model_name="small" if language=="DE" else "base.en"
                  checkers[language]=WhisperModel(model_name,device="cpu",
                      compute_type="int8",cpu_threads=2,num_workers=1)
              model=checkers[language]
              for index,spec in enumerate(samples):
                chapter_idx=int(spec["chapter_index"])
                sample={"chapter":chapter_idx,"matching_score":0.,"recognized_words":0}
                try:
                    section=section_map.get(chapter_idx)
                    if section is None:raise ValueError("No matching source section")
                    audio=folder/("chapter"+str(index)+".mp3")
                    clip=folder/("clip"+str(index)+".wav")
                    download(spec["audio_url"],audio)
                    duration=float(spec.get("duration_seconds") or 0)
                    # Sample distributed throughout the chapter, not just its intro.
                    offset=([60.,max(60.,duration*.46),max(60.,duration*.72)][index])
                    offset=min(offset,max(0.,duration-45.))
                    sample_audio(audio,clip,offset)
                    transcribed,_=model.transcribe(str(clip),language="de" if language=="DE" else "en",
                        beam_size=3,temperature=0.,vad_filter=False,condition_on_previous_text=False)
                    heard=" ".join(s.text.strip() for s in transcribed)
                    score,n=best_alignment(heard,section.spoken_text)
                    sample.update({"matching_score":score,"recognized_words":n,
                                   "sample_second":round(offset,1)})
                except Exception as e:
                    sample["sample_error"]=type(e).__name__
                finally:
                    for f in (folder/("chapter"+str(index)+".mp3"),folder/("clip"+str(index)+".wav")):
                        f.unlink(missing_ok=True)
                result["samples"].append(sample)
              clean=[x for x in result["samples"] if not x.get("sample_error")]
              result["classification"]=assess(clean)
              if result["classification"]=="LOW_RISK_SAMPLE_ONLY":passes+=1
              elif result["classification"]=="HIGH_RISK":failures+=1
              else:reviews+=1
        except Exception as exc:
          result["reason"]=type(exc).__name__
          reviews+=1
        # Print no source text, transcripts, audio data or signed URLs.
        print("AUDIO_AUDIT_EDITION "+json.dumps(result,ensure_ascii=False,sort_keys=True),flush=True)
    print("AUDIO_AUDIT_SHARD_SUMMARY "+json.dumps({
        "shard":args.shard,"total":len(chosen),"low_risk_sample":passes,
        "review_or_unavailable":reviews,"high_risk":failures},sort_keys=True),flush=True)
    return 0

if __name__=="__main__":
    raise SystemExit(main())
