"""One-time owner-authorized cleanup of exactly 225 ZIP exports.
No keys, database changes, file uploads, M4B/MP3 deletes or public links.
The Supabase server stores a private fixed allowlist of exact ZIP paths.
"""
import json
import os
import sys
import urllib.parse
import urllib.request

AUD = "ajk-zip-only-20261105-v1"
EDGE = "https://ipoqyjrojljmbqslmxxf.supabase.co/functions/v1/ajk-zip-only-cleanup-v1"
ORIGINAL_COUNT = 225
ORIGINAL_BYTES = 8981464881
PILOT_COUNT = 5
PILOT_BYTES = 222782050
REST_COUNT = 220
REST_BYTES = ORIGINAL_BYTES - PILOT_BYTES


def oidc():
    source = os.environ["ACTIONS_ID_TOKEN_REQUEST_URL"]
    parsed = urllib.parse.urlparse(source)
    if parsed.scheme != "https" or not (parsed.hostname or "").endswith(".actions.githubusercontent.com"):
        raise RuntimeError("untrusted_oidc_host")
    suffix = "&" if parsed.query else "?"
    req = urllib.request.Request(source + suffix + "audience=" + urllib.parse.quote(AUD),
        headers={"Authorization": "bearer " + os.environ["ACTIONS_ID_TOKEN_REQUEST_TOKEN"]})
    with urllib.request.urlopen(req, timeout=30) as response:
        token = json.load(response)["value"]
    if not isinstance(token, str) or token.count(".") != 2:
        raise RuntimeError("bad_oidc_response")
    return token


def remote(token, op, batch=None):
    payload = {"op": op}
    if batch is not None:
        payload["batch"] = batch
    req = urllib.request.Request(EDGE, data=json.dumps(payload).encode("utf-8"), method="POST",
        headers={"Authorization": "Bearer " + token, "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=150) as response:
        result = json.load(response)
    if result.get("ok") is not True or not isinstance(result, dict):
        raise RuntimeError("remote_rejected")
    return result


def check(token, count, bytecount):
    result = remote(token, "check")
    if (result.get("kind") != "read_only" or result.get("remaining_zip") != count
        or result.get("remaining_bytes") != bytecount
        or not isinstance(result.get("m4bs_in_25_folders"), int)
        or result["m4bs_in_25_folders"] <= 0):
        raise RuntimeError("unexpected_storage_inventory")
    return result["m4bs_in_25_folders"]


def pilot(token):
    m4b_before = check(token, ORIGINAL_COUNT, ORIGINAL_BYTES)
    result = remote(token, "delete", 0)
    if (result.get("kind") != "zip_only" or result.get("batch") != 0
        or result.get("expected") != PILOT_COUNT
        or result.get("removed") != PILOT_COUNT
        or result.get("removed_bytes") != PILOT_BYTES
        or result.get("m4b_guard") != "unchanged"):
        raise RuntimeError("pilot_validation_failed")
    m4b_after = check(token, REST_COUNT, REST_BYTES)
    if m4b_before != m4b_after:
        raise RuntimeError("pilot_m4b_changed")
    print("AF_ZIP_PILOT_PASS removed=5 remaining=220 m4b_unchanged=true", flush=True)


def remaining(token):
    m4b_before = check(token, REST_COUNT, REST_BYTES)
    total = 0
    for n in range(1, 12):
        result = remote(token, "delete", n)
        if (result.get("kind") != "zip_only" or result.get("batch") != n
            or result.get("expected") != 20 or result.get("removed") != 20
            or result.get("m4b_guard") != "unchanged"
            or not isinstance(result.get("removed_bytes"), int)
            or result["removed_bytes"] <= 0):
            raise RuntimeError("batch_validation_failed")
        total += result["removed_bytes"]
        print("AF_ZIP_BATCH_PASS index=" + str(n) + " removed=20", flush=True)
    if total != REST_BYTES:
        raise RuntimeError("removed_byte_count_wrong")
    m4b_after = check(token, 0, 0)
    if m4b_after != m4b_before:
        raise RuntimeError("final_m4b_changed")
    print("AF_ZIP_ALL_REMAINING_PASS removed=220 zip_remaining=0 m4b_unchanged=true", flush=True)


if __name__ == "__main__":
    try:
        if len(sys.argv) != 2 or sys.argv[1] not in ("pilot", "remaining"):
            raise RuntimeError("unknown_phase")
        session = oidc()
        if sys.argv[1] == "pilot":
            pilot(session)
        else:
            remaining(session)
    except Exception:
        # Never echo exception strings, HTTP bodies, private URLs or tokens.
        print("AF_ZIP_DELETE_BLOCKED_NO_M4B_OR_MP3_CHANGE_CLAIM", flush=True)
        raise SystemExit(1)
