"""AF3 private Pilot Olive independent FULL Google Drive SHA-256 readback.

One-shot, read-only, no disk writes, no file moves/copies to Oracle/R2,
no Drive sharing, no token or file ID logging. Uses existing Github secrets.
Byte-ranged 8 MiB chunks keep RSS low and detect mismatch/truncation.
Only one exact pre-existing approved M4B and the locked QC hash are allowed.
"""
import hashlib
import json
import os
import re
import urllib.parse
import urllib.request
import urllib.error

SIZE=395220064
EXPECTED="0865c43dd4c717e17e2f4297d074e9d9410addcfc847e0379b974b5794d6e579"
SCOPE="https://www.googleapis.com/auth/drive.file"
API="https://www.googleapis.com/drive/v3/files"
MATCH="Trembling_Olivetree_EN_Jessica"
CHUNK=8*1024*1024

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,req,fp,code,msg,headers,url):
        return None
opener=urllib.request.build_opener(NoRedirect())

def json_get(url,token):
    if not url.startswith(API):raise ValueError("untrusted provider")
    req=urllib.request.Request(url,headers={"Authorization":"Bearer "+token})
    with opener.open(req,timeout=35) as rsp:
        if rsp.status!=200:raise RuntimeError("provider status")
        return json.loads(rsp.read(40000))

def main():
    keys=("GOOGLE_DRIVE_CLIENT_ID","GOOGLE_DRIVE_CLIENT_SECRET","GOOGLE_DRIVE_REFRESH_TOKEN")
    if not all(os.environ.get(k) for k in keys):
        print("AF3_OLIVE_DRIVE_FULL_HASH=BLOCKED_MISSING_OAUTH");return 0
    data=urllib.parse.urlencode({
      "client_id":os.environ[keys[0]],"client_secret":os.environ[keys[1]],
      "refresh_token":os.environ[keys[2]],"grant_type":"refresh_token"}).encode()
    try:
        req=urllib.request.Request("https://oauth2.googleapis.com/token",
           data,headers={"Content-Type":"application/x-www-form-urlencoded"})
        with opener.open(req,timeout=30) as rsp:grant=json.loads(rsp.read(15000))
        if set(grant.get("scope","").split())!={SCOPE}:raise ValueError("scope")
        token=grant["access_token"]
        params=urllib.parse.urlencode({
         "q":"trashed = false and name contains '"+MATCH+"'",
         "spaces":"drive","pageSize":"100",
         "fields":"nextPageToken,files(id,size,md5Checksum,version,mimeType,capabilities(canDownload))"})
        found=json_get(API+"?"+params,token)
        files=[f for f in found.get("files",[]) if str(f.get("size"))==str(SIZE)
            and f.get("mimeType") in ("audio/x-m4b","audio/mp4")]
        if found.get("nextPageToken") or len(files)!=1:raise ValueError("ambiguous file")
        original=files[0]
        fid=original["id"]
        if not re.fullmatch(r"[A-Za-z0-9_-]{12,150}",fid):raise ValueError("bad id")
        if (not re.fullmatch("[0-9a-f]{32}",str(original.get("md5Checksum","")))
            or not str(original.get("version","")).isdigit()
            or original.get("capabilities",{}).get("canDownload") is not True):
            raise ValueError("unverified original")
        media_url=API+"/"+urllib.parse.quote(fid,safe="")+"?alt=media"
        hasher=hashlib.sha256()
        n=0
        count=0
        for start in range(0,SIZE,CHUNK):
            end=min(SIZE-1,start+CHUNK-1)
            req=urllib.request.Request(media_url,headers={
               "Authorization":"Bearer "+token,"Range":"bytes="+str(start)+"-"+str(end)})
            with opener.open(req,timeout=90) as rsp:
                if (rsp.status!=206 or
                    rsp.headers.get("Content-Range")!="bytes "+str(start)+"-"+str(end)+"/"+str(SIZE)
                    or int(rsp.headers.get("Content-Length","-1"))!=end-start+1):
                    raise ValueError("wrong range")
                received=0
                while True:
                    block=rsp.read(1024*1024)
                    if not block:break
                    hasher.update(block)
                    received+=len(block)
                    if received>end-start+1:raise ValueError("oversize")
            if received!=end-start+1:raise ValueError("truncated")
            n+=received;count+=1
        fields=urllib.parse.urlencode({
         "fields":"id,size,version,md5Checksum,mimeType,capabilities(canDownload)"})
        after=json_get(API+"/"+urllib.parse.quote(fid,safe="")+"?"+fields,token)
        if (any(str(after.get(k))!=str(original.get(k)) for k in
                ("id","size","version","md5Checksum","mimeType"))
            or after.get("capabilities",{}).get("canDownload") is not True):
            raise ValueError("remote object changed mid-readback")
        valid=n==SIZE and hasher.hexdigest()==EXPECTED
        print("AF3_OLIVE_DRIVE_READBACK_BYTES_MATCH="+str(n==SIZE).lower())
        print("AF3_OLIVE_DRIVE_READBACK_SHA256_MATCH="+str(valid).lower())
        print("AF3_OLIVE_DRIVE_OBJECT_VERSION_STABLE=true")
        print("AF3_OLIVE_DRIVE_READBACK_RANGES="+str(count))
        print("AF3_OLIVE_DRIVE_READBACK_PRIVATE_NO_WRITES=true")
        print("AF3_OLIVE_DRIVE_FULL_HASH="+("PASS" if valid else "MISMATCH_BLOCKED"))
        return 0
    except Exception:
        print("AF3_OLIVE_DRIVE_FULL_HASH=BLOCKED_READ_OR_HASH")
        print("AF3_NO_SECRET_FILEID_OR_SOURCE_BYTES_EXPORTED=true")
        return 0

if __name__=="__main__":
    raise SystemExit(main())
