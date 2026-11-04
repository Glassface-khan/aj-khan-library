"""One edition / six files only. No DB writes, original mutation or public sharing."""
import hashlib
import json
import os
import urllib.parse
import urllib.request
from pathlib import Path
from tempfile import TemporaryDirectory

PROJECT = "ipoqyjrojljmbqslmxxf"
JOB = "8e27c3f1-897a-4671-b95f-70547a004fe9"
FOLDER = "1PyURHFMnsHsF6JLMvtbAq20Gl021KFCa"
PARTS = (37310395, 37444721, 39925212, 38929494, 37993062, 18733474)
TOTAL = 210336358
SCOPE = "https://www.googleapis.com/auth/drive.file"
DRIVE = "https://www.googleapis.com/drive/v3"
UPLOAD = "https://www.googleapis.com/upload/drive/v3/files"
SUPABASE = f"https://{PROJECT}.supabase.co"
SIGNER = SUPABASE + "/functions/v1/ajk-caravanserai-m4b-source-once"
OIDC_AUDIENCE = "ajk-caravanserai-m4b-sign-once-v1"
assert len(PARTS) == 6 and sum(PARTS) == TOTAL


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise RuntimeError("unexpected_redirect")


def request(url, *, data=None, headers=None, method=None, timeout=120):
    if not url.startswith("https://"):
        raise RuntimeError("non_https_request")
    req = urllib.request.Request(url, data=data, headers=headers or {}, method=method)
    return urllib.request.build_opener(NoRedirect()).open(req, timeout=timeout)


def as_json(url, *, data=None, headers=None, method=None):
    with request(url, data=data, headers=headers, method=method) as response:
        return json.load(response)


def credentials():
    keys = ("GOOGLE_DRIVE_CLIENT_ID", "GOOGLE_DRIVE_CLIENT_SECRET", "GOOGLE_DRIVE_REFRESH_TOKEN")
    if any(not os.getenv(k) for k in keys):
        raise RuntimeError("missing_drive_oauth")
    oidc_url = os.environ.get("ACTIONS_ID_TOKEN_REQUEST_URL", "")
    oidc_bearer = os.environ.get("ACTIONS_ID_TOKEN_REQUEST_TOKEN", "")
    parsed = urllib.parse.urlparse(oidc_url)
    if (not oidc_bearer or parsed.scheme != "https" or
        not (parsed.hostname or "").endswith(".actions.githubusercontent.com")):
        raise RuntimeError("missing_or_untrusted_github_oidc")
    payload = urllib.parse.urlencode({
        "client_id": os.environ[keys[0]], "client_secret": os.environ[keys[1]],
        "refresh_token": os.environ[keys[2]], "grant_type": "refresh_token",
    }).encode("ascii")
    result = as_json("https://oauth2.googleapis.com/token", data=payload, method="POST",
                     headers={"Content-Type": "application/x-www-form-urlencoded"})
    if set(result.get("scope", "").split()) != {SCOPE}:
        raise RuntimeError("unexpected_oauth_scope")
    sep = "&" if parsed.query else "?"
    oidc_response = as_json(oidc_url + sep + "audience=" + urllib.parse.quote(OIDC_AUDIENCE),
                            headers={"Authorization": "bearer " + oidc_bearer})
    id_token = oidc_response.get("value")
    if not isinstance(id_token, str) or id_token.count(".") != 2:
        raise RuntimeError("bad_oidc_response")
    return result["access_token"], id_token


def google(token, endpoint, payload=None, method=None):
    if not endpoint.startswith("/"):
        raise RuntimeError("invalid_drive_endpoint")
    data = json.dumps(payload).encode() if payload is not None else None
    return as_json(DRIVE + endpoint, data=data, method=method,
                   headers={"Authorization": "Bearer " + token, "Content-Type": "application/json"})


def private(token, file_id, *, folder=False):
    meta = google(token, "/files/" + file_id + "?fields=id,mimeType,trashed,parents")
    if meta.get("id") != file_id or meta.get("trashed"):
        raise RuntimeError("missing_or_trashed_file")
    if folder and meta.get("mimeType") != "application/vnd.google-apps.folder":
        raise RuntimeError("destination_not_folder")
    perms = google(token, "/files/" + file_id + "/permissions?fields=nextPageToken,permissions(type,role)")
    entries = perms.get("permissions", [])
    if perms.get("nextPageToken") or len(entries) != 1 or entries[0] != {"type": "user", "role": "owner"}:
        raise RuntimeError("not_owner_only")
    return meta


def candidates(token, name):
    # Match actual filename and exact parent; never rely solely on appProperties.
    q = "trashed = false and '" + FOLDER + "' in parents and name = '" + name + "'"
    params = urllib.parse.urlencode({"q": q, "fields": "nextPageToken,files(id,name,size,md5Checksum,parents)", "pageSize": 100})
    result = google(token, "/files?" + params)
    if result.get("nextPageToken") or len(result.get("files", [])) > 1:
        raise RuntimeError("ambiguous_target_filename")
    return result.get("files", [])


def get_signed_url(github_oidc, name, size):
    if name not in {f"m4b-{i:03d}.m4b" for i in range(1, 7)}:
        raise RuntimeError("file_outside_six")
    reply = as_json(SIGNER, data=json.dumps({
        "action": "sign", "jobId": JOB, "name": name, "bytes": size,
    }).encode(), method="POST", headers={
        "Authorization": "Bearer " + github_oidc, "Content-Type": "application/json",
    })
    if (reply.get("ok") is not True or reply.get("jobId") != JOB or
            reply.get("name") != name or reply.get("bytes") != size):
        raise RuntimeError("signed_source_manifest_mismatch")
    url = reply.get("url")
    if not isinstance(url, str):
        raise RuntimeError("signed_source_missing")
    parsed = urllib.parse.urlparse(url)
    expected_path = "/storage/v1/object/sign/audiobook-downloads/" + JOB + "/" + name
    if (parsed.scheme != "https" or parsed.hostname != PROJECT + ".supabase.co" or
            parsed.path != expected_path or not parsed.query):
        raise RuntimeError("signed_source_url_outside_scope")
    return url


def get_source(key, name, size, dest):
    url = get_signed_url(key, name, size)
    h = hashlib.sha256()
    md5 = hashlib.md5()
    n = 0
    with request(url, timeout=120) as src, dest.open("wb") as out:
        if getattr(src, "status", 200) != 200:
            raise RuntimeError("source_response_not_200")
        while chunk := src.read(1024 * 1024):
            n += len(chunk)
            if n > size:
                raise RuntimeError("source_oversize")
            h.update(chunk)
            md5.update(chunk)
            out.write(chunk)
    if n != size:
        raise RuntimeError("source_size_mismatch")
    return h.hexdigest(), md5.hexdigest()


def upload(token, name, size, dest):
    body = json.dumps({"name": name, "mimeType": "audio/mp4", "parents": [FOLDER],
                       "appProperties": {"ajkCaravanseraiOnce": JOB}}).encode()
    with request(UPLOAD + "?uploadType=resumable&fields=id,name,size,md5Checksum,parents",
                 data=body, method="POST", headers={"Authorization": "Bearer " + token,
                    "Content-Type": "application/json", "X-Upload-Content-Type": "audio/mp4",
                    "X-Upload-Content-Length": str(size)}) as response:
        session = response.headers.get("Location", "")
    parsed = urllib.parse.urlparse(session)
    if parsed.scheme != "https" or parsed.hostname != "www.googleapis.com" or not parsed.path.startswith("/upload/drive/v3/files"):
        raise RuntimeError("unexpected_upload_session")
    with request(session, data=dest.read_bytes(), method="PUT", timeout=180,
                 headers={"Authorization": "Bearer " + token, "Content-Type": "audio/mp4", "Content-Length": str(size)}) as response:
        result = json.load(response)
    if (result.get("name") != name or int(result.get("size", -1)) != size
            or FOLDER not in result.get("parents", [])):
        raise RuntimeError("upload_metadata_mismatch")
    return result


def readback(token, file_id, name, size, sha, md5):
    meta = google(token, "/files/" + file_id + "?fields=id,name,size,md5Checksum,parents,trashed")
    if (meta.get("id") != file_id or meta.get("name") != name or meta.get("trashed")
            or int(meta.get("size", -1)) != size or meta.get("md5Checksum") != md5
            or FOLDER not in meta.get("parents", [])):
        raise RuntimeError("drive_metadata_mismatch")
    private(token, file_id)
    n = 0
    h = hashlib.sha256()
    with request(DRIVE + "/files/" + file_id + "?alt=media",
                 headers={"Authorization": "Bearer " + token}, timeout=180) as stream:
        while chunk := stream.read(1024 * 1024):
            n += len(chunk)
            if n > size:
                raise RuntimeError("drive_oversize")
            h.update(chunk)
    if n != size or h.hexdigest() != sha:
        raise RuntimeError("drive_sha256_mismatch")
    return {"name": name, "bytes": size, "sha256": sha, "md5": md5, "id": file_id}


def run():
    token, supabase_key = credentials()
    private(token, FOLDER, folder=True)
    completed = []
    with TemporaryDirectory() as directory:
        for index, size in enumerate(PARTS, 1):
            name = f"m4b-{index:03d}.m4b"
            path = Path(directory) / name
            sha, md5 = get_source(supabase_key, name, size, path)
            found = candidates(token, name)
            if found:
                obj = found[0]
                if (obj.get("name") != name or int(obj.get("size", -1)) != size
                        or obj.get("md5Checksum") != md5 or FOLDER not in obj.get("parents", [])):
                    raise RuntimeError("existing_target_conflict_no_overwrite")
                file_id = obj["id"]
            else:
                file_id = upload(token, name, size, path)["id"]
            completed.append(readback(token, file_id, name, size, sha, md5))
            path.unlink()
            print("CARAVANSERAI_PART_PASS", name, size, "sha256=" + sha, flush=True)
    private(token, FOLDER, folder=True)
    if len(completed) != 6 or sum(x["bytes"] for x in completed) != TOTAL:
        raise RuntimeError("incomplete_manifest")
    print("CARAVANSERAI_6_OF_6_PRIVATE_SHA256_PASS bytes=" + str(TOTAL), flush=True)


if __name__ == "__main__":
    try:
        run()
    except Exception:
        # Don't print private HTTP payloads, OAuth tokens, service key, or signed URLs.
        print("CARAVANSERAI_COPY_BLOCKED_NO_DELETE_NO_PUBLIC_SHARE", flush=True)
        raise SystemExit(1)
