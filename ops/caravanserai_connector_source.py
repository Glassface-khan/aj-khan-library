"""Read-only local source download; credentials and signed URLs never printed."""
import json, sys, urllib.request, hashlib
from pathlib import Path
ROOT=Path('/workspace/scratch/4497ba521b50/caravanserai_transfer/repair')
MANIFEST=json.loads(Path(__file__).with_name('caravanserai_mp3_manifest.json').read_text())
def main():
    name=sys.argv[1]
    entry=next(x for x in MANIFEST if x['name']==name)
    token=Path('/tmp/caravanserai-copy-capability').read_text()
    request=urllib.request.Request('https://ipoqyjrojljmbqslmxxf.supabase.co/functions/v1/ajk-caravanserai-mp3-copy',data=json.dumps({'op':'source','name':name}).encode(),headers={'Authorization':'Bearer '+token,'Content-Type':'application/json'})
    with urllib.request.urlopen(request,timeout=45) as r: claim=json.load(r)
    assert claim['ok'] and claim['name']==name and claim['bytes']==entry['bytes']
    assert claim['url'].startswith('https://ipoqyjrojljmbqslmxxf.supabase.co/storage/v1/object/sign/audiobooks/standalone-car/mike-jordan/EN/'+name+'?')
    ROOT.mkdir(exist_ok=True)
    path=ROOT/name
    sha=hashlib.sha256();md5=hashlib.md5();count=0
    with urllib.request.urlopen(claim['url'],timeout=120) as response,path.open('wb') as out:
        while block:=response.read(1024*1024):
            count+=len(block)
            assert count<=entry['bytes']
            sha.update(block);md5.update(block);out.write(block)
    assert count==entry['bytes']
    assert '-' in entry['etag'] or entry['etag']==md5.hexdigest()
    print(json.dumps({'name':name,'bytes':count,'sha256':sha.hexdigest(),'md5':md5.hexdigest(),'path':str(path)}))
if __name__=='__main__':
    try:main()
    except Exception as exc:
        print('SOURCE_FAILED '+type(exc).__name__+' status='+str(getattr(exc,'code','none')))
        sys.exit(1)
