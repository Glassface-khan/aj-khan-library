"""Automated PRIVATE M4B backups. One ready export per run; no deletion or queues."""
import hashlib, json, os, urllib.parse, urllib.request
from pathlib import Path
from tempfile import TemporaryDirectory

AUD="ajk-private-auto-m4b-backup-v1"
EDGE="https://ipoqyjrojljmbqslmxxf.supabase.co/functions/v1/ajk-private-auto-m4b-backup"
SOURCE="https://ipoqyjrojljmbqslmxxf.supabase.co/storage/v1/object/sign/audiobook-downloads/"
API="https://www.googleapis.com/drive/v3"
UP="https://www.googleapis.com/upload/drive/v3/files"
SCOPE="https://www.googleapis.com/auth/drive.file"
ROOT_KEY="ajkPrivateAudiobookBackupRoot"
BOOK_KEY="ajkAutoBackupExport"
MAX_TOTAL=1000000000
MAX_PARTS=30

class BackupStageError(Exception):
    def __init__(self, stage, part):
        super().__init__(stage)
        self.stage=stage
        self.part=part

def at_stage(stage, part, fn, *args):
    try:
        return fn(*args)
    except Exception:
        raise BackupStageError(stage, part) from None

def request(url,data=None,method=None,headers=None,timeout=110):
    return urllib.request.urlopen(urllib.request.Request(url,data=data,method=method,headers=headers or {}),timeout=timeout)

def google(url,token,payload=None,method=None):
    if not url.startswith(API+"/"):raise RuntimeError("google_api_host")
    data=json.dumps(payload).encode() if payload is not None else None
    with request(url,data,method,{"Authorization":"Bearer "+token,"Content-Type":"application/json"}) as r:
        return json.load(r)

def edge(op,extra=None):
    u=os.environ["ACTIONS_ID_TOKEN_REQUEST_URL"]+"&audience="+AUD
    with request(u,headers={"Authorization":"bearer "+os.environ["ACTIONS_ID_TOKEN_REQUEST_TOKEN"]},timeout=30) as r:
        jwt=json.load(r)["value"]
    body=json.dumps(dict(op=op,**(extra or {}))).encode()
    with request(EDGE,body,"POST",{"Authorization":"Bearer "+jwt,"Content-Type":"application/json"},timeout=60) as r:
        response=json.load(r)
    if response.get("ok") is not True:raise RuntimeError("source_auth_failed")
    return response

def drive_token():
    keys=("GOOGLE_DRIVE_CLIENT_ID","GOOGLE_DRIVE_CLIENT_SECRET","GOOGLE_DRIVE_REFRESH_TOKEN")
    if not all(os.environ.get(k) for k in keys):raise RuntimeError("missing_oauth_secrets")
    form=urllib.parse.urlencode(dict(client_id=os.environ[keys[0]],
        client_secret=os.environ[keys[1]],refresh_token=os.environ[keys[2]],grant_type="refresh_token")).encode()
    with request("https://oauth2.googleapis.com/token",form,"POST",
       {"Content-Type":"application/x-www-form-urlencoded"},timeout=30) as r:
        response=json.load(r)
    if set(response.get("scope","").split())!={SCOPE}:raise RuntimeError("oauth_scope_not_restricted")
    return response["access_token"]

def is_private(token,file_id,folder=False):
    info=google(API+"/files/"+file_id+"?fields=id,mimeType,trashed",token)
    if info.get("trashed"):raise RuntimeError("trashed_destination")
    if folder and info.get("mimeType")!="application/vnd.google-apps.folder":
        raise RuntimeError("not_folder")
    roles=google(API+"/files/"+file_id+"/permissions?fields=nextPageToken,permissions(type,role)",token)
    ps=roles.get("permissions",[])
    if roles.get("nextPageToken") or len(ps)!=1 or ps[0].get("type")!="user" or ps[0].get("role")!="owner":
        raise RuntimeError("not_owner_only")

def find_tag(token,key,value,parent=None):
    q="trashed = false and appProperties has { key='"+key+"' and value='"+value+"' }"
    if parent:q+=" and '"+parent+"' in parents"
    u=API+"/files?"+urllib.parse.urlencode({"q":q,"fields":"nextPageToken,files(id,name,mimeType,size,md5Checksum,parents)","pageSize":100})
    r=google(u,token)
    if r.get("nextPageToken") or len(r.get("files",[]))>1:raise RuntimeError("ambiguous_destination")
    return r.get("files",[])[0] if r.get("files") else None

def folder(token,key,value,name,parent=None,create=True):
    found=find_tag(token,key,value,parent)
    if found:
        file_id=found["id"]
    else:
        if not create:raise RuntimeError("root_folder_missing")
        body={"name":name,"mimeType":"application/vnd.google-apps.folder","appProperties":{key:value}}
        if parent:body["parents"]=[parent]
        file_id=google(API+"/files?fields=id",token,body,"POST")["id"]
    is_private(token,file_id,True)
    return file_id

def source_download(source,job_id,path):
    name=source["name"];size=source["bytes"]
    if not isinstance(name,str) or not name.startswith("m4b-") or not name.endswith(".m4b") or not isinstance(size,int) or size<1 or size>50000000:
        raise RuntimeError("invalid_manifest")
    parsed=urllib.parse.urlparse(source.get("url",""))
    if parsed.scheme!="https" or parsed.netloc!="ipoqyjrojljmbqslmxxf.supabase.co" or parsed.path!="/storage/v1/object/sign/audiobook-downloads/"+job_id+"/"+name or not parsed.query:
        raise RuntimeError("bad_signed_source")
    sha=hashlib.sha256();md5=hashlib.md5();count=0
    with request(source["url"],timeout=120) as inp,path.open("wb") as out:
        while block:=inp.read(1024*1024):
            count+=len(block)
            if count>size:raise RuntimeError("oversize_source")
            sha.update(block);md5.update(block);out.write(block)
    if count!=size:raise RuntimeError("wrong_source_size")
    return sha.hexdigest(),md5.hexdigest()

def upload(token,folder_id,name,path,size):
    body={"name":name,"mimeType":"audio/mp4","parents":[folder_id],
          "appProperties":{BOOK_KEY+"File":name}}
    heads={"Authorization":"Bearer "+token,"Content-Type":"application/json",
       "X-Upload-Content-Type":"audio/mp4","X-Upload-Content-Length":str(size)}
    with request(UP+"?uploadType=resumable&fields=id,size,md5Checksum",json.dumps(body).encode(),"POST",heads,timeout=60) as r:
        session=r.headers["Location"]
    uri=urllib.parse.urlparse(session)
    if uri.scheme!="https" or uri.hostname!="www.googleapis.com":raise RuntimeError("upload_url_host")
    with request(session,path.read_bytes(),"PUT",{"Authorization":"Bearer "+token,"Content-Type":"audio/mp4"},timeout=150) as r:
        return json.load(r)

def verified(token,folder_id,file_id,name,size,sha,md5):
    meta=google(API+"/files/"+file_id+"?fields=id,name,size,md5Checksum,parents,trashed",token)
    if (meta.get("trashed") or meta.get("name")!=name or int(meta.get("size",-1))!=size
        or meta.get("md5Checksum")!=md5 or folder_id not in meta.get("parents",[])):
        raise RuntimeError("drive_metadata_mismatch")
    is_private(token,file_id)
    count=0;h=hashlib.sha256()
    with request(API+"/files/"+file_id+"?alt=media",headers={"Authorization":"Bearer "+token},timeout=120) as r:
        while block:=r.read(1024*1024):
            count+=len(block)
            if count>size:raise RuntimeError("drive_readback_oversize")
            h.update(block)
    if count!=size or h.hexdigest()!=sha:raise RuntimeError("drive_sha256_mismatch")
    return {"name":name,"id":file_id,"bytes":size,"md5":md5,"sha256":sha}

def execute():
    import uuid
    target=os.environ.get("TARGET_EXPORT_JOB_ID","").strip()
    extra={}
    if target:
        try:
            target=str(uuid.UUID(target))
        except ValueError:
            raise RuntimeError("invalid_target_export_job_id")
        extra["targetJobId"]=target
    claim=at_stage("BACKUP_CLAIM", "none", edge, "claim", extra)
    job_id=claim.get("jobId")
    if job_id is None:
        print("AUTO_BACKUP_IDLE no_eligible_ready_book",flush=True)
        return
    if not isinstance(job_id,str) or not isinstance(claim.get("files"),list):
        raise RuntimeError("claim_invalid")
    files=claim["files"]
    if not 1<=len(files)<=MAX_PARTS or sum(x.get("bytes",0) for x in files)>MAX_TOTAL:
        raise RuntimeError("claim_limits")
    for i,file in enumerate(files,1):
        if file.get("name")!=f"m4b-{i:03d}.m4b":raise RuntimeError("unordered_manifest")
    book=claim["book"]
    name=" — ".join(str(book.get(k) or "") for k in ("title","narrator","language"))
    if any(c in name for c in ("/","\\","\n","\r")) or len(name)>220:raise RuntimeError("unsafe_book_label")
    token=at_stage("DRIVE_AUTH", "none", drive_token)
    try:
        root=folder(token,ROOT_KEY,"v1","AJK PRIVATE — Hörbuch-M4B-Backups",create=False)
    except Exception:
        raise BackupStageError("DRIVE_FOLDER", "none") from None
    try:
        dest=folder(token,BOOK_KEY,job_id,name,parent=root)
    except Exception:
        raise BackupStageError("DRIVE_FOLDER", "none") from None
    results=[]
    with TemporaryDirectory() as temp:
        for source in files:
            filename=source["name"];path=Path(temp)/filename;size=source["bytes"]
            sha,md5=at_stage("SOURCE_DOWNLOAD",filename,source_download,source,job_id,path)
            old=at_stage("DRIVE_LOOKUP",filename,find_tag,token,BOOK_KEY+"File",filename,dest)
            if old:
                if old.get("name")!=filename or int(old.get("size",-1))!=size or old.get("md5Checksum")!=md5:
                    raise RuntimeError("file_conflict_refuse_overwrite")
                file_id=old["id"]
            else:
                result=at_stage("DRIVE_UPLOAD",filename,upload,token,dest,filename,path,size)
                if int(result.get("size",-1))!=size or result.get("md5Checksum")!=md5:
                    raise RuntimeError("drive_upload_failed_integrity")
                file_id=result["id"]
            results.append(at_stage("DRIVE_READBACK",filename,verified,token,dest,file_id,filename,size,sha,md5))
            path.unlink()
            print("AUTO_PART_PASS "+filename+" bytes="+str(size)+" sha256="+sha,flush=True)
    at_stage("DRIVE_PRIVACY", "none", is_private, token, root, True)
    at_stage("DRIVE_PRIVACY", "none", is_private, token, dest, True)
    if len(results)!=len(files):raise RuntimeError("parts_missing")
    # Final DB state only after all parts and Drive permissions are verified.
    result=at_stage("DRIVE_FINISH", "none", edge, "finish", {"jobId":job_id,"folderId":dest,"files":results})
    if result.get("finished") is not True or result.get("partCount")!=len(files):
        raise RuntimeError("server_receipt_missing")
    print("AUTO_BOOK_PASS parts="+str(len(files))+" bytes="+str(sum(x["bytes"] for x in results))+" folder_id="+dest,flush=True)

if __name__=="__main__":
    try:execute()
    except BackupStageError as e:
        print("AUTO_BACKUP_ERROR stage="+e.stage+" part="+e.part,flush=True)
        print("AUTO_BACKUP_FAILED_NO_SOURCE_DELETE_NO_PUBLIC_SHARE",flush=True)
        raise SystemExit(1)
    except Exception:
        print("AUTO_BACKUP_ERROR stage=BACKUP_INTERNAL part=none",flush=True)
        print("AUTO_BACKUP_FAILED_NO_SOURCE_DELETE_NO_PUBLIC_SHARE",flush=True)
        raise SystemExit(1)
