"""AF3 - one-shot private Cloudflare account / Worker inventory, GET ONLY.

Uses the already validated read-only GitHub Secret. This never writes,
never prints account IDs, token values, script names, app URLs or code.
No Cloudflare deployment, R2 operation, D1 operation, storage writes,
billing changes, or secret transfer.
"""
from __future__ import annotations
import hashlib
import json
import os
import re
import urllib.error
import urllib.parse
import urllib.request

HOST="https://api.cloudflare.com/client/v4"
class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,req,fp,code,msg,hdr,url):return None
opener=urllib.request.build_opener(NoRedirect())

def main():
    token=os.environ.get("AJK_CLOUDFLARE_READONLY_TOKEN","")
    if not token:
        print("AF3_CF_INVENTORY=BLOCKED_MISSING_READONLY_TOKEN")
        return 0
    headers={"Authorization":"Bearer "+token,"Accept":"application/json"}
    def read(path):
        if not (path.startswith("/accounts?") or re.fullmatch(
            r"/accounts/[0-9a-f]{32}/(?:workers/(?:scripts(?:/[A-Za-z0-9_-]{1,120}/settings)?|subdomain|domains)|access/apps|subscriptions)(?:\?per_page=[0-9]+)?",
            path)):
            raise ValueError("Unsafe read path")
        req=urllib.request.Request(HOST+path,headers=headers,method="GET")
        try:
            with opener.open(req,timeout=25) as response:
                if response.status!=200:return None,"BAD_STATUS",[]
                data=json.loads(response.read(250_000))
            if data.get("success") is not True:return None,"API_ERROR",[
                str(e.get("code")) for e in data.get("errors",[])[:4]
                if isinstance(e,dict) and isinstance(e.get("code"),int)]
            return data.get("result"),"OK",[]
        except urllib.error.HTTPError as exc:
            codes=[]
            try:
                body=json.loads(exc.read(8000))
                codes=[str(e.get("code")) for e in body.get("errors",[])[:4]
                       if isinstance(e,dict) and isinstance(e.get("code"),int)]
            except Exception:pass
            return None,"HTTP_"+str(exc.code),codes
        except Exception:return None,"NETWORK_ERROR",[]
    accounts,status,_=read("/accounts?per_page=50")
    print("AF3_CF_ACCOUNT_LIST="+status)
    if status!="OK" or not isinstance(accounts,list) or len(accounts)!=1:
        print("AF3_CF_INVENTORY=BLOCKED_ACCOUNT_AMBIGUOUS_OR_INACCESSIBLE")
        return 0
    account=accounts[0]
    account_id=str(account.get("id",""))
    if not re.fullmatch(r"[0-9a-f]{32}",account_id):
        print("AF3_CF_INVENTORY=BLOCKED_ACCOUNT_ID_INVALID")
        return 0
    print("AF3_CF_ACCOUNT_COUNT=1")
    # These are non-billing descriptors, not a verified Workers subscription.
    print("AF3_CF_ACCOUNT_TYPE="+("standard" if account.get("type")=="standard" else "other_or_unknown"))
    scripts,status,_=read("/accounts/"+account_id+"/workers/scripts")
    print("AF3_CF_WORKERS_LIST="+status)
    if status!="OK" or not isinstance(scripts,list):
        print("AF3_CF_INVENTORY=BLOCKED_WORKERS_UNREADABLE")
        return 0
    print("AF3_CF_WORKER_COUNT="+str(len(scripts)))
    for idx,s in enumerate(scripts[:5],1):
        name=str(s.get("id",""))
        if not re.fullmatch(r"[A-Za-z0-9_-]{1,120}",name):
            print("AF3_CF_WORKER_"+str(idx)+"=UNEXPECTED_NAME_FORMAT")
            continue
        digest=hashlib.sha256(name.encode()).hexdigest()[:12]
        roles=[w for w in ("audiobook","library","migration","backup","private","ajk","af3","pilot")
               if w in name.lower()]
        print("AF3_CF_WORKER_"+str(idx)+"_NAME_SHA12="+digest)
        print("AF3_CF_WORKER_"+str(idx)+"_ROLE_HINT="+(",".join(roles) if roles else "unclassified"))
        print("AF3_CF_WORKER_"+str(idx)+"_LAST_MODIFIED_PRESENT="+str(bool(s.get("modified_on"))).lower())
        print("AF3_CF_WORKER_"+str(idx)+"_WORKERS_DEV="+str(s.get("workers_dev", "not_in_list")))
        settings,st,codes=read("/accounts/"+account_id+"/workers/scripts/"+urllib.parse.quote(name,safe="")+"/settings")
        print("AF3_CF_WORKER_"+str(idx)+"_SETTINGS="+st)
        if st=="OK" and isinstance(settings,dict):
            bindings=settings.get("bindings",[])
            kinds=[str(b.get("type","unknown")) for b in bindings if isinstance(b,dict)]
            print("AF3_CF_WORKER_"+str(idx)+"_BINDINGS="+str(len(kinds)))
            print("AF3_CF_WORKER_"+str(idx)+"_HAS_R2="+str("r2_bucket" in kinds).lower())
            print("AF3_CF_WORKER_"+str(idx)+"_HAS_D1="+str("d1" in kinds).lower())
            print("AF3_CF_WORKER_"+str(idx)+"_HAS_SECRET="+str(any(x in ("secret_text","secret_key") for x in kinds)).lower())
    domains,status,_=read("/accounts/"+account_id+"/workers/domains")
    print("AF3_CF_WORKER_DOMAINS_READ="+status)
    if status=="OK" and isinstance(domains,list):
        print("AF3_CF_WORKER_CUSTOM_DOMAIN_COUNT="+str(len(domains)))
        print("AF3_CF_WORKER_CUSTOM_DOMAIN_ENABLED_COUNT="+str(sum(bool(x.get("enabled")) for x in domains if isinstance(x,dict))))
        known={str(x.get("id")) for x in scripts}
        print("AF3_CF_DOMAIN_POINTS_AT_KNOWN_WORKER="+str(any(str(x.get("service")) in known for x in domains if isinstance(x,dict))).lower())
    subdomain,status,_=read("/accounts/"+account_id+"/workers/subdomain")
    print("AF3_CF_SUBDOMAIN_READ="+status)
    if status=="OK" and isinstance(subdomain,dict):
        print("AF3_CF_SUBDOMAIN_CONFIGURED="+str(bool(subdomain.get("subdomain"))).lower())
    apps,status,codes=read("/accounts/"+account_id+"/access/apps")
    print("AF3_CF_ACCESS_APPS_READ="+status)
    if codes:
        print("AF3_CF_ACCESS_ERROR_CODES="+",".join(codes))
    if status=="OK" and isinstance(apps,list):
        print("AF3_CF_ACCESS_APPS_COUNT="+str(len(apps)))
        print("AF3_CF_ACCESS_SELF_HOSTED_APPS="+str(sum(x.get("type")=="self_hosted" for x in apps if isinstance(x,dict))))
    # Billing Read was not granted. A 403 is expected and is NOT a free-plan proof.
    subs,status,_=read("/accounts/"+account_id+"/subscriptions")
    print("AF3_CF_SUBSCRIPTIONS_READ="+status)
    if status=="OK":
        print("AF3_CF_SUBSCRIPTIONS_COUNT="+str(len(subs) if isinstance(subs,list) else "UNKNOWN"))
        print("AF3_CF_SUBSCRIPTIONS_COST=NOT_ASSERTED")
    else:
        print("AF3_CF_WORKERS_PLAN=UNKNOWN_NEEDS_OWNER_BILLING_VIEW")
    print("AF3_CF_INVENTORY=READ_ONLY_COMPLETE")
    return 0
if __name__=="__main__":
    raise SystemExit(main())
