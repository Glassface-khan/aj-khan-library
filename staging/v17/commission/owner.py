"""Run on the existing V17 host as ajk-tts-ci; no root, pip or cloud provisioning."""
import fcntl
import hashlib
import http.client
import json
import os
from pathlib import Path
import shutil
import sqlite3
import subprocess
import sys
import time
from urllib.parse import urlsplit
from http.server import ThreadingHTTPServer

HERE = Path(__file__).resolve().parent
BASE = Path('/home/ajk-tts-ci/ajk-v2-tts/private')
WORK = BASE / 'legacy-m4b-pilot-d9b78f8'
DB = BASE / 'af3-drive-v17-data/books.sqlite3'
PILOT = json.loads((HERE/'pilot-edition.json').read_text())
FOLDER = PILOT['folder_id']
SLUG = 'set-' + hashlib.sha256(FOLDER.encode()).hexdigest()[:24]
BOOK = '/drive-book/' + SLUG
PART = '/drive-private/books/' + SLUG + '/part/{}/audio.m4b'
PORT = 10003
TS = [str(BASE/'tailscale-user/bin/tailscale'),'--socket='+str(BASE/'tailscale-user/state/tailscaled.sock')]
MODULES = WORK/'modules'
def require(condition,msg):
    if not condition: raise RuntimeError(msg)

def ts_json(*args):
    return json.loads(subprocess.check_output(TS+list(args),timeout=15))

def probe(port,path, owner=None, media=False):
    conn=http.client.HTTPConnection('127.0.0.1',port,timeout=30)
    headers={'Tailscale-User-Login':owner} if owner else {}
    if media: headers['Range']='bytes=0-1'
    try:
        conn.request('GET',path,headers=headers)
        res=conn.getresponse()
        if media:
            require(res.status==206 and res.getheader('Content-Range','').startswith('bytes 0-1/')
                    and res.getheader('Content-Type','').startswith('audio/mp4')
                    and len(res.read(3))==2,'Private Drive range read failed')
        return res.status
    finally: conn.close()

def find_live():
    matches=[]
    for proc in Path('/proc').glob('[0-9]*'):
        try:
            if proc.stat().st_uid!=os.getuid(): continue
            argv=os.fsdecode((proc/'cmdline').read_bytes()).split('\0')
            for arg in argv[1:]:
                if Path(arg).name=='drive_server_v17.py':
                    path=((proc/'cwd').resolve()/arg).resolve()
                    if path.is_file() and BASE in path.parents: matches.append((proc,path.parent))
        except (PermissionError,FileNotFoundError,ProcessLookupError): continue
    require(len(matches)==1,'Expected exactly one live V17 service process')
    proc,src=matches[0]
    # Use only the application-specific settings of the existing process.
    os.environ.pop('AF3_TAILSCALE_DRIVE_CONF',None)
    for item in (proc/'environ').read_bytes().split(b'\0'):
        k,_,v=item.partition(b'=')
        if k in (b'AF3_TAILSCALE_DRIVE_CONF',b'AF3_FFMPEG',b'AF3_FFPROBE',b'PATH'):
            os.environ[os.fsdecode(k)]=os.fsdecode(v)
    require(bool(os.environ.get('AF3_TAILSCALE_DRIVE_CONF')),'V17_SERVICE_DRIVE_CONFIG_MISSING')
    local_git=Path.home()/'AJK_M4B_Tools/bin'
    if (local_git/'git').is_file():
        os.environ['PATH']=str(local_git)+os.pathsep+os.environ['PATH']
    return src

def prepare(src):
    import tempfile
    temp=Path(tempfile.mkdtemp(dir=WORK))
    try:
        dest=temp/'docs/af3/safari-preview'
        dest.mkdir(parents=True)
        for file in src.glob('*.py'): shutil.copyfile(file,dest/file.name)
        patch=HERE.parent/'numbered-drive-m4b-mp4.patch'
        args=['git','apply','--whitespace=nowarn']
        if subprocess.run(args+['--check',str(patch)],cwd=temp,stderr=subprocess.DEVNULL).returncode==0:
            subprocess.run(args+[str(patch)],cwd=temp,check=True)
        else:
            subprocess.run(args+['--reverse','--check',str(patch)],cwd=temp,check=True)
        if not MODULES.exists():
            dest.rename(MODULES)
        else:
            require(all((MODULES/p.name).is_file() and (MODULES/p.name).read_bytes()==p.read_bytes()
                        for p in dest.glob('*.py')),'Installed pilot source differs; stop before overwrite')
    finally: shutil.rmtree(temp)
    sys.path.insert(0,str(MODULES))

def check_route(config,host,port,upstream):
    key=f'{host}:{port}'
    return (config.get('Web',{}).get(key,{}).get('Handlers')==
            {'/':{'Proxy':f'http://127.0.0.1:{upstream}'}} and
            config.get('TCP',{}).get(str(port),{}).get('HTTPS') is True)

def serve(src):
    import drive_server_v17 as v
    v.OWNER=v.oracle_tailscale_owner()
    require(DB.is_file(),'Missing existing V17 registry')
    # V17's startup recovery marks interrupted imports failed. Never run that
    # recovery on the live registry from a second process. Snapshot metadata only.
    pilot_db=WORK/'owner-books.sqlite3'
    if not pilot_db.exists():
        tmp=WORK/'owner-books.partial'
        with sqlite3.connect(DB.as_uri()+'?mode=ro',uri=True) as source, sqlite3.connect(tmp) as target:
            source.backup(target)
        tmp.replace(pilot_db)
    registry=v.Registry(pilot_db)
    class LiveLedger:
        def db(self):
            db=sqlite3.connect(DB.as_uri()+'?mode=rw',uri=True,timeout=10)
            db.row_factory=sqlite3.Row
            return db
    budget=v.Budget(LiveLedger())
    try:
        config=v.private_config()
    except Exception:
        raise RuntimeError('V17_SERVICE_DRIVE_CONFIG_INVALID') from None
    provider=v.Provider(config,budget)
    from drive_receipt import load_receipt_inventory
    inv=load_receipt_inventory(provider,PILOT)
    old=registry.get(SLUG)
    if not old or old['state'] not in ('verified','ready'):
        q=budget.snapshot()
        need=inv['totalBytes']+inv['partCount']*1048576
        require(need<=min(q['dailyLimit']-q['dailyUsed'],q['rollingLimit']-q['rollingUsed']),'V17 transfer budget exhausted')
    slug,created=registry.reserve_group(inv)
    require(slug==SLUG,'Unexpected book identity')
    if created: v.BookImporter(registry,provider).verify_group(slug,inv)
    row=registry.get(slug)
    require(row and row['state'] in ('verified','ready'),'V17 verification incomplete; no route opened')
    doc=json.loads(row['document'])
    require(doc['inventoryFingerprint']==inv['fingerprint'] and len(doc['parts'])==len(PILOT['files']),'Stored inventory mismatch')
    pins={pin['id']:pin for pin in PILOT['files']}
    for p in doc['parts']:
        ed=v.VerifiedEdition(**p['edition'])
        require(ed.sha256==pins[ed.drive_file_id]['sha256'],'Verified audio differs from backup')
        provider.inspect(ed)
    if row['state']=='verified': registry.confirm(slug)
    template=(src/'private-drive-stage/drive-false.html').read_text()
    app=v.App(registry,provider,template)
    class Owner(v.handler(app)):
        def route(self):
            path=urlsplit(self.path).path
            if not self.allowed(): return self.send(403,{'error':'private'})
            if self.command not in ('GET','HEAD') or not (path==BOOK or path=='/drive-private/books/'+SLUG+'/info'
                or path in [PART.format(i) for i in range(1,len(PILOT['files'])+1)]): return self.send(404,{'error':'pilot only'})
            return super().route()
        do_GET=do_HEAD=do_POST=route
    server=ThreadingHTTPServer(('127.0.0.1',0),Owner)
    (WORK/'port').write_text(str(server.server_port))
    (WORK/'ready-row.json').write_text(json.dumps(dict(registry.get(slug))))
    (WORK/'archive-receipt.json').write_text(json.dumps({'audio_book_id':PILOT['id'],
        'files':[{'id':x['id'],'name':x['name'],'bytes':int(x['size']),'md5':x['md5Checksum']} for x in inv['parts']]}))
    server.serve_forever()

def show_ready(link):
    row=json.loads((WORK/'ready-row.json').read_text())
    doc=json.loads(row['document'])
    seconds=max(0,int(doc['parts'][0]['info']['durationSeconds'])-5)
    print('OWNER READY',link,flush=True)
    print(f'Teilwechsel in Safari: auf {seconds//3600:d}:{seconds//60%60:02d}:{seconds%60:02d} springen und weiterhören.')
    print('Danach ein späteres Kapitel wählen, pausieren, erneut öffnen und die Hörposition vergleichen.')

def activate():
    require(os.geteuid()!=0 and DB.is_file(),'Use the existing ajk-tts-ci ShellFish connection')
    WORK.mkdir(mode=0o700,exist_ok=True)
    lock=(WORK/'activate.lock').open('a')
    fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
    src=find_live()
    require((src/'private-drive-stage/drive-false.html').is_file(),'Existing V17 player template missing')
    sys.path.insert(0,str(src))
    from drive_server_v17 import oracle_tailscale_owner
    label=__import__('urllib.parse',fromlist=['quote']).quote(PILOT['title'])
    # A successful search requires a Drive API call in the running V17 process.
    try:
        live_status=probe(8802,'/drive-import/folders?q='+label,oracle_tailscale_owner())
    except (OSError,http.client.HTTPException):
        live_status='UNAVAILABLE'
    print('RUNNING_V17_DRIVE_SEARCH_HTTP',live_status,flush=True)
    # Run the patched pilot in a fresh child interpreter; the parent uses the live module.
    prepare(src)
    import drive_server_v17 as v
    owner=v.oracle_tailscale_owner()
    host=ts_json('status','--json')['Self']['DNSName'].rstrip('.')
    require(host=='ajk-audiobook-private.tail3f4289.ts.net','Wrong Tailnet host')
    before=ts_json('serve','status','--json')
    require(not any(before.get('AllowFunnel',{}).values()) and check_route(before,host,10001,8802),'Existing private route mismatch')
    require(probe(8802,'/drive-library',owner)==200 and probe(8802,'/drive-library')==403,'Existing owner authorization failed')
    link=f'https://{host}:{PORT}{BOOK}'
    if str(PORT) in before.get('TCP',{}) or f'{host}:{PORT}' in before.get('Web',{}):
        port=int((WORK/'port').read_text())
        require(check_route(before,host,PORT,port) and probe(port,BOOK)==403 and probe(port,BOOK,owner)==200,'Pilot port occupied')
        probe(port,PART.format(1),owner,True)
        show_ready(link);return
    portfile=WORK/'port'
    if portfile.exists():
        try:
            oldport=int(portfile.read_text())
            occupied=probe(oldport,BOOK)==403
        except (OSError,ValueError): occupied=False
        require(not occupied,'Unrouted pilot already running; inspect owner.pid before restarting')
        portfile.unlink()
    log=(WORK/'owner.log').open('ab')
    log_start=log.tell()
    child=subprocess.Popen([sys.executable,'-B',str(Path(__file__).resolve()),'serve',str(src)],
        stdin=subprocess.DEVNULL,stdout=log,stderr=log,start_new_session=True)
    added=False
    try:
        for _ in range(1800):
            if child.poll() is not None:
                import re
                with (WORK/'owner.log').open('rb') as handle:
                    handle.seek(log_start)
                    errors=re.findall(rb'RuntimeError: (V17_[A-Z0-9_]+)',handle.read()[-8192:])
                raise RuntimeError(errors[-1].decode() if errors else 'Registration stopped; see private owner.log')
            if portfile.exists() and portfile.stat().st_size: break
            time.sleep(1)
        require(portfile.exists(),'Registration timed out')
        port=int(portfile.read_text())
        require(probe(port,BOOK)==403 and probe(port,BOOK,owner)==200,'Pilot authorization failed')
        for i in range(1,min(2,len(PILOT['files']))+1): probe(port,PART.format(i),owner,True)
        subprocess.run(TS+['serve','--bg','--yes',f'--https={PORT}',f'http://127.0.0.1:{port}'],timeout=30,check=True)
        added=True
        after=ts_json('serve','status','--json')
        require(check_route(after,host,PORT,port) and not any(after.get('AllowFunnel',{}).values()),'Pilot route verification failed')
        for category in ('Web','TCP'):
            current=dict(after.get(category,{}));current.pop(f'{host}:{PORT}' if category=='Web' else str(PORT),None)
            require(current==before.get(category,{}),'Unexpected Serve route change')
        (WORK/'owner.pid').write_text(str(child.pid))
        show_ready(link)
    except BaseException:
        if added: subprocess.run(TS+['serve',f'--https={PORT}','off'],timeout=15)
        child.terminate()
        raise

if __name__=='__main__':
    os.umask(0o077)
    if sys.argv[1:2]==['serve']:
        sys.path.insert(0,str(MODULES));serve(Path(sys.argv[2]))
    else: activate()
