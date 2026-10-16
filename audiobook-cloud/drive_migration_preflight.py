"""Non-destructive verification of existing private Google Drive backup OAuth.
Creates/reuses an app-owned private diagnostic folder/file only.
No Supabase access, no manuscript access, no token or Drive content in logs.
"""
import hashlib
import json
import os
import sys
import urllib.parse
import urllib.request
import urllib.error

API = "https://www.googleapis.com/drive/v3"
UPLOAD = "https://www.googleapis.com/upload/drive/v3"
SCOPE = "https://www.googleapis.com/auth/drive.file"
MARKER_KEY = "ajkMigrationPreflight"
MARKER_VALUE = "v1"


def http(url, token=None, data=None, method=None, headers=None):
    h = dict(headers or {})
    if token:
        h["Authorization"] = "Bearer " + token
    req = urllib.request.Request(url, data=data, method=method, headers=h)
    return urllib.request.urlopen(req, timeout=45)


def json_request(url, token, body=None, method=None):
    data = None if body is None else json.dumps(body).encode("utf-8")
    with http(url, token, data, method,
              {"Content-Type": "application/json"}) as response:
        return json.load(response)


def get_token():
    names = ("GOOGLE_DRIVE_CLIENT_ID", "GOOGLE_DRIVE_CLIENT_SECRET",
             "GOOGLE_DRIVE_REFRESH_TOKEN")
    if not all(os.environ.get(x) for x in names):
        raise ValueError("google_oauth_secrets_not_configured")
    data = urllib.parse.urlencode({
        "client_id": os.environ[names[0]],
        "client_secret": os.environ[names[1]],
        "refresh_token": os.environ[names[2]],
        "grant_type": "refresh_token",
    }).encode("utf-8")
    with http("https://oauth2.googleapis.com/token", data=data,
              headers={"Content-Type": "application/x-www-form-urlencoded"}) as r:
        obj = json.load(r)
    if set(obj.get("scope", "").split()) != {SCOPE}:
        raise ValueError("oauth_scope_is_not_drive_file")
    return obj["access_token"]


def main():
    token = get_token()
    q = ("trashed = false and appProperties has { key='"
         + MARKER_KEY + "' and value='" + MARKER_VALUE + "' }")
    params = urllib.parse.urlencode({
        "q": q, "fields": "nextPageToken,files(id,name,mimeType)", "pageSize": 100,
    })
    found = json_request(API + "/files?" + params, token)
    if found.get("nextPageToken"):
        raise ValueError("ambiguous_diagnostic_folder")
    folders = [f for f in found.get("files", [])
               if f.get("mimeType") == "application/vnd.google-apps.folder"]
    if len(folders) > 1:
        raise ValueError("ambiguous_diagnostic_folder")
    if folders:
        folder_id = folders[0]["id"]
    else:
        folder = json_request(API + "/files?fields=id", token, {
            "name": "_AJK_PRIVATE_MIGRATION_PROBE",
            "mimeType": "application/vnd.google-apps.folder",
            "appProperties": {MARKER_KEY: MARKER_VALUE},
        }, "POST")
        folder_id = folder["id"]
    permissions = json_request(
        API + "/files/" + urllib.parse.quote(folder_id)
        + "/permissions?fields=permissions(type,role),nextPageToken", token)
    if permissions.get("nextPageToken") or any(
        p.get("type") != "user" for p in permissions.get("permissions", [])
    ):
        raise ValueError("broad_sharing_not_allowed")
    info = json_request(API + "/files/" + urllib.parse.quote(folder_id)
                        + "?fields=id,trashed,mimeType", token)
    if info.get("trashed") or info.get("mimeType") != "application/vnd.google-apps.folder":
        raise ValueError("invalid_diagnostic_folder")

    payload = b"AJK private audiobook Google Drive migration OAuth preflight v1\n"
    body = {
        "name": "PRIVATE_DRIVE_MIGRATION_PREFLIGHT.txt",
        "parents": [folder_id],
        "appProperties": {"ajkMigrationProbeContent": "v1"},
    }
    with http(UPLOAD + "/files?uploadType=resumable&fields=id,size,md5Checksum",
              token, json.dumps(body).encode("utf-8"), "POST", {
                  "Content-Type": "application/json",
                  "X-Upload-Content-Type": "text/plain",
                  "X-Upload-Content-Length": str(len(payload)),
              }) as response:
        upload_url = response.headers["Location"]
    if not upload_url.startswith("https://www.googleapis.com/"):
        raise ValueError("unexpected_upload_host")
    with http(upload_url, token, payload, "PUT", {
            "Content-Type": "text/plain",
            "Content-Length": str(len(payload))}) as response:
        obj = json.load(response)
    digest = hashlib.md5(payload).hexdigest()
    if str(obj.get("size")) != str(len(payload)) or obj.get("md5Checksum") != digest:
        raise ValueError("upload_checksum_failed")
    fid = urllib.parse.quote(obj["id"])
    metadata = json_request(API + "/files/" + fid
                            + "?fields=id,size,md5Checksum,parents", token)
    if (str(metadata.get("size")) != str(len(payload))
            or metadata.get("md5Checksum") != digest
            or folder_id not in metadata.get("parents", [])):
        raise ValueError("drive_metadata_readback_failed")
    with http(API + "/files/" + fid + "?alt=media", token) as response:
        data = response.read()
    if hashlib.md5(data).hexdigest() != digest:
        raise ValueError("drive_content_readback_failed")
    print("PASS: Drive OAuth refresh, restricted scope, private folder, write and readback verified.")


if __name__ == "__main__":
    try:
        main()
    except urllib.error.HTTPError as e:
        print("FAIL: Google API HTTP status " + str(e.code), flush=True)
        sys.exit(1)
    except Exception as e:
        # Never print token, HTTP request, user-data path or Google response body.
        reason = str(e) if isinstance(e, ValueError) else "preflight_failed"
        print("FAIL: " + reason, flush=True)
        sys.exit(1)
