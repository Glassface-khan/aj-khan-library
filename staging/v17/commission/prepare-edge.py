"""Build the isolated pilot from the existing authenticated library handler."""
from pathlib import Path
import shutil
import sys

source = Path(__file__).resolve().parents[2] / 'supabase/audio-library'
target = Path(sys.argv[1])
target.mkdir(parents=True, exist_ok=True)
for name in ('index.ts','download_helpers.ts','guest-m4b.mjs','m4b-source.mjs'):
    shutil.copyfile(source / name, target / name)
index = target / 'index.ts'
code = index.read_text().replace('Deno.env.get("V17_', 'Deno.env.get("PILOT_V17_')
anchor = '  const op = String(body?.op || body?.action || "");'
if code.count(anchor) != 1:
    raise SystemExit('Unexpected audio-library entry point')
index.write_text(code.replace(anchor, anchor + '''
  // The pilot must not issue legacy MP3 URLs or enqueue exports.
  if (!["catalog","m4bSource","m4bPart","saveProgress","save-progress"].includes(op))
    return json({ok:false,error:"pilot_operation_unavailable"},404);
  if (!Object.keys(m4bEditions).length)
    return json({ok:false,error:"pilot_not_configured"},503);
'''))
