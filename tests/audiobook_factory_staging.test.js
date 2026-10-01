const fs=require('fs');
const assert=require('assert');

const html=fs.readFileSync('audiobook-factory.html','utf8');
const edge=fs.readFileSync('staging/supabase/audiobook-factory/index.ts','utf8');
const worker=fs.readFileSync('.github/workflows/audiobook-cloud-worker.yml','utf8');

const m=html.match(/<script>([\s\S]*?)<\/script>/);
assert(m,'factory inline script missing');
new Function(m[1]);

assert(!/\$\('#source'\)\.value\s*=\s*['\"]{2}/.test(m[1]),'DOCX input is cleared after upload');
assert(html.includes('sourceStatus'),'persistent DOCX status missing');
assert(html.includes('matchingExistingJob'),'UI duplicate-job guard missing');
assert(html.includes('JOB ANGELEGT · QC LÄUFT'),'persistent successful job state missing');

assert(edge.includes('DUPLICATE_CREATE_REUSED'),'backend idempotency event missing');
assert(edge.includes('.eq(\"source_file_name\", fileName)'),'backend duplicate filename check missing');
assert(edge.includes('.eq(\"voice_key\", voice.key)'),'backend duplicate voice check missing');
assert(edge.includes('reused: true'),'backend does not return reused marker');

assert(worker.includes('HF_TOKEN: $'+'{{ secrets.HF_TOKEN }}'),'worker is not wired to repository HF_TOKEN secret');
assert(worker.includes('HF_POCKET_TTS_ACCESS=PASS'),'gated model access preflight missing');
assert(worker.includes('hf auth whoami'),'HF token validity preflight missing');

console.log('AUDIOBOOK_STAGING_TESTS=PASS');
