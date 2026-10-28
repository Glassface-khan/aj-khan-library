"""One-off fixed CARAVANSERAI MP3 copy. No queues, exports, replacements or deletes."""
import hashlib
import json
import sys
import urllib.parse
from pathlib import Path
from tempfile import TemporaryDirectory
import ajk_private_auto_m4b_backup as transport

FOLDER = '1PyURHFMnsHsF6JLMvtbAq20Gl021KFCa'
PROTECTED = '32_CHAPTER_THIRTY.mp3'
PROTECTED_ID = '1VLhIkIZRzbOMkEW5ikmDcpBQ0DWH-d_2'
PREFIX = '/storage/v1/object/sign/audiobooks/standalone-car/mike-jordan/EN/'
MANIFEST = json.loads(Path(__file__).with_name('caravanserai_mp3_manifest.json').read_text())
transport.AUD = 'ajk-caravanserai-mp3-copy-20261028'
transport.EDGE = 'https://ipoqyjrojljmbqslmxxf.supabase.co/functions/v1/ajk-caravanserai-mp3-copy'

def inventory(token):
    query = urllib.parse.urlencode({'q': "trashed = false and '" + FOLDER + "' in parents", 'fields': 'nextPageToken,files(id,name,size,md5Checksum,version,modifiedTime)', 'pageSize': 100})
    data = transport.google(transport.API + '/files?' + query, token)
    if data.get('nextPageToken'): raise RuntimeError('unexpected_inventory_size')
    found = {}
    for item in data.get('files', []):
        if item['name'] in found: raise RuntimeError('duplicate_name')
        found[item['name']] = item
    return found

def plan(found):
    expected = {x['name']: x for x in MANIFEST}
    if len(expected) != 33 or any(not x.endswith('.mp3') for x in expected): raise RuntimeError('invalid_fixed_manifest')
    if set(found) - set(expected): raise RuntimeError('unexpected_destination_file')
    protected = found.get(PROTECTED, {})
    if protected.get('id') != PROTECTED_ID or int(protected.get('size', -1)) != expected[PROTECTED]['bytes']: raise RuntimeError('protected_file_mismatch')
    for name, item in found.items():
        if int(item.get('size', -1)) != expected[name]['bytes']: raise RuntimeError('existing_size_conflict')
    return [x for x in MANIFEST if x['name'] not in found]

def download(entry, path):
    claim = transport.edge('source', {'name': entry['name']})
    if claim.get('name') != entry['name'] or claim.get('bytes') != entry['bytes']: raise RuntimeError('claim_mismatch')
    url = claim.get('url', '')
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme != 'https' or parsed.netloc != 'ipoqyjrojljmbqslmxxf.supabase.co' or parsed.path != PREFIX + entry['name'] or not parsed.query: raise RuntimeError('source_url_mismatch')
    md5, sha, count = hashlib.md5(), hashlib.sha256(), 0
    with transport.request(url, timeout=120) as response, path.open('wb') as out:
        while block := response.read(1024 * 1024):
            count += len(block)
            if count > entry['bytes']: raise RuntimeError('source_oversize')
            md5.update(block); sha.update(block); out.write(block)
    if count != entry['bytes']: raise RuntimeError('source_size_mismatch')
    if '-' not in entry['etag'] and md5.hexdigest() != entry['etag']: raise RuntimeError('source_md5_mismatch')
    return sha.hexdigest(), md5.hexdigest()

def upload(token, entry, path):
    name = entry['name']
    if name == PROTECTED or entry not in MANIFEST: raise RuntimeError('upload_not_allowed')
    if name in inventory(token): raise RuntimeError('file_appeared_no_overwrite')
    body = {'name': name, 'mimeType': 'audio/mpeg', 'parents': [FOLDER]}
    headers = {'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json', 'X-Upload-Content-Type': 'audio/mpeg', 'X-Upload-Content-Length': str(entry['bytes'])}
    with transport.request(transport.UP + '?uploadType=resumable&fields=id,size,md5Checksum', json.dumps(body).encode(), 'POST', headers, timeout=60) as response:
        session = response.headers['Location']
    parsed = urllib.parse.urlparse(session)
    if parsed.scheme != 'https' or parsed.netloc != 'www.googleapis.com': raise RuntimeError('upload_host')
    with transport.request(session, path.read_bytes(), 'PUT', {'Authorization': 'Bearer ' + token, 'Content-Type': 'audio/mpeg'}, timeout=150) as response:
        result = json.load(response)
    if int(result.get('size', -1)) != entry['bytes'] or result.get('md5Checksum') != hashlib.md5(path.read_bytes()).hexdigest(): raise RuntimeError('upload_integrity')
    return result['id']

def execute():
    token = transport.drive_token()
    transport.is_private(token, FOLDER, True)
    before = inventory(token)
    missing = plan(before)
    print('PREFLIGHT_PASS missing=' + str(len(missing)), flush=True)
    receipts = {}
    uploaded = []
    with TemporaryDirectory() as temp:
        # Verify the existing protected file first, then pilot the smallest missing MP3.
        order = [x for x in MANIFEST if x['name'] == PROTECTED] + sorted(missing, key=lambda x: x['bytes']) + [x for x in MANIFEST if x['name'] in before and x['name'] != PROTECTED]
        for entry in order:
            name = entry['name']; path = Path(temp) / name
            sha, md5 = download(entry, path)
            current = inventory(token)
            plan(current)
            file_id = current[name]['id'] if name in current else upload(token, entry, path)
            receipt = transport.verified(token, FOLDER, file_id, name, entry['bytes'], sha, md5)
            receipts[name] = receipt
            if name not in before:
                uploaded.append(name)
                print('UPLOADED_READBACK_PASS ' + json.dumps(receipt, sort_keys=True), flush=True)
                if len(uploaded) == 1: print('PILOT_PASS full_byte_sha256_readback; batch_gate_open', flush=True)
            else: print('EXISTING_READBACK_PASS ' + name, flush=True)
    after = inventory(token)
    if plan(after) or len(receipts) != 33 or after[PROTECTED] != before[PROTECTED]: raise RuntimeError('final_inventory_or_protected_change')
    transport.is_private(token, FOLDER, True)
    print('FINAL_PASS ' + json.dumps({'uploaded': uploaded, 'uploadedCount': len(uploaded), 'verifiedCount': len(receipts), 'protectedUnchanged': True, 'folderId': FOLDER}), flush=True)

if __name__ == '__main__':
    try: execute()
    except Exception as exc:
        # Never log exception messages containing signed URLs or tokens.
        print('COPY_FAILED_STOPPED_NO_DELETE_NO_OVERWRITE type=' + type(exc).__name__, flush=True)
        sys.exit(1)
