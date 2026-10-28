"""Build private download parts from existing QC-passed audio. No audio in Git."""
import json, os, re, shutil, subprocess, tempfile, urllib.request, zipfile
from pathlib import Path

API = "https://ipoqyjrojljmbqslmxxf.supabase.co/functions/v1/audiobook-factory"
LIMIT = 47_000_000
def api(op, **values):
    request = urllib.request.Request(os.environ["ACTIONS_ID_TOKEN_REQUEST_URL"] + "&audience=ajk-audiobook-factory", headers={"Authorization": "bearer " + os.environ["ACTIONS_ID_TOKEN_REQUEST_TOKEN"]})
    with urllib.request.urlopen(request, timeout=30) as r:
        token = json.load(r)["value"]
    request = urllib.request.Request(API, data=json.dumps({"op":op, **values}).encode(), headers={"Authorization":"Bearer "+token, "Content-Type":"application/json"})
    with urllib.request.urlopen(request, timeout=90) as r:
        result = json.load(r)
    if not result.get("ok"):
        raise RuntimeError("Private download API rejected request")
    return result

def run(*args):
    return subprocess.check_output(args, stderr=subprocess.DEVNULL).decode()

def duration(path):
    return float(run("ffprobe","-v","error","-show_entries","format=duration","-of","default=nw=1:nk=1",str(path)).strip())

def safe(value):
    return re.sub(r"[^\w .-]+", "", str(value)).strip()[:90] or "Kapitel"

def split_oversized_chapters(chapters, folder, max_seconds=1800):
    """Make export-only, stream-copied MP3 segments; never change source chapters.

    Keep each source chapter's original when it fits the limit and is short.
    The resulting segments are suitable for both ZIP and M4B assembly.
    """
    expanded = []
    for ch in chapters:
        source = ch["local"]
        source_bytes = source.stat().st_size
        total = ch["seconds"]
        if source_bytes <= LIMIT - 10000 and total <= max_seconds:
            expanded.append(ch)
            continue
        # Conservative byte-based estimate for high-bitrate MP3 sources.
        target_seconds = min(float(max_seconds), total * (LIMIT - 1000000) / max(source_bytes, 1) * 0.8)
        if target_seconds < 1:
            raise ValueError("MP3 segment too large")
        start, part = 0.0, 1
        while start < total - 0.05:
            length = min(target_seconds, total - start)
            target = folder / f'mp3-source-{ch["chapter_index"]:04d}-{part:03d}.mp3'
            run("ffmpeg", "-v", "error", "-y", "-ss", str(start),
                "-i", str(source), "-t", str(length), "-map", "0:a:0",
                "-c:a", "copy", str(target))
            actual = duration(target)
            if actual <= 0 or abs(actual - length) > 2:
                raise ValueError("MP3 segment duration mismatch")
            if target.stat().st_size > LIMIT - 10000:
                raise ValueError("MP3 segment too large")
            expanded.append({**ch, "local": target, "seconds": actual,
                             "title": f'{ch["title"]} · Abschnitt {part}'})
            start += length
            part += 1
        if abs(sum(x["seconds"] for x in expanded if x["chapter_index"] == ch["chapter_index"]) - total) > max(2.0, 0.1 * part):
            raise ValueError("MP3 segment duration mismatch")
    return expanded

def pack_zip(chapters, folder):
    parts, current, size = [], [], 0
    for ch in chapters:
        n=ch["local"].stat().st_size
        if n > LIMIT:
            raise ValueError("A chapter exceeds the per-file download limit")
        if current and size+n+10000 > LIMIT:
            parts.append(current);current=[];size=0
        current.append(ch);size+=n
    if current:parts.append(current)
    outputs=[]
    for i,part in enumerate(parts,1):
        path=folder/f"mp3-{i:03d}.zip"
        with zipfile.ZipFile(path,"w",compression=zipfile.ZIP_STORED,allowZip64=False) as z:
            for ch in part:
                z.write(ch["local"],f'{ch["chapter_index"]+1:03d} - {safe(ch["title"])}.mp3')
        with zipfile.ZipFile(path) as z:
            if z.testzip() is not None:raise ValueError("ZIP verification failed")
        if path.stat().st_size > LIMIT:raise ValueError("ZIP exceeds limit")
        outputs.append(path)
    return outputs

def escape_meta(value):
    return str(value).replace("\\","\\\\").replace("=","\\=").replace(";","\\;").replace("#","\\#").replace("\n"," ")

def pack_m4b(chapters, book, folder):
    # Start conservatively; AAC can exceed its nominal target bitrate.
    # Verify actual bytes and split oversized groups at chapter boundaries.
    max_seconds = 4500
    groups,current,seconds=[],[],0
    for ch in chapters:
        if current and seconds+ch["seconds"]>max_seconds:
            groups.append(current);current=[];seconds=0
        current.append(ch);seconds+=ch["seconds"]
    if current:groups.append(current)
    outputs=[]
    i=1
    while i<=len(groups):
        group=groups[i-1]
        concat=folder/"concat.txt"
        concat.write_text("".join("file '"+str(ch["local"])+"'\n" for ch in group))
        metadata=folder/"metadata.txt"
        lines=[";FFMETADATA1","title="+escape_meta(book["title"]+(f" · Teil {i}" if len(groups)>1 else "")),"artist="+escape_meta(book.get("narrator_name") or "A. J. Khan"),"album="+escape_meta(book["title"])]
        offset=0
        for ch in group:
            end=offset+round(ch["seconds"]*1000)
            lines+=["[CHAPTER]","TIMEBASE=1/1000",f"START={offset}",f"END={end}","title="+escape_meta(ch["title"])]
            offset=end
        metadata.write_text("\n".join(lines),encoding="utf-8")
        path=folder/f"m4b-{i:03d}.m4b"
        args=["ffmpeg","-v","error","-y","-f","concat","-safe","0","-i",str(concat),"-i",str(metadata)]
        cover=folder/"cover.jpg"
        if cover.exists():args+=["-i",str(cover)]
        args+=["-map","0:a","-map_metadata","1","-map_chapters","1","-c:a","aac","-b:a","64k","-ac","1","-movflags","+faststart"]
        if cover.exists():args+=["-map","2:v","-c:v","mjpeg","-disposition:v","attached_pic"]
        args+=["-f","mp4",str(path)]
        run(*args)
        if path.stat().st_size > LIMIT:
            if len(group)<2:raise ValueError("M4B exceeds limit")
            midpoint=len(group)//2
            groups[i-1:i]=[group[:midpoint],group[midpoint:]]
            path.unlink()
            continue
        probe=json.loads(run("ffprobe","-v","error","-show_chapters","-show_format","-of","json",str(path)))
        if len(probe.get("chapters",[]))!=len(group) or abs(float(probe["format"]["duration"])-sum(ch["seconds"] for ch in group))>2:
            raise ValueError("M4B duration or chapters mismatch")
        outputs.append(path)
        i+=1
    return outputs

def main():
    claim=api("downloadWorkerClaim")
    if not claim.get("job"):return
    job=claim["job"];files=[];stage="dependencies"
    try:
        if not shutil.which("ffmpeg") or not shutil.which("ffprobe"):
            subprocess.run(["sudo","apt-get","update","-qq"],check=True,stdout=subprocess.DEVNULL)
            subprocess.run(["sudo","apt-get","install","-y","-qq","ffmpeg"],check=True,stdout=subprocess.DEVNULL)
        with tempfile.TemporaryDirectory() as tmp:
            folder=Path(tmp);chapters=claim["chapters"];stage="source_read"
            import base64
            cover=claim["book"].get("cover_url") or ""
            if cover.startswith("data:image/jpeg;base64,"):
                payload=base64.b64decode(cover.split(",",1)[1],validate=True)
                if len(payload)<3_000_000:(folder/"cover.jpg").write_bytes(payload)
            elif cover.startswith("https://glassface-khan.github.io/aj-khan-library/assets/covers/"):
                with urllib.request.urlopen(cover,timeout=30) as r:
                    payload=r.read(3_000_001)
                if len(payload)<3_000_000 and payload.startswith(b"\xff\xd8"):(folder/"cover.jpg").write_bytes(payload)
            for i,ch in enumerate(chapters):
                path=folder/f"chapter-{i:04d}.mp3"
                with urllib.request.urlopen(ch.pop("url"),timeout=120) as r, path.open("wb") as out:
                    while True:
                        block=r.read(1024*1024)
                        if not block:break
                        out.write(block)
                ch["local"]=path;ch["seconds"]=duration(path)
                api("downloadWorkerProgress",jobId=job["id"],done=i+1,total=len(chapters)+2)
            stage="zip"
            export_chapters=split_oversized_chapters(chapters,folder)
            outputs=pack_zip(export_chapters,folder)
            api("downloadWorkerProgress",jobId=job["id"],done=len(chapters)+1,total=len(chapters)+2)
            stage="m4b"
            outputs+=pack_m4b(export_chapters,claim["book"],folder)
            for path in outputs:
                stage="upload_sign"
                signed=api("downloadWorkerUpload",jobId=job["id"],name=path.name)
                # Direct private Storage upload bypasses Edge memory limits.
                content_type="application/zip" if path.suffix==".zip" else "audio/mp4"
                request=urllib.request.Request(signed["url"],data=path.read_bytes(),method="PUT",headers={"Content-Type":content_type,"x-upsert":"true"})
                stage="storage_upload"
                with urllib.request.urlopen(request,timeout=120) as r:
                    if r.status>=300:raise ValueError("Private upload rejected")
                files.append({"name":path.name,"bytes":path.stat().st_size})
            stage="verify_files"
            api("downloadWorkerFinish",jobId=job["id"],success=True,files=files)
    except Exception as exc:
        # Never print raw exceptions: they can contain private signed URLs or metadata.
        allowed={"M4B exceeds limit","M4B duration or chapters mismatch","ZIP exceeds limit","ZIP verification failed","Private upload rejected","A chapter exceeds the per-file download limit","Private download API rejected request","MP3 segment duration mismatch","MP3 segment too large"}
        reason=str(exc) if str(exc) in allowed else type(exc).__name__
        code=getattr(exc,"code",None)
        print("Download preparation error: stage="+stage+"; reason="+reason+("; HTTP "+str(code) if isinstance(code,int) else ""),flush=True)
        api("downloadWorkerFinish",jobId=job["id"],success=False)
        raise RuntimeError("Private download preparation failed; source audio unchanged") from None

if __name__=="__main__":
    main()
