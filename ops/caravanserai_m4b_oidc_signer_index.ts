/** CARAVANSERAI ONLY: issue expiring signed URLs to the owner-started GitHub backup.
 * This edge function never writes database rows or modifies source objects.
 * The public endpoint is deny-by-default; ONLY a verified GitHub Actions OIDC
 * token for the exact repository, workflow, branch, trigger and owner can call it.
 */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { createRemoteJWKSet, jwtVerify } from "npm:jose@5";

const AUD = "ajk-caravanserai-m4b-sign-once-v1";
const WF = "Glassface-khan/aj-khan-library/.github/workflows/caravanserai-private-m4b-once.yml@refs/heads/main";
const JOB = "8e27c3f1-897a-4671-b95f-70547a004fe9";
const BOOK = "8de77e34-9dfd-4ef9-ad21-fbe901b24619";
const NAMES = [
  ["m4b-001.m4b", 37310395], ["m4b-002.m4b", 37444721],
  ["m4b-003.m4b", 39925212], ["m4b-004.m4b", 38929494],
  ["m4b-005.m4b", 37993062], ["m4b-006.m4b", 18733474],
] as const;
const H = { "Content-Type": "application/json", "Cache-Control": "no-store" };
const jwks = createRemoteJWKSet(new URL("https://token.actions.githubusercontent.com/.well-known/jwks"));
const denied = () => new Response('{"ok":false}', { status: 403, headers: H });

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response('{"ok":false}', { status: 405, headers: H });
  try {
    const match = /^Bearer\s+([^\s]+)$/i.exec(req.headers.get("Authorization") || "");
    if (!match) throw new Error("no_oidc");
    const { payload } = await jwtVerify(match[1], jwks, {
      issuer: "https://token.actions.githubusercontent.com", audience: AUD,
    });
    if (payload.repository !== "Glassface-khan/aj-khan-library" ||
        String(payload.repository_id) !== "1332010124" ||
        String(payload.actor_id) !== "53508441" ||
        payload.workflow_ref !== WF ||
        payload.ref !== "refs/heads/main" ||
        payload.event_name !== "workflow_dispatch") {
      throw new Error("wrong_oidc_scope");
    }

    const input = await req.json();
    const name = String(input?.name || "");
    const size = Number(input?.bytes);
    if (input?.action !== "sign" || input?.jobId !== JOB ||
        !NAMES.some(([n, bytes]) => n === name && bytes === size)) {
      throw new Error("out_of_scope");
    }

    // Unlike the normal scheduled backup, do NOT turn this inactive book on.
    const url = Deno.env.get("SUPABASE_URL");
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !key) throw new Error("edge_key_unavailable");
    const db = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
    const jobResult = await db.from("audiobook_download_jobs")
      .select("id,audio_book_id,status,files").eq("id", JOB).single();
    const job = jobResult.data;
    if (jobResult.error || !job || job.status !== "ready" || job.audio_book_id !== BOOK ||
        !Array.isArray(job.files)) throw new Error("job_not_ready");
    const declared = job.files.filter((f: any) => f.format === "M4B");
    if (declared.length !== 6) throw new Error("manifest_count");
    for (const [part, bytes] of NAMES) {
      const rows = declared.filter((f: any) =>
        f.name === part && f.path === JOB + "/" + part && Number(f.bytes) === bytes);
      if (rows.length !== 1) throw new Error("manifest_mismatch");
    }
    const bookResult = await db.from("audio_books").select("id,status,is_active").eq("id", BOOK).single();
    if (bookResult.error || bookResult.data?.status !== "ready" ||
        bookResult.data?.is_active !== false) throw new Error("book_state_changed");

    const listed = await db.storage.from("audiobook-downloads").list(JOB, { limit: 100 });
    if (listed.error || !Array.isArray(listed.data)) throw new Error("storage_list_failure");
    for (const [part, bytes] of NAMES) {
      const found = listed.data.filter((f: any) => f.name === part && Number(f.metadata?.size) === bytes);
      if (found.length !== 1) throw new Error("source_size_or_name_changed");
    }

    const signed = await db.storage.from("audiobook-downloads").createSignedUrl(JOB + "/" + name, 600);
    if (signed.error || !signed.data?.signedUrl) throw new Error("signing_failed");
    return new Response(JSON.stringify({
      ok: true, jobId: JOB, name, bytes: size, url: signed.data.signedUrl,
    }), { status: 200, headers: H });
  } catch (_) {
    // Never reveal details, signing URLs, service keys or raw request values.
    return denied();
  }
});
