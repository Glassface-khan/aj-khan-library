"""Verify connector-fetched Drive bytes against locally verified Supabase source bytes."""
import concurrent.futures,hashlib,json,sys,urllib.request
from pathlib import Path
ROOT=Path('/workspace/scratch/4497ba521b50/caravanserai_transfer')
SOURCES={x['name']:x for x in json.loads((ROOT/'source_receipts.json').read_text())}
def one(entry):
    source=SOURCES[entry['name']]
    expected=source['sha256']
    sha=hashlib.sha256();count=0
    with urllib.request.urlopen(entry['url'],timeout=120) as r:
        while block:=r.read(1024*1024):
            count+=len(block)
            assert count<=source['bytes']
            sha.update(block)
    assert count==source['bytes']==entry['bytes'] and sha.hexdigest()==expected
    result={'name':entry['name'],'id':entry['id'],'bytes':count,'sha256':expected}
    (ROOT/(entry['name']+'.verified.json')).write_text(json.dumps(result))
    print('DRIVE_READBACK_PASS '+entry['name'],flush=True)
    return result
if __name__=='__main__':
    entries=json.loads(Path(sys.argv[1]).read_text())
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        list(pool.map(one,entries))
