"""AF3 one-shot read-only verification of existing F1 Drive OAuth secrets.

This script only reads Drive metadata and at most 1 KiB of each of the two
QC-pinned pilot M4B files when the existing OAuth app has access.
No Drive IDs, tokens, filenames, responses, or secrets are printed.
No file, database, Worker, OAuth config or Drive sharing is changed.
The script is on a non-default branch; it never imports a production worker.
"""
from __future__ import annotations
import json
import os
import re
import urllib.error
import urllib.parse
import urllib.request

SCOPE="https://www.googleapis.com/auth/drive.file"
API="https://www.googleapis.com/drive/v3/files"
TOKEN_URL="https://oauth2.googleapis.com/token"
PILOTS={
    "FALSE_SCENT":{"match":"False_Scent_EN_Jessica","bytes":328506009},
    "TREMBLING_OLIVE":{"match":"Trembling_Olivetree_EN_Jessica","bytes":395220064},
}
class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None

opener=urllib.request.build_opener(NoRedirect())

def get_json(url,access):
    assert url.startswith(API)
    req=urllib.request.Request(url,headers={"Authorization":"Bearer "+access,
                                           "Accept":"application/json"})
    with opener.open(req,timeout=25) as r:
        if r.status!=200:raise RuntimeError("non-200")
        value=r.read(120000)
    return json.loads(value)

def main():
    keys=("GOOGLE_DRIVE_CLIENT_ID","GOOGLE_DRIVE_CLIENT_SECRET","GOOGLE_DRIVE_REFRESH_TOKEN")
    if not all(os.environ.get(k) for k in keys):
        print("AF3_EXISTING_OAUTH_SECRETS=INCOMPLETE")
        return 0
    print("AF3_EXISTING_OAUTH_SECRETS=ALL_PRESENT")
    form=urllib.parse.urlencode({
       "client_id":os.environ[keys[0]],
       "client_secret":os.environ[keys[1]],
       "refresh_token":os.environ[keys[2]],
       "grant_type":"refresh_token"}).encode()
    req=urllib.request.Request(TOKEN_URL,form,method="POST",
       headers={"Content-Type":"application/x-www-form-urlencoded"})
    try:
        with opener.open(req,timeout=25) as reply:
            response=json.loads(reply.read(10000))
    except Exception:
        print("AF3_EXISTING_OAUTH_REFRESH=FAILED_NO_SECRET_OUTPUT")
        return 0
    token=response.get("access_token","")
    if not isinstance(token,str) or not token:
        print("AF3_EXISTING_OAUTH_REFRESH=NO_ACCESS_TOKEN")
        return 0
    print("AF3_EXISTING_OAUTH_REFRESH=SUCCESS")
    scopes=response.get("scope","")
    if set(scopes.split())!={SCOPE}:
        print("AF3_EXISTING_OAUTH_SCOPE=NOT_EXACT_DRIVE_FILE")
        return 0
    print("AF3_EXISTING_OAUTH_SCOPE=EXACT_DRIVE_FILE")
    for label,pin in PILOTS.items():
        params=urllib.parse.urlencode({
          "q":"trashed=false and name contains '"+pin["match"]+"'",
          "fields":"nextPageToken,files(id,name,size,mimeType,md5Checksum,version,capabilities(canDownload))",
          "pageSize":"100",
          "spaces":"drive"})
        try:
            data=get_json(API+"?"+params,token)
        except Exception:
            print("AF3_"+label+"_METADATA=FAILED")
            continue
        files=[f for f in data.get("files",[])
            if str(f.get("size"))==str(pin["bytes"])
               and f.get("mimeType") in ("audio/x-m4b","audio/mp4")]
        if data.get("nextPageToken") or len(files)!=1:
            print("AF3_"+label+"_FILE_ACCESS="+("NOT_GRANTED_OR_NOT_FOUND" if not files
                                                  else "AMBIGUOUS"))
            continue
        f=files[0]
        if not re.fullmatch(r"[A-Za-z0-9_-]{12,150}",str(f.get("id",""))):
            print("AF3_"+label+"_INVALID_FILE_ID")
            continue
        if not (isinstance(f.get("md5Checksum"),str)
                and re.fullmatch(r"[0-9a-f]{32}",f["md5Checksum"])
                and str(f.get("version","")).isdigit()):
            print("AF3_"+label+"_METADATA_DIGEST_VERSION=MISSING")
            continue
        print("AF3_"+label+"_FILE_ACCESS=GRANTED_METADATA")
        url=API+"/"+urllib.parse.quote(f["id"],safe="")+"?alt=media"
        req=urllib.request.Request(url,headers={
            "Authorization":"Bearer "+token,
            "Range":"bytes=0-1023",
        })
        try:
            with opener.open(req,timeout=25) as reply:
                code=reply.status
                cr=reply.headers.get("Content-Range","")
                body=reply.read(1025)
            if code==206 and cr=="bytes 0-1023/"+str(pin["bytes"]) and len(body)==1024:
                print("AF3_"+label+"_GOOGLE_RANGE_206=PASS_1024_BYTES")
            else:
                print("AF3_"+label+"_GOOGLE_RANGE_206=INVALID_OR_UNSUPPORTED")
        except urllib.error.HTTPError as exc:
            if exc.code in (301,302,303,307,308):
                print("AF3_"+label+"_GOOGLE_RANGE_206=REDIRECT_REQUIRES_SAFE_FOLLOW")
            else:
                print("AF3_"+label+"_GOOGLE_RANGE_206=HTTP_ERROR")
        except Exception:
            print("AF3_"+label+"_GOOGLE_RANGE_206=NETWORK_OR_ACCESS_ERROR")
    print("AF3_PRIVACY=NO_SECRETS_OR_FILE_IDENTIFIERS_PRINTED")
    print("AF3_FULL_SHA256=NOT_RUN")
    print("AF3_WRITES=NONE")
    return 0

if __name__=="__main__":
    raise SystemExit(main())
