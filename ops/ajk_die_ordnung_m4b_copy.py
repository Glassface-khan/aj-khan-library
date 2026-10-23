"""One edition only: seven M4B exports, private Drive, no queues or deletions."""
import hashlib, json, os, urllib.parse, urllib.request, urllib.error
from pathlib import Path
from tempfile import TemporaryDirectory

PREFIX="d4a451a9-0a49-4bce-a323-d3038fce4714/"
FILES=[
    ("m4b-001.m4b",34152093),("m4b-002.m4b",37777337),
    ("m4b-003.m4b",34729129),("m4b-004.m4b",36143577),
    ("m4b-005.m4b",37076966),("m4b-006.m4b",37962300),
    ("m4b-007.m4b",4744868),
]
assert len(FILES)==7 and sum(x[1] for x in FILES)==222586270
AUD="ajk-die-ordnung-m4b-backup-20261023"
EDGE="https://ipoqyjrojljmbqslmxxf.supabase.co/functions/v1/ajk-die-ordnung-backup"
SOURCE="https://ipoqyjrojljmbqslmxxf.supabase.co/storage/v1/object/sign/audiobook-downloads/"
API="https://www.googleapis.com/drive/v3"
UPLOAD="https://www.googleapis.com/upload/drive/v3/files"
SCOPE="https://www.googleapis.com/auth/drive.file"
ROOT_KEY="ajkPrivateAudiobookBackupRoot"
BOOK_KEY="ajkDieOrdnungBackup20261023"

def request(url,data=None,method=None,headers=None,timeout=110):
    return urllib.request.urlopen(urllib.request.Request(url,data=data,method=method,headers=headers or {}),timeout=timeout)

def google(url,token,payload=None,method=None):
    if not url.startswith("https://www.googleapis.com/drive/v3/"):
        raise RuntimeError("invalid_google_api")
    data=json.dumps(payload).encode() if payload is not None else None
    with request(url,data,method,{"Authorization":"Bearer "+token,"Content-Type":"application/json"}) as r:
        return json.load(r)

def oidc_sources():
    auth={"Authorization":"bearer "+os.environ["ACTIONS_ID_TOKEN_REQUEST_TOKEN"]}
    with request(os.environ["ACTIONS_ID_TOKEN_REQUEST_URL"]+"&audience="+AUD,headers=auth,timeout=30) as r:
        jwt=json.load(r)["value"]
    with request(EDGE,data=b"{}",method="POST",headers={"Authorization":"Bearer "+jwt,"Content-Type":"application/json"},timeout=45) as r:
        out=json.load(r)
    if out.get("ok") is not True or out.get("edition")!="DIE ORDNUNG / Arne B. / DE":
        raise RuntimeError("source_authorization")
    found=out.get("files")
    if not isinstance(found,list) or len(found)!=len(FILES):raise RuntimeError("source_manifest_count")
    for i,(name,size) in enumerate(FILES):
        it=found[i]
        if it.get("name")!=name or it.get("bytes")!=size:raise RuntimeError("source_manifest_mismatch")
        u=urllib.parse.urlparse(str(it.get("url","")))
        if u.scheme!="https" or u.hostname!="ipoqyjrojljmbqslmxxf.supabase.co" or u.path!="/storage/v1/object/sign/audiobook-downloads/"+PREFIX+name or not u.query:
            raise RuntimeError("source_url_mismatch")
    return found

def token():
    keys=("GOOGLE_DRIVE_CLIENT_ID","GOOGLE_DRIVE_CLIENT_SECRET","GOOGLE_DRIVE_REFRESH_TOKEN")
    if not all(os.environ.get(k) for k in keys):raise RuntimeError("missing_drive_credentials")
    data=urllib.parse.urlencode(dict(client_id=os.environ[keys[0]],client_secret=os.environ[keys[1]],
        refresh_token=os.environ[keys[2]],grant_type="refresh_token")).encode()
    with request("https://oauth2.googleapis.com/token",data,method="POST",
        headers={"Content-Type":"application/x-www-form-urlencoded"},timeout=30) as r:
        result=json.load(r)
    if set(result.get("scope","").split())!={SCOPE}:raise RuntimeError("drive_scope_mismatch")
    return result["access_token"]

def private(token,file_id,folder=True):
    what=google(API+"/files/"+file_id+"?fields=id,mimeType,trashed",token)
    if what.get("trashed"):raise RuntimeError("destination_trashed")
    if folder and what.get("mimeType")!="application/vnd.google-apps.folder":raise RuntimeError("destination_not_folder")
    page=google(API+"/files/"+file_id+"/permissions?fields=nextPageToken,permissions(type,role)",token)
    permissions=page.get("permissions",[])
    if page.get("nextPageToken") or len(permissions)!=1 or permissions[0].get("type")!="user" or permissions[0].get("role")!="owner":
        raise RuntimeError("destination_not_owner_only")

def find_tagged(token,key,value,parent=None):
    q="trashed = false and appProperties has { key='"+key+"' and value='"+value+"' }"
    if parent:q+=" and '"+parent+"' in parents"
    url=API+"/files?"+urllib.parse.urlencode({"q":q,"fields":"nextPageToken,files(id,name,mimeType,size,md5Checksum,parents)","pageSize":100})
    result=google(url,token)
    if result.get("nextPageToken"):raise RuntimeError("ambiguous_drive_pagination")
    found=result.get("files",[])
    if len(found)>1:raise RuntimeError("ambiguous_drive_tag")
    return found[0] if found else None

def folder(token,key,value,title,parent=None):
    found=find_tagged(token,key,value,parent)
    if found:
        folder_id=found["id"]
    else:
        payload={"name":title,"mimeType":"application/vnd.google-apps.folder","appProperties":{key:value}}
        if parent:payload["parents"]=[parent]
        folder_id=google(API+"/files?fields=id",token,payload,"POST")["id"]
    private(token,folder_id)
    return folder_id

def download(url,path,size):
    digest=hashlib.sha256()
    md5=hashlib.md5()
    count=0
    with request(url,timeout=120) as r, path.open("wb") as f:
        while block:=r.read(1024*1024):
            count+=len(block)
            if count>size:raise RuntimeError("source_oversize")
            digest.update(block);md5.update(block);f.write(block)
    if count!=size:raise RuntimeError("source_size_mismatch")
    return digest.hexdigest(),md5.hexdigest()

def upload(token,book_id,name,path,size):
    body={"name":name,"mimeType":"audio/mp4","parents":[book_id],"appProperties":{BOOK_KEY:name}}
    headers={"Authorization":"Bearer "+token,"Content-Type":"application/json",
             "X-Upload-Content-Type":"audio/mp4","X-Upload-Content-Length":str(size)}
    with request(UPLOAD+"?uploadType=resumable&fields=id,size,md5Checksum",
                 json.dumps(body).encode(),"POST",headers,timeout=80) as r:
        session=r.headers["Location"]
    parsed=urllib.parse.urlparse(session)
    if parsed.scheme!="https" or parsed.hostname!="www.googleapis.com":
        raise RuntimeError("invalid_upload_session")
    with request(session,path.read_bytes(),"PUT",
                 {"Authorization":"Bearer "+token,"Content-Type":"audio/mp4"},timeout=150) as r:
        result=json.load(r)
    return result

def readback(token,file_id,book_id,name,size,sha,md5):
    meta=google(API+"/files/"+file_id+"?fields=id,name,size,md5Checksum,parents,trashed",token)
    if (meta.get("trashed") or meta.get("name")!=name or
        int(meta.get("size",-1))!=size or meta.get("md5Checksum")!=md5 or
        book_id not in meta.get("parents",[])):
        raise RuntimeError("drive_metadata_readback")
    private(token,file_id,folder=False)
    h=hashlib.sha256()
    count=0
    with request(API+"/files/"+file_id+"?alt=media",headers={"Authorization":"Bearer "+token},timeout=120) as r:
        while block:=r.read(1024*1024):
            count+=len(block)
            if count>size:raise RuntimeError("drive_readback_oversize")
            h.update(block)
    if count!=size or h.hexdigest()!=sha:raise RuntimeError("drive_sha256_readback")
    return {"name":name,"bytes":size,"md5":md5,"sha256":sha,"driveFileId":file_id}

def execute():
    sources=oidc_sources()
    t=token()
    root=folder(t,ROOT_KEY,"v1","AJK PRIVATE — Hörbuch-M4B-Backups")
    destination=folder(t,BOOK_KEY,"edition-2026-10-23","DIE ORDNUNG — Arne B. — DE",root)
    completed=[]
    with TemporaryDirectory() as temp:
        for name,size in FILES:
            source=next(x for x in sources if x["name"]==name)
            path=Path(temp)/name
            sha,md5=download(source["url"],path,size)
            previous=find_tagged(t,BOOK_KEY,name,destination)
            if previous:
                if previous.get("name")!=name or int(previous.get("size",-1))!=size or previous.get("md5Checksum")!=md5:
                    raise RuntimeError("existing_file_mismatch_no_overwrite")
                file_id=previous["id"]
            else:
                result=upload(t,destination,name,path,size)
                if int(result.get("size",-1))!=size or result.get("md5Checksum")!=md5:
                    raise RuntimeError("drive_upload_mismatch")
                file_id=result["id"]
            completed.append(readback(t,file_id,destination,name,size,sha,md5))
            path.unlink()
            print("PART_PASS "+name+" bytes="+str(size)+" md5="+md5+" sha256="+sha+" drive_id="+file_id,flush=True)
    private(t,root);private(t,destination)
    if len(completed)!=7 or sum(x["bytes"] for x in completed)!=222586270:raise RuntimeError("book_manifest_incomplete")
    print("BOOK_PASS DIE_ORDNUNG EXACT_7_M4B PRIVATE_OWNER_ONLY TOTAL_BYTES=222586270 SOURCE_UNCHANGED",flush=True)
    print("PRIVATE_BACKUP_FOLDER_ID="+destination,flush=True)

if __name__=="__main__":
    try:execute()
    except Exception:
        print("BOOK_COPY_FAILED_NO_SOURCE_DELETE_NO_OTHER_JOBS",flush=True)
        raise SystemExit(1)
