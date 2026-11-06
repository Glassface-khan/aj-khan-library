"""Build a portable ShellFish launcher from the checked-in pilot files."""
import base64,hashlib,io,sys,tarfile,textwrap
from pathlib import Path
root=Path(__file__).resolve().parents[3]
stage=root/'staging/v17/commission'
paths=['audio-library.js','audio-m4b-playback.mjs','audio-m4b-timeline.mjs',
       'staging/v17/guest_media.py','staging/v17/build-edition.mjs','staging/v17/numbered-drive-m4b-mp4.patch']
paths+=sorted(str(p.relative_to(root)) for p in (root/'staging/supabase/audio-library').glob('*') if p.is_file())
paths+=sorted(str(p.relative_to(root)) for p in stage.iterdir() if p.is_file() and p.name!='package.py')
out=io.BytesIO()
with tarfile.open(fileobj=out,mode='w:gz') as tar:
    for path in paths:
        data=(root/path).read_bytes()
        info=tarfile.TarInfo(path);info.size=len(data);info.mode=0o600;tar.addfile(info,io.BytesIO(data))
payload=out.getvalue()
digest=hashlib.sha256(payload).hexdigest()
template="""#!/usr/bin/env bash
set -euo pipefail
umask 077
mode=${1:-owner}
case "$mode" in owner|guest|extract) ;; *) echo 'Use owner, guest or extract'; exit 2;; esac
base="$HOME/.local/share/ajk-m4b-commission"
mkdir -p "$base"
tmp=$(mktemp -d "$base/tmp.XXXXXXXX")
trap 'rm -rf -- "$tmp"' EXIT
sed '1,/^__AJK_PAYLOAD__$/d' "$0" | base64 -d > "$tmp/pilot.tgz"
echo 'DIGEST  pilot.tgz' | (cd "$tmp"; sha256sum -c --status)
mkdir "$tmp/files"
tar -xzf "$tmp/pilot.tgz" -C "$tmp/files"
dest="$base/DIGEST"
if [[ ! -d "$dest" ]]; then mv -T "$tmp/files" "$dest"; fi
app="$dest/staging/v17/commission"
case "$mode" in
 extract) echo "$app";;
 owner) python3 -B "$app/owner.py";;
 guest) conf="$HOME/ajk-v2-tts/private/legacy-m4b-pilot-d9b78f8/guest.env"
        [[ -f "$conf" && ! -L "$conf" && -O "$conf" && "$(stat -c %a "$conf")" == 600 ]] || { echo "Private guest configuration missing or unsafe: $conf"; exit 1; }
        set -a; source "$conf"; set +a
        bash "$app/guest-activate.sh";;
esac
exit 0
__AJK_PAYLOAD__
"""
Path(sys.argv[1]).write_text(template.replace('DIGEST',digest)+'\n'.join(textwrap.wrap(base64.b64encode(payload).decode(),76))+'\n')
