#!/usr/bin/env python3
"""Cloudflare R2/D1 READ-ONLY audit for AJK Audiobook Factory 2.

Uses an API token with *read-only* D1/R2 permissions. It never creates,
deploys, imports, uploads, deletes, or changes Cloudflare resources.
All output deliberately excludes the supplied Cloudflare API token.
"""
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request

EXPECTED_BUCKET = "ajk-private-audiobooks-v2-test"
EXPECTED_DATABASE = "ajk-audiobook-v2-test"
BASE = "https://api.cloudflare.com/client/v4"


def fail(message):
    print("Cloudflare pilot preflight: " + message, file=sys.stderr)
    raise SystemExit(1)


def get_json(path, token):
    if not path.startswith("/accounts/"):
        fail("Unexpected API path refused")
    req = urllib.request.Request(
        BASE + path, headers={"Authorization": "Bearer " + token,
                              "Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            response = json.load(r)
    except urllib.error.HTTPError as ex:
        # Provider error bodies may carry private account/user details; never log them.
        fail(f"Cloudflare API HTTP {ex.code}. Check token permissions and account ID.")
    except Exception:
        fail("Cloudflare API unavailable or returned invalid data")
    if not isinstance(response, dict) or response.get("success") is not True:
        fail("Cloudflare API returned unsuccessful result")
    return response


def main():
    token = os.environ.get("CLOUDFLARE_API_TOKEN", "").strip()
    account = os.environ.get("CLOUDFLARE_ACCOUNT_ID", "").strip()
    if not token:
        fail("CLOUDFLARE_API_TOKEN is not configured in GitHub Secrets")
    if not re.fullmatch(r"[0-9a-fA-F]{32}", account):
        fail("CLOUDFLARE_ACCOUNT_ID missing or not 32 hexadecimal characters")

    # Query directly by name, then verify exact match in the API response.
    db_path = f"/accounts/{account}/d1/database?name={urllib.parse.quote(EXPECTED_DATABASE)}&per_page=10"
    result = get_json(db_path, token).get("result", [])
    found = [x for x in result if isinstance(x, dict) and
             x.get("name") == EXPECTED_DATABASE and
             re.fullmatch(r"[0-9a-fA-F-]{36}", str(x.get("uuid", "")))]
    if len(found) != 1:
        fail("Required D1 test database not found (or ambiguous name)")
    uuid = found[0]["uuid"]

    # A bucket is private by default. This checks *existence*, not public-access status.
    bucket = get_json(
        f"/accounts/{account}/r2/buckets/{urllib.parse.quote(EXPECTED_BUCKET)}",
        token).get("result", {})
    if not isinstance(bucket, dict) or bucket.get("name") != EXPECTED_BUCKET:
        fail("Required R2 test bucket not found")

    print("SUCCESS: Expected D1 database and R2 bucket both exist.")
    print("D1 database:", EXPECTED_DATABASE, "| id:", uuid)
    print("R2 bucket:", EXPECTED_BUCKET)
    print("No changes were made to Cloudflare, GitHub Pages, Supabase or Google Drive.")
    print("NOTE: Verify R2 Public Access = Disabled in its dashboard before deployment.")
    output = os.environ.get("GITHUB_OUTPUT")
    if output:
        with open(output, "a", encoding="utf-8") as fh:
            fh.write(f"d1_database_id={uuid}\n")
            fh.write(f"r2_bucket_name={EXPECTED_BUCKET}\n")


if __name__ == "__main__":
    main()
