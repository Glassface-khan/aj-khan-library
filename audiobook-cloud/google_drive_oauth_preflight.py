"""Non-destructive GitHub Actions preflight for AJK's private Google Drive OAuth integration.

Only tests the exact drive.file scope, makes a tiny app-created private test
folder/file, checks upload integrity, and checks visibility of the intended
existing migration folder. Does not read or modify audiobook content.
Never print secrets, tokens, authorization headers, error bodies or Drive IDs.
"""
import hashlib
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request

SCOPE = "https://www.googleapis.com/auth/drive.file"
DRIVE = "https://www.googleapis.com/drive/v3"
UPLOAD = "https://www.googleapis.com/upload/drive/v3"
TARGET_ID = "1Zi1XApHOp1FwzlB-HTHNJZuv4DGP9pvk"
CHECK_KEY = "ajkOAuthPreflight"
CHECK_VALUE = "private-oauth-check-20261012"

def call_json(url, token=None, obj=None, method=None, data=None, content_type="application/json"):
    headers = {}
    if token:
        headers["Authorization"] = "Bearer " + token
    if obj is not None:
        data = json.dumps(obj).encode("utf-8")
    if data is not None:
        headers["Content-Type"] = content_type
    req = urllib.request.Request(url, data=data, method=method, headers=headers)
    with urllib.request.urlopen(req, timeout=40) as rsp:
        payload = rsp.read()
    return json.loads(payload) if payload else {}

def safe_result(message):
    print("AJK_GOOGLE_DRIVE_PREFLIGHT: " + message, flush=True)
    with open(os.environ.get("GITHUB_STEP_SUMMARY", os.devnull), "a", encoding="utf-8") as f:
        f.write("- " + message + "\n")

def main():
    ids = ["GOOGLE_DRIVE_CLIENT_ID", "GOOGLE_DRIVE_CLIENT_SECRET", "GOOGLE_DRIVE_REFRESH_TOKEN"]
    if not all(os.environ.get(k) for k in ids):
        safe_result("MISSING_SECRETS — one or more of the three expected secrets are absent")
        return 2
    safe_result("ALL_THREE_SECRETS_PRESENT")
    body = urllib.parse.urlencode({
        "client_id": os.environ[ids[0]],
        "client_secret": os.environ[ids[1]],
        "refresh_token": os.environ[ids[2]],
        "grant_type": "refresh_token",
    }).encode()
    try:
        response = call_json("https://oauth2.googleapis.com/token", data=body,
                             method="POST", content_type="application/x-www-form-urlencoded")
    except Exception:
        safe_result("OAUTH_REFRESH_FAILED — check OAuth client, token, app publishing status")
        return 3
    token = response.get("access_token")
    if not token:
        safe_result("OAUTH_REFRESH_NO_ACCESS_TOKEN")
        return 4
    safe_result("OAUTH_REFRESH_OK")
    scopes = set(response.get("scope", "").split())
    if scopes != {SCOPE}:
        safe_result("SCOPE_MISMATCH — expected only drive.file; no data access attempted")
        return 5
    safe_result("DRIVE_FILE_SCOPE_EXACT")
    try:
        call_json(DRIVE + "/files?" + urllib.parse.urlencode({
            "pageSize": 1, "fields": "files(id),nextPageToken", "spaces": "drive"
        }), token=token)
    except Exception:
        safe_result("GOOGLE_DRIVE_API_FAILED")
        return 6
    safe_result("GOOGLE_DRIVE_API_READ_OK")

    # Existing folder created through a *different* OAuth client may not be visible
    # to this new drive.file authorization. Test without changing permissions.
    try:
        target = call_json(DRIVE + "/files/" + TARGET_ID
                           + "?fields=id,mimeType,trashed", token=token)
        if target.get("mimeType") == "application/vnd.google-apps.folder" and not target.get("trashed"):
            safe_result("MIGRATION_STAGING_FOLDER_ACCESS_OK")
        else:
            safe_result("MIGRATION_STAGING_FOLDER_UNUSABLE")
    except urllib.error.HTTPError as error:
        if error.code in (403, 404):
            safe_result("MIGRATION_STAGING_FOLDER_NOT_AUTHORIZED — expected for new drive.file client; needs explicit access")
        else:
            safe_result("MIGRATION_STAGING_FOLDER_CHECK_FAILED")
    except Exception:
        safe_result("MIGRATION_STAGING_FOLDER_CHECK_FAILED")

    # Prove a minimal *private* Drive create/upload without touching existing
    # audiobook folders. Reuse the app-created test folder and content on retries.
    query = "trashed = false and appProperties has { key='ajkOAuthPreflight' and value='" + CHECK_VALUE + "' }"
    try:
        results = call_json(DRIVE + "/files?" + urllib.parse.urlencode({
            "q": query, "fields": "files(id,mimeType),nextPageToken",
            "pageSize": 20
        }), token=token)
        folders = [f for f in results.get("files", [])
                   if f.get("mimeType") == "application/vnd.google-apps.folder"]
        if len(folders) > 1:
            safe_result("DUPLICATE_PREFLIGHT_FOLDERS — refusing ambiguous destination")
            return 7
        if folders:
            folder_id = folders[0]["id"]
        else:
            folder = call_json(DRIVE + "/files?fields=id", token=token, method="POST",
                               obj={"name": "AJK PRIVATE — OAuth connection test",
                                    "mimeType": "application/vnd.google-apps.folder",
                                    "appProperties": {CHECK_KEY: CHECK_VALUE}})
            folder_id = folder["id"]
        perm = call_json(DRIVE + "/files/" + folder_id
                         + "/permissions?fields=permissions(type,role),nextPageToken", token=token)
        if perm.get("nextPageToken") or any(p.get("type") not in ("user",)
                                            for p in perm.get("permissions", [])):
            safe_result("PREFLIGHT_FOLDER_NOT_PRIVATE — stopping")
            return 8
        safe_result("PRIVATE_TEST_FOLDER_OK")

        test_bytes = b"AJK private drive.file backup connectivity probe; no manuscript or audiobook.\n"
        digest = hashlib.md5(test_bytes).hexdigest()
        name = "ajk-private-connectivity-check.txt"
        ls = call_json(DRIVE + "/files?" + urllib.parse.urlencode({
            "q": "trashed = false and '" + folder_id + "' in parents and name = '" + name + "'",
            "fields": "files(id,md5Checksum,size),nextPageToken", "pageSize": 10
        }), token=token)
        matches = ls.get("files", [])
        if len(matches) > 1:
            safe_result("DUPLICATE_PREFLIGHT_FILES — stopping")
            return 9
        if matches:
            f = matches[0]
        else:
            boundary = "AJK_SAFE_PREFLIGHT_20261012"
            metadata = json.dumps({"name": name, "parents": [folder_id],
                                   "mimeType": "text/plain"})
            upload_data = (
                ("--" + boundary + "\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n"
                 + metadata + "\r\n--" + boundary + "\r\nContent-Type: text/plain\r\n\r\n").encode()
                + test_bytes + ("\r\n--" + boundary + "--\r\n").encode()
            )
            f = call_json(UPLOAD + "/files?uploadType=multipart&fields=id,size,md5Checksum",
                          token=token, method="POST", data=upload_data,
                          content_type="multipart/related; boundary=" + boundary)
        if int(f.get("size", -1)) != len(test_bytes) or f.get("md5Checksum") != digest:
            safe_result("TEST_UPLOAD_INTEGRITY_FAILED")
            return 10
        verified = call_json(DRIVE + "/files/" + f["id"]
                             + "?fields=id,size,md5Checksum", token=token)
        if int(verified.get("size", -1)) != len(test_bytes) or verified.get("md5Checksum") != digest:
            safe_result("TEST_READBACK_FAILED")
            return 11
        safe_result("PRIVATE_TEST_UPLOAD_AND_MD5_READBACK_OK")
        safe_result("PREFLIGHT_COMPLETE — no audiobook touched or shared")
        return 0
    except Exception:
        safe_result("PRIVATE_TEST_CREATE_OR_UPLOAD_FAILED — see OAuth folder access / Drive quota")
        return 12

if __name__ == "__main__":
    sys.exit(main())
