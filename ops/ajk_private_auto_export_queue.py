"""Enqueue exactly one verified private M4B export; dispatch existing packager only."""
import json,os,urllib.parse,urllib.request,urllib.error

AUD="ajk-private-auto-export-queue-v1"
EDGE="https://ipoqyjrojljmbqslmxxf.supabase.co/functions/v1/ajk-private-auto-export-queue"
TARGET="https://api.github.com/repos/Glassface-khan/aj-khan-library/actions/workflows/audiobook-download-worker.yml/dispatches"

def req(url,data=None,method=None,headers=None,timeout=50):
    return urllib.request.urlopen(urllib.request.Request(url,data=data,method=method,headers=headers or {}),timeout=timeout)

def main():
    env=os.environ
    u=env["ACTIONS_ID_TOKEN_REQUEST_URL"]+"&audience="+AUD
    with req(u,headers={"Authorization":"bearer "+env["ACTIONS_ID_TOKEN_REQUEST_TOKEN"]},timeout=20) as r:
        jwt=json.load(r)["value"]
    with req(EDGE,data=b"{}",method="POST",headers={"Authorization":"Bearer "+jwt,"Content-Type":"application/json"},timeout=65) as r:
        state=json.load(r)
    if state.get("ok") is not True:raise RuntimeError("private_queue_rejected")
    code=state.get("state")
    print("EXPORT_QUEUE_STATE "+str(code)+" active="+str(state.get("active","n/a"))+" chapters="+str(state.get("chapters","n/a")),flush=True)
    if code in ("diagnostic_eligible","diagnostic_no_eligible"):
        print("EXPORT_DIAGNOSTIC "+code+" NO_JOB_CREATED",flush=True)
        return
    if code!="queued":
        if code not in ("idle","busy","daily_limit","failure_stop","already_queued","pilot_export_not_ready","pilot_backup_not_verified"):
            raise RuntimeError("unknown_queue_state")
        print("EXPORT_QUEUE "+code,flush=True)
        return
    if not state.get("jobId") or not state.get("chapters"):
        raise RuntimeError("invalid_queue_receipt")
    headers={"Authorization":"Bearer "+env["GITHUB_TOKEN"],"Accept":"application/vnd.github+json",
             "Content-Type":"application/json","X-GitHub-Api-Version":"2022-11-28"}
    with req(TARGET,data=b'{"ref":"main"}',method="POST",headers=headers,timeout=30) as r:
        if r.status!=204:raise RuntimeError("worker_dispatch_failed")
    print("EXPORT_QUEUED_AND_WORKER_DISPATCHED chapters="+str(state["chapters"])+" source_bytes="+str(state["bytes"])+" mode="+str(state["mode"]),flush=True)

if __name__=="__main__":
    try:main()
    except Exception:
        print("EXPORT_QUEUE_FAILED_NO_SOURCE_MODIFICATION",flush=True)
        raise SystemExit(1)
