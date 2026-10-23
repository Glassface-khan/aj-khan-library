"""One-file private pilot. No queue use, deletion, sharing, or public audio."""
import hashlib,json,os,urllib.parse,urllib.request
NAME='m4b-007.m4b'
PATH='d4a451a9-0a49-4bce-a323-d3038fce4714/'+NAME
SIZE=4744868
AUD='ajk-audio-single-file-pilot-20261023'
SRC='https://ipoqyjrojljmbqslmxxf.supabase.co/storage/v1/object/sign/audiobook-downloads/'+PATH
EDGE='https://ipoqyjrojljmbqslmxxf.supabase.co/functions/v1/ajk-single-file-pilot'
API='https://www.googleapis.com/drive/v3'
UP='https://www.googleapis.com/upload/drive/v3/files'
SCOPE='https://www.googleapis.com/auth/drive.file'
MARK='ajkSingleFileMigrationPilot'
VALUE='2026-10-23-v1'
def http(url,data=None,method=None,headers=None,timeout=75):
    return urllib.request.urlopen(urllib.request.Request(url,data=data,method=method,headers=headers or {}),timeout=timeout)
def j(url,token,payload=None,method=None):
    assert url.startswith('https://www.googleapis.com/')
    data=json.dumps(payload).encode() if payload is not None else None
    with http(url,data,method,{'Authorization':'Bearer '+token,'Content-Type':'application/json'}) as r:return json.load(r)
def source():
    oidc=os.environ['ACTIONS_ID_TOKEN_REQUEST_URL']+'&audience='+AUD
    with http(oidc,headers={'Authorization':'bearer '+os.environ['ACTIONS_ID_TOKEN_REQUEST_TOKEN']}) as r:token=json.load(r)['value']
    with http(EDGE,b'{}','POST',{'Authorization':'Bearer '+token,'Content-Type':'application/json'}) as r:claim=json.load(r)
    if claim.get('ok') is not True or claim.get('path')!=PATH or claim.get('bytes')!=SIZE:raise RuntimeError('source_claim')
    url=claim.get('signedUrl','')
    if not isinstance(url,str) or not url.startswith(SRC+'?'):raise RuntimeError('source_url')
    with http(url) as r:b=r.read(SIZE+1)
    if len(b)!=SIZE:raise RuntimeError('source_size')
    return b
def drive_token():
    keys=('GOOGLE_DRIVE_CLIENT_ID','GOOGLE_DRIVE_CLIENT_SECRET','GOOGLE_DRIVE_REFRESH_TOKEN')
    if not all(os.environ.get(k) for k in keys):raise RuntimeError('google_secrets_absent')
    data=urllib.parse.urlencode(dict(client_id=os.environ[keys[0]],client_secret=os.environ[keys[1]],refresh_token=os.environ[keys[2]],grant_type='refresh_token')).encode()
    with http('https://oauth2.googleapis.com/token',data,'POST',{'Content-Type':'application/x-www-form-urlencoded'}) as r:d=json.load(r)
    if set(d.get('scope','').split())!={SCOPE}:raise RuntimeError('scope_mismatch')
    return d['access_token']
def private(token,id):
    meta=j(API+'/files/'+id+'?fields=id,mimeType,trashed',token)
    if meta.get('trashed') or meta.get('mimeType')!='application/vnd.google-apps.folder':raise RuntimeError('folder_invalid')
    p=j(API+'/files/'+id+'/permissions?fields=nextPageToken,permissions(type,role)',token)
    ps=p.get('permissions',[])
    if p.get('nextPageToken') or len(ps)!=1 or ps[0].get('type')!='user' or ps[0].get('role')!='owner':raise RuntimeError('folder_not_owner_only')
def folder(token):
    q="trashed = false and appProperties has { key='"+MARK+"' and value='"+VALUE+"' }"
    u=API+'/files?'+urllib.parse.urlencode({'q':q,'fields':'nextPageToken,files(id,mimeType)','pageSize':20})
    out=j(u,token)
    files=out.get('files',[])
    if out.get('nextPageToken') or len(files)>1:raise RuntimeError('ambiguous_folder')
    if files:
        if files[0].get('mimeType')!='application/vnd.google-apps.folder':raise RuntimeError('folder_marker')
        id=files[0]['id']
    else:
        f=j(API+'/files?fields=id',token,{'name':'AJK PRIVATE — One-file migration verification 2026-10-23','mimeType':'application/vnd.google-apps.folder','appProperties':{MARK:VALUE}},'POST')
        id=f['id']
    private(token,id)
    return id
def existing(token,folder_id,md5):
    q="trashed = false and '"+folder_id+"' in parents and name = '"+NAME+"'"
    u=API+'/files?'+urllib.parse.urlencode({'q':q,'fields':'nextPageToken,files(id,size,md5Checksum)','pageSize':10})
    d=j(u,token); files=d.get('files',[])
    if d.get('nextPageToken') or len(files)>1:raise RuntimeError('ambiguous_file')
    if not files:return None
    if str(files[0].get('size'))!=str(SIZE) or files[0].get('md5Checksum')!=md5:raise RuntimeError('file_conflict_no_overwrite')
    return files[0]['id']
def upload(token,folder_id,b,md5):
    meta={'name':NAME,'parents':[folder_id],'mimeType':'audio/mp4','appProperties':{MARK:VALUE}}
    with http(UP+'?uploadType=resumable&fields=id,size,md5Checksum',json.dumps(meta).encode(),'POST',{
        'Authorization':'Bearer '+token,'Content-Type':'application/json',
        'X-Upload-Content-Type':'audio/mp4','X-Upload-Content-Length':str(len(b))}) as r:session=r.headers['Location']
    if not session.startswith('https://www.googleapis.com/'):raise RuntimeError('upload_host')
    with http(session,b,'PUT',{'Authorization':'Bearer '+token,'Content-Type':'audio/mp4'},90) as r:f=json.load(r)
    if f.get('md5Checksum')!=md5 or str(f.get('size'))!=str(SIZE):raise RuntimeError('upload_integrity')
    return f['id']
def verify(token,id,folder_id,b,md5):
    m=j(API+'/files/'+id+'?fields=id,name,size,md5Checksum,parents,trashed',token)
    if m.get('name')!=NAME or m.get('trashed') or str(m.get('size'))!=str(SIZE) or m.get('md5Checksum')!=md5 or folder_id not in m.get('parents',[]):raise RuntimeError('readback_metadata')
    with http(API+'/files/'+id+'?alt=media',headers={'Authorization':'Bearer '+token},timeout=90) as r:got=r.read(SIZE+1)
    if len(got)!=SIZE or hashlib.sha256(got).digest()!=hashlib.sha256(b).digest():raise RuntimeError('sha256_readback')
    p=j(API+'/files/'+id+'/permissions?fields=nextPageToken,permissions(type,role)',token)
    ps=p.get('permissions',[])
    if p.get('nextPageToken') or len(ps)!=1 or ps[0].get('type')!='user' or ps[0].get('role')!='owner':raise RuntimeError('file_not_owner_only')
    private(token,folder_id)
def main():
    b=source(); md5=hashlib.md5(b).hexdigest(); sha=hashlib.sha256(b).hexdigest()
    token=drive_token(); dst=folder(token);id=existing(token,dst,md5)
    if id is None:id=upload(token,dst,b,md5)
    verify(token,id,dst,b,md5)
    print('PILOT_PASS EXACTLY_ONE PRIVATE OWNER_ONLY SOURCE_UNCHANGED')
    print('BYTES='+str(len(b))+' MD5='+md5+' SHA256='+sha)
if __name__=='__main__':
    try:main()
    except Exception:
        print('PILOT_FAILED_NO_BATCH_NO_DELETE')
        raise SystemExit(1)
