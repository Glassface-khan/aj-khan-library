"""Verify the configured service grant against only the files in its backup receipt."""
import json
import socket
from urllib.error import HTTPError, URLError

def failure(exc, phase):
    # V17 sanitizes provider exceptions with "from None". Keep the category,
    # never print exception text, response bodies, URLs, IDs, or OAuth values.
    while exc is not None:
        if isinstance(exc, HTTPError):
            if phase == 'REFRESH':
                try:
                    reason=json.loads(exc.read(4096)).get('error')
                except (ValueError,OSError):
                    reason=None
                if reason in ('invalid_grant','invalid_client','unauthorized_client'):
                    return 'V17_OAUTH_'+reason.upper()
            return 'V17_'+phase+'_HTTP_'+str(exc.code)
        if isinstance(exc,(URLError,TimeoutError,socket.timeout)):
            return 'V17_'+phase+'_NETWORK'
        exc=exc.__cause__ or exc.__context__
    return 'V17_'+phase+'_FAILED'

def load_receipt_inventory(provider, receipt):
    from drive_import_v14 import FIELDS,validate_metadata
    from af3_drive_inventory_v17 import group_digest,ordered_parts
    try:
        provider._token()  # existing V17 supplier, in memory only
    except Exception as exc:
        raise RuntimeError(failure(exc,'REFRESH')) from None
    parts=[]
    for pin in sorted(receipt['files'],key=lambda file:file['name']):
        try:
            row=provider.json('files/'+pin['id'],{'fields':FIELDS+',parents'})
        except Exception as exc:
            raise RuntimeError(failure(exc,'FILE_METADATA')) from None
        validate_metadata(row)
        if not (row['id']==pin['id'] and row['name']==pin['name'] and
                row.get('parents')==[receipt['folder_id']] and int(row['size'])==pin['bytes']
                and row['md5Checksum'].lower()==pin['md5'].lower()
                and (not row.get('sha256Checksum') or row['sha256Checksum'].lower()==pin['sha256'].lower())):
            raise RuntimeError('V17_DRIVE_BACKUP_RECEIPT_MISMATCH')
        parts.append(row)
    parts=ordered_parts(parts)
    if not parts or len(set(p['id'] for p in parts))!=len(parts):
        raise RuntimeError('V17_DRIVE_PARTS_AMBIGUOUS')
    print('V17_OAUTH_AND_PRIVATE_FILES_OK',len(parts),flush=True)
    return {'folderId':receipt['folder_id'],'folderName':receipt['title'],'title':receipt['title'],
            'parts':parts,'partCount':len(parts),'totalBytes':sum(int(p['size']) for p in parts),
            'fingerprint':group_digest(parts)}
