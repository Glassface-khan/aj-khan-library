#!/usr/bin/env bash
set -euo pipefail
umask 077
here=$(cd -- "$(dirname -- "$0")" && pwd)
root=$(cd "$here/../../.." && pwd)
work="$HOME/ajk-v2-tts/private/legacy-m4b-pilot-d9b78f8"
# Supplied privately by the operator for the EXISTING authorized TLS vhost.
: "${V17_GUEST_ORIGIN:?Existing cost-free guest HTTPS origin required}"
: "${V17_GUEST_PORT:?Reserved loopback port matching the reverse proxy required}"
: "${V17_GUEST_LISTENER:?Existing test listener ID required}"
: "${V17_OWNER_LISTENER_ID:?Existing owner listener ID required}"
GUEST_READY_ROW=${GUEST_READY_ROW:-"$work/ready-row.json"}
GUEST_CATALOG_EDITION=${GUEST_CATALOG_EDITION:-"$here/pilot-edition.json"}
GUEST_DRIVE_RECEIPT=${GUEST_DRIVE_RECEIPT:-"$work/archive-receipt.json"}
export GUEST_CATALOG_EDITION
: "${PILOT_ASSETS_DIR:?Dedicated new staging directory on the existing authenticated author site}"
[[ "${COST_FREE_INGRESS_VERIFIED:-}" == yes && "$V17_GUEST_LISTENER" != '*' && ! -e "$PILOT_ASSETS_DIR" ]]
command -v node >/dev/null; command -v supabase >/dev/null
[[ -d "$work/modules" && -s "$work/ready-row.json" && -s "$work/owner.pid" ]]
python3 - "$V17_GUEST_ORIGIN" "$V17_GUEST_PORT" "$GUEST_CATALOG_EDITION" <<'PY'
from urllib.parse import urlsplit
import sys,json
u=urlsplit(sys.argv[1])
assert u.scheme=='https' and u.hostname and not u.hostname.endswith('.ts.net') and u.path=='' and not (u.query or u.fragment or u.username or u.password)
assert 1024<int(sys.argv[2])<=65535
b=json.load(open(sys.argv[3]))
assert b['is_active'] is True and b['status']=='ready' and b['id']!='8de77e34-9dfd-4ef9-ad21-fbe901b24619'
PY
node "$root/staging/v17/build-edition.mjs" "$work/ready-row.json" "$here/pilot-edition.json" "$work/archive-receipt.json" > "$work/owner-mapping.json"
node "$root/staging/v17/build-edition.mjs" "$GUEST_READY_ROW" "$GUEST_CATALOG_EDITION" "$GUEST_DRIVE_RECEIPT" > "$work/guest-mapping.json"
if [[ ! -f "$work/guest-ticket.key" ]]; then
  python3 - "$work/guest-ticket.key" <<'PY'
import secrets,sys
with open(sys.argv[1],'x') as f: f.write(secrets.token_hex(32))
PY
fi
# Require a free port; never terminate an existing listener.
python3 - "$V17_GUEST_PORT" <<'PY'
import socket,sys
with socket.socket() as s:s.bind(('127.0.0.1',int(sys.argv[1])))
PY
nohup python3 -B "$here/guest.py" > "$work/guest.log" 2>&1 < /dev/null &
pid=$!
trap 'kill "$pid" 2>/dev/null || true' EXIT
for i in {1..10}; do
  kill -0 "$pid" || exit 1
  [[ "$(curl -s --max-time 1 -o /dev/null -w '%{http_code}' "http://127.0.0.1:$V17_GUEST_PORT/guest-m4b/invalid" || true)" == 403 ]] && break
  sleep 1
done
# Probe guest TLS with a real bounded ticket. Never transmit a listener credential.
python3 - "$work" "$GUEST_READY_ROW" "$V17_GUEST_ORIGIN" <<'PY'
import sys,time,json,base64,hmac,hashlib,secrets
from pathlib import Path
from urllib.request import build_opener,HTTPRedirectHandler,Request
from urllib.error import HTTPError
class NoRedirect(HTTPRedirectHandler):
 def redirect_request(self,*args):return None
http=build_opener(NoRedirect())
work=Path(sys.argv[1]); row=json.load(open(sys.argv[2]))
doc=row['document']; doc=json.loads(doc) if isinstance(doc,str) else doc
edition=(doc.get('parts') or [doc])[0]['edition']
claims=['guest-m4b-v1',row['id'],1,edition['sha256'],int(time.time())+60,secrets.token_hex(16)]
payload=base64.urlsafe_b64encode(json.dumps(claims).encode()).decode().rstrip('=')
sig=hmac.new(bytes.fromhex((work/'guest-ticket.key').read_text()),payload.encode(),hashlib.sha256).hexdigest()
base=sys.argv[3]+'/guest-m4b/'
try:
 with http.open(base+'invalid',timeout=10): raise RuntimeError('anonymous access unexpectedly allowed')
except HTTPError as e:
 if e.code!=403: raise RuntimeError('guest ingress unavailable') from None
try:
 with http.open(Request(base+payload+'.'+sig,headers={'Range':'bytes=0-1'}),timeout=15) as r:
  assert r.status==206 and r.headers['Content-Range'].startswith('bytes 0-1/') and r.read(3).__len__()==2
except Exception: raise SystemExit('Guest source failed the two-byte range check')
PY
# Isolated Edge function: prefix its env names to avoid modifying a production config.
stage=$(mktemp -d); trap 'rm -rf "$stage"; kill "$pid" 2>/dev/null || true' EXIT
fn=audio-library-m4b-pilot
mkdir -p "$stage/supabase/functions/$fn"
python3 "$here/prepare-edge.py" "$stage/supabase/functions/$fn"
python3 - "$work" "$stage/secrets" <<'PY'
import os,json,sys
from pathlib import Path
w=Path(sys.argv[1])
values={k:os.environ[k] for k in ('V17_GUEST_ORIGIN','V17_GUEST_LISTENER','V17_OWNER_LISTENER_ID')}
values.update(V17_PRIVATE_ORIGIN='https://ajk-audiobook-private.tail3f4289.ts.net:10003',V17_GUEST_TICKET_KEY=(w/'guest-ticket.key').read_text().strip(),V17_VERIFIED_EDITIONS=json.dumps({**json.loads((w/'owner-mapping.json').read_text()),**json.loads((w/'guest-mapping.json').read_text())},separators=(',',':')))
with open(sys.argv[2],'x') as f:
 for k,v in values.items():
  assert not any(c in v for c in "'\r\n")
  f.write('PILOT_'+k+"='"+v+"'\n")
PY
project=ipoqyjrojljmbqslmxxf
(cd "$stage"; supabase secrets set --project-ref "$project" --env-file secrets >/dev/null; supabase functions deploy "$fn" --project-ref "$project" --no-verify-jwt --use-api)
mkdir "$PILOT_ASSETS_DIR"
sed 's@/functions/v1/audio-library\x27@/functions/v1/audio-library-m4b-pilot\x27@' "$root/audio-library.js" > "$PILOT_ASSETS_DIR/audio-library.js"
cp "$root"/audio-m4b-{playback,timeline}.mjs "$PILOT_ASSETS_DIR/"
cp "$here/pilot.html" "$PILOT_ASSETS_DIR/index.html"
chmod 755 "$PILOT_ASSETS_DIR"; chmod 644 "$PILOT_ASSETS_DIR"/*
printf '%s\n' "$pid" > "$work/guest.pid"
trap - EXIT; rm -rf "$stage"
echo 'Guest ingress responds 403/206. Use the pilot directory on the existing signed-in site for the real listener test.'
