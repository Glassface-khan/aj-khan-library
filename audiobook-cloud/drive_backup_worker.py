"""Copy only requested private M4B exports to Drive. Never publish or share files."""
import hashlib
import json
import os
import tempfile
import urllib.parse
import urllib.request
from pathlib import Path
from download_worker import api

SCOPE = 'https://www.googleapis.com/auth/drive.file'
BASE = 'https://www.googleapis.com/drive/v3'

class ConnectionRequired(Exception):
    pass

class Drive:
    def __init__(self):
        keys = ['GOOGLE_DRIVE_CLIENT_ID', 'GOOGLE_DRIVE_CLIENT_SECRET', 'GOOGLE_DRIVE_REFRESH_TOKEN']
        if not all(os.environ.get(k) for k in keys):
            raise ConnectionRequired()
        data = urllib.parse.urlencode({
            'client_id': os.environ[keys[0]], 'client_secret': os.environ[keys[1]],
            'refresh_token': os.environ[keys[2]], 'grant_type': 'refresh_token'
        }).encode()
        request = urllib.request.Request('https://oauth2.googleapis.com/token', data=data)
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                result = json.load(response)
        except Exception:
            raise ConnectionRequired() from None
        self.token = result['access_token']
        # Reject credentials with unnecessarily broad Drive permissions.
        if set(result.get('scope', '').split()) != {SCOPE}:
            raise ConnectionRequired()

    def request(self, url, data=None, method=None, headers=None):
        if not url.startswith('https://www.googleapis.com/'):
            raise ValueError('Invalid Drive destination')
        request = urllib.request.Request(url, data=data, method=method, headers={
            'Authorization': 'Bearer ' + self.token, **(headers or {})
        })
        return urllib.request.urlopen(request, timeout=180)

    def json(self, path, body=None, method=None):
        with self.request(BASE + path, json.dumps(body).encode() if body is not None else None,
                          method, {'Content-Type': 'application/json'}) as response:
            return json.load(response)

    def find(self, key, value, parent=None):
        # These keys and values are internal IDs/fingerprints, not user query text.
        def quote(s):
            return str(s).replace('\\', '\\\\').replace("'", "\\'")
        query = "trashed = false and appProperties has { key='"+quote(key)+"' and value='"+quote(value)+"' }"
        if parent:
            query += " and '"+quote(parent)+"' in parents"
        files, page = [], None
        while True:
            params = {'q': query, 'spaces': 'drive', 'fields': 'nextPageToken,files(id,name,size,md5Checksum,mimeType)', 'pageSize': 100}
            if page:
                params['pageToken'] = page
            result = self.json('/files?' + urllib.parse.urlencode(params))
            files.extend(result.get('files', []))
            page = result.get('nextPageToken')
            if not page:
                return files

    def check_private(self, folder_id):
        info = self.json('/files/' + folder_id + '?fields=id,mimeType,trashed')
        if info.get('trashed') or info.get('mimeType') != 'application/vnd.google-apps.folder':
            raise ValueError('Invalid backup folder')
        result = self.json('/files/' + folder_id + '/permissions?fields=permissions(type,role),nextPageToken')
        if result.get('nextPageToken') or any(p.get('type') != 'user' for p in result.get('permissions', [])):
            raise ValueError('Backup folder has broad sharing')

    def folder(self, key, value, name, parent=None):
        found = self.find(key, value, parent)
        folders = [f for f in found if f.get('mimeType') == 'application/vnd.google-apps.folder']
        if len(folders) > 1:
            raise ValueError('Ambiguous backup folder')
        if folders:
            result = folders[0]
        else:
            body = {'name': name, 'mimeType': 'application/vnd.google-apps.folder', 'appProperties': {key: value}}
            if parent:
                body['parents'] = [parent]
            result = self.json('/files?fields=id', body, 'POST')
        self.check_private(result['id'])
        return result['id']

    def upload(self, path, folder_id, key):
        size = path.stat().st_size
        digest = hashlib.md5(path.read_bytes()).hexdigest()
        found = self.find('ajkBackupFile', key, folder_id)
        matching = [f for f in found if int(f.get('size', -1)) == size and f.get('md5Checksum') == digest]
        if matching:
            return {'id': matching[0]['id'], 'name': path.name, 'bytes': size, 'md5': digest}
        # Reuse an incomplete/mismatching file on retry instead of adding another copy.
        if len(found) > 1:
            raise ValueError('Ambiguous backup file')
        body = {'name': path.name, 'appProperties': {'ajkBackupFile': key}}
        url = 'https://www.googleapis.com/upload/drive/v3/files'
        method = 'POST'
        if found:
            url += '/' + found[0]['id']
            method = 'PATCH'
        else:
            body['parents'] = [folder_id]
        url += '?uploadType=resumable&fields=id,size,md5Checksum'
        with self.request(url, json.dumps(body).encode(), method, {
                'Content-Type': 'application/json', 'X-Upload-Content-Type': 'audio/mp4',
                'X-Upload-Content-Length': str(size)}) as response:
            location = response.headers['Location']
        with self.request(location, path.read_bytes(), 'PUT', {'Content-Type': 'audio/mp4'}) as response:
            result = json.load(response)
        if int(result.get('size', -1)) != size or result.get('md5Checksum') != digest:
            raise ValueError('Backup verification failed')
        # Read the completed object's metadata, rather than trusting upload success alone.
        verified = self.json('/files/'+result['id']+'?fields=id,size,md5Checksum')
        if int(verified.get('size', -1)) != size or verified.get('md5Checksum') != digest:
            raise ValueError('Backup verification failed')
        return {'id': result['id'], 'name': path.name, 'bytes': size, 'md5': digest}

def copy_backup(claim, drive):
    job, book = claim['job'], claim['book']
    root = drive.folder('ajkAudioBackupRoot', 'v1', 'Audio')
    edition = job['audio_book_id'] + ':' + job['source_fingerprint']
    name = ' – '.join(str(book.get(k) or '') for k in ['title', 'narrator_name', 'language_code']).strip(' –')
    folder_id = drive.folder('ajkAudioEdition', edition, name, root)
    files = []
    with tempfile.TemporaryDirectory() as tmp:
        for index, source in enumerate(claim['files']):
            path = Path(tmp) / source['name']
            # Sources must be signed links from the known private project.
            prefix = 'https://ipoqyjrojljmbqslmxxf.supabase.co/storage/v1/object/sign/audiobook-downloads/'
            if not source['url'].startswith(prefix):
                raise ValueError('Invalid backup source')
            with urllib.request.urlopen(source['url'], timeout=180) as response, path.open('wb') as out:
                while block := response.read(1024 * 1024):
                    out.write(block)
            if path.stat().st_size != source['bytes']:
                raise ValueError('Source size mismatch')
            files.append(drive.upload(path, folder_id, edition + ':' + source['name']))
            path.unlink()
            api('driveBackupProgress', jobId=job['id'], done=index+1)
    drive.check_private(root)
    drive.check_private(folder_id)
    api('driveBackupFinish', jobId=job['id'], success=True, folderId=folder_id, files=files)


def main():
    # Drain a bounded batch; global workflow concurrency prevents duplicate workers.
    for _ in range(10):
        claim = api('driveBackupClaim')
        if not claim.get('job'):
            return
        try:
            copy_backup(claim, Drive())
        except Exception as exc:
            reason = 'connection_required' if isinstance(exc, ConnectionRequired) else 'failed'
            api('driveBackupFinish', jobId=claim['job']['id'], success=False, reason=reason)
            # Never print tokens, signed URLs, upload-session URLs, or raw HTTP errors.
            print('Private Drive backup: ' + reason, flush=True)
            if reason == 'failed':
                raise RuntimeError('Private backup failed; source audio unchanged') from None

if __name__ == '__main__':
    main()
