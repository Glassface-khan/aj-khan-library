#!/usr/bin/env python3
"""One-off, READ-ONLY verification of AJK Cloudflare pilot resources.
Designed for execution only on the trusted default GitHub branch.
Never print the token, account owner, IDs, provider responses, or credentials.
"""
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request

BASE = "https://api.cloudflare.com/client/v4"
BUCKET = "ajk-private-audiobooks-v2-test"
DATABASE = "ajk-audiobook-v2-test"

class ApiError(Exception):
    def __init__(self, status):
        self.status = status
        super().__init__("HTTP " + str(status))

def api(path, token):
    # Restrict every network request to a fixed Cloudflare API hostname.
    if not (path.startswith("/user/tokens/verify") or
            path.startswith("/accounts") and not any(s in path.lower() for s in ("..", "%2f"))):
        raise RuntimeError("Invalid read-only path")
    req=urllib.request.Request(BASE + path, headers={
        "Authorization": "Bearer " + token,
        "Accept": "application/json", "User-Agent": "AJK-v2-readonly-connectivity-check"})
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            result = json.load(resp)
    except urllib.error.HTTPError as err:
        raise ApiError(err.code) from None
    except Exception:
        raise RuntimeError("Cloudflare request failed") from None
    if not isinstance(result,dict) or result.get("success") is not True:
        raise RuntimeError("Cloudflare API returned an unsuccessful response")
    return result["result"]

def main():
    secret = os.environ.get("AJK_CLOUDFLARE_READONLY_TOKEN", "").strip()
    if not secret:
        print("SECRET_STATUS=MISSING")
        return 2
    print("SECRET_STATUS=PRESENT")
    try:
        record=api("/user/tokens/verify", secret)
    except ApiError as err:
        print("TOKEN_STATUS=CHECK_FAILED_HTTP_" + str(err.status))
        return 3
    except Exception:
        print("TOKEN_STATUS=CHECK_UNAVAILABLE")
        return 3
    if not isinstance(record,dict) or record.get("status")!="active":
        print("TOKEN_STATUS=NOT_ACTIVE")
        return 4
    print("TOKEN_STATUS=ACTIVE")
    account=os.environ.get("AJK_CLOUDFLARE_ACCOUNT_ID", "").strip()
    if account and not re.fullmatch(r"[a-fA-F0-9]{32}",account):
        print("ACCOUNT_STATUS=INVALID_FORMAT")
        return 5
    if not account:
        try:
            accounts=api("/accounts?per_page=50",secret)
            ids=[a.get("id") for a in accounts if
                 isinstance(a,dict) and re.fullmatch(r"[a-fA-F0-9]{32}",str(a.get("id", "")))]
            if len(ids)!=1:
                print("ACCOUNT_STATUS=NEED_ACCOUNT_ID")
                return 6
            account=ids[0]
            print("ACCOUNT_STATUS=AUTO_DISCOVERED")
        except ApiError as err:
            print("ACCOUNT_STATUS=NEED_ACCOUNT_ID")
            print("ACCOUNT_LOOKUP_HTTP=" + str(err.status))
            return 6
        except Exception:
            print("ACCOUNT_STATUS=NEED_ACCOUNT_ID")
            return 6
    else:
        print("ACCOUNT_STATUS=PROVIDED")
    try:
        d1=api(f"/accounts/{account}/d1/database?name={DATABASE}&per_page=10",secret)
        found=[d for d in d1 if isinstance(d,dict) and d.get("name")==DATABASE]
        if len(found)!=1:
            print("D1_STATUS=NOT_FOUND")
            return 7
        print("D1_STATUS=FOUND")
    except ApiError as err:
        print("D1_STATUS=CHECK_FAILED_HTTP_"+str(err.status))
        return 7
    except Exception:
        print("D1_STATUS=CHECK_UNAVAILABLE")
        return 7
    try:
        b=api(f"/accounts/{account}/r2/buckets/{BUCKET}",secret)
        if not isinstance(b,dict) or b.get("name")!=BUCKET:
            print("R2_STATUS=NOT_FOUND")
            return 8
        print("R2_STATUS=FOUND")
    except ApiError as err:
        print("R2_STATUS=CHECK_FAILED_HTTP_"+str(err.status))
        return 8
    except Exception:
        print("R2_STATUS=CHECK_UNAVAILABLE")
        return 8
    print("SUCCESS=READONLY_R2_D1_VERIFIED")
    print("No Cloudflare, Supabase, Google Drive or audiobook files were changed.")
    return 0

if __name__ == "__main__":
    sys.exit(main())
