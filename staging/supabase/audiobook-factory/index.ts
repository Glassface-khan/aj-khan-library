import { downloadSnapshot, downloadFilePath } from "./download_helpers.ts";
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { createRemoteJWKSet, jwtVerify } from "npm:jose@5";

const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbwcbRDaWkM1wf3MV_dj4RPw9jQl2Fgc4YfGcmFrGU1S243yvh8WGW7mbyXLbSeVJKI/exec";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false, autoRefreshToken: false } });

const FACTORY_BUCKET = "audiobook-factory";
const AUDIO_BUCKET = "audiobooks";
const GITHUB_REPO = "Glassface-khan/aj-khan-library";
const GITHUB_REPO_ID = "1332010124";
const ALLOWED_GITHUB_WORKFLOWS = new Set([
  "Glassface-khan/aj-khan-library/.github/workflows/audiobook-download-worker.yml@refs/heads/main",
  "Glassface-khan/aj-khan-library/.github/workflows/audiobook-cloud-worker.yml@refs/heads/main",
  "Glassface-khan/aj-khan-library/.github/workflows/audiobook-queue-watchdog.yml@refs/heads/main",
  "Glassface-khan/aj-khan-library/.github/workflows/john-d-voice-sample.yml@refs/heads/main",
]);
const OIDC_AUDIENCE = "ajk-audiobook-factory";
const JWKS = createRemoteJWKSet(new URL("https://token.actions.githubusercontent.com/.well-known/jwks"));

const VOICES: Record<string, any> = {
  peter_yearsley: { key: "peter_yearsley", name: "Peter Yearsley", languageCode: "EN", ttsLanguage: "english", sourceType: "builtin", source: "peter_yearsley" },
  narration_us_f: { key: "narration_us_f", name: "Maggie", languageCode: "EN", ttsLanguage: "english", sourceType: "url", source: "hf://kyutai/tts-voices/unmute-prod-website/ex04_narration_longform_00001.wav" },
  tommy: { key: "tommy", name: "Tommy", languageCode: "EN", ttsLanguage: "english", sourceType: "asset", source: "voices/tommy.mp3" },
  mike_jordan: { key: "mike_jordan", name: "Mike Jordan", languageCode: "EN", ttsLanguage: "english", sourceType: "asset", source: "voices/mike_jordan.mp3" },
  john_d: { key: "john_d", name: "John D.", languageCode: "EN", ttsLanguage: "english", sourceType: "asset", source: "voices/john_d.wav" },
  arne_b: { key: "arne_b", name: "Arne B.", languageCode: "DE", ttsLanguage: "german_24l", sourceType: "asset", source: "voices/arne_b.wav" }
};

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-ajk-op, x-admin-token, x-factory-session, x-job-id, x-section-index, x-voice-key, x-voice-format",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json; charset=utf-8"
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: cors });
}

function safeName(v: string, fallback = "file") {
  const s = String(v || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "");
  return s || fallback;
}
function slug(v: string) {
  return safeName(String(v || "").toLowerCase().replace(/['’]/g, "")).replace(/_/g, "-").replace(/-+/g, "-");
}
function standaloneSiteBookId(fileName: string) {
  let base = String(fileName || "manuscript").replace(/\.docx$/i, "");
  base = base.replace(/_/g, " ");
  base = base.replace(/\bv\d+(?:[ .-]\d+)*\b/gi, " ");
  base = base.replace(/\b(final|publication|master|candidate|locked|working|complete|consolidated|review)\b/gi, " ");
  base = base.replace(/\b(prologue|epilogue)\b/gi, " ");
  base = base.replace(/\bchapters?\s*\d+(?:\s*[-–]\s*\d+)?\b/gi, " ");
  base = base.replace(/\s+/g, " ").trim();
  const core = slug(base || String(fileName || "manuscript").replace(/\.docx$/i, ""));
  return "standalone_" + (core || "manuscript");
}
function sectionFileName(index: number, title: string) {
  const n = String(index + 1).padStart(2, "0");
  const t = safeName(title || ("SECTION_" + (index + 1))).replace(/\./g, "_").toUpperCase();
  return n + "_" + t + ".mp3";
}

async function ensureFactoryBucket() {
  const { data } = await supabase.storage.listBuckets();
  if ((data || []).some((b: any) => b.id === FACTORY_BUCKET)) return;
  const { error } = await supabase.storage.createBucket(FACTORY_BUCKET, {
    public: false,
    fileSizeLimit: "50MB",
    allowedMimeTypes: [
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/octet-stream",
      "application/json",
      "audio/wav",
      "audio/x-wav",
      "audio/mpeg"
    ]
  });
  if (error && !String(error.message || "").toLowerCase().includes("already")) throw error;
}

const FACTORY_SESSION_TTL_MS = 60 * 60 * 1000;

async function sha256Hex_(value: string) {
  const bytes = new TextEncoder().encode(String(value || ""));
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(digest).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function randomSessionToken_() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function validFactorySession_(sessionToken: string) {
  const token = String(sessionToken || "").trim();
  if (!token) return null;
  const sessionHash = await sha256Hex_(token);
  const now = new Date().toISOString();
  const r = await supabase.from("audiobook_factory_admin_sessions")
    .select("session_hash,admin_token_hash,expires_at")
    .eq("session_hash", sessionHash)
    .gt("expires_at", now)
    .maybeSingle();
  if (r.error) throw r.error;
  if (!r.data) return null;
  await supabase.from("audiobook_factory_admin_sessions")
    .update({ last_used_at: now })
    .eq("session_hash", sessionHash);
  return r.data;
}

async function issueFactorySession_(adminToken: string) {
  const sessionToken = randomSessionToken_();
  const sessionHash = await sha256Hex_(sessionToken);
  const adminTokenHash = await sha256Hex_(adminToken);
  const now = new Date();
  const expires = new Date(now.getTime() + FACTORY_SESSION_TTL_MS).toISOString();
  const r = await supabase.from("audiobook_factory_admin_sessions").upsert({
    session_hash: sessionHash,
    admin_token_hash: adminTokenHash,
    created_at: now.toISOString(),
    expires_at: expires,
    last_used_at: now.toISOString()
  }, { onConflict: "session_hash" });
  if (r.error) throw r.error;
  // Opportunistic cleanup; a cleanup failure must never invalidate a valid session.
  try {
    await supabase.from("audiobook_factory_admin_sessions")
      .delete()
      .lt("expires_at", now.toISOString());
  } catch (_) {}
  return sessionToken;
}

async function cachedAdminToken_(adminTokenHash: string) {
  const now = new Date().toISOString();
  const r = await supabase.from("audiobook_factory_admin_token_cache")
    .select("admin_token_hash,listener_id,admin_name,expires_at")
    .eq("admin_token_hash", adminTokenHash)
    .gt("expires_at", now)
    .maybeSingle();
  if (r.error) throw r.error;
  return r.data || null;
}

async function cacheAdminToken_(adminTokenHash: string, data: any) {
  const now = new Date();
  const expires = new Date(now.getTime() + FACTORY_SESSION_TTL_MS).toISOString();
  const r = await supabase.from("audiobook_factory_admin_token_cache").upsert({
    admin_token_hash: adminTokenHash,
    verified_at: now.toISOString(),
    expires_at: expires,
    listener_id: String(data?.listenerId || "").trim() || null,
    admin_name: String(data?.name || "Admin").trim() || "Admin"
  }, { onConflict: "admin_token_hash" });
  if (r.error) throw r.error;
  // Cleanup is best-effort and must not break a successful admin verification.
  try {
    await supabase.from("audiobook_factory_admin_token_cache")
      .delete()
      .lt("expires_at", now.toISOString());
  } catch (_) {}
}

async function fetchAdminAccess_(token: string) {
  const params = new URLSearchParams({ action: "checkAudioAccess", adminToken: token });
  for (let attempt = 0; attempt < 2; attempt++) {
    let response: Response | null = null;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 7000);
      try {
        response = await fetch(SCRIPT_URL, { method: "POST", body: params, signal: controller.signal });
      } finally {
        clearTimeout(timer);
      }
    } catch (_) {
      response = null;
    }
    if (response && response.ok) {
      const data = await response.json().catch(() => null);
      if (!data || data.ok !== true || data.isAdmin !== true) throw new Error("UNAUTHORIZED");
      return data;
    }
    if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error("ACCESS_SERVICE_UNAVAILABLE");
}

async function verifyAdminToken(adminToken: string, factorySession = "") {
  const session = await validFactorySession_(factorySession);
  if (session) {
    const cached = await cachedAdminToken_(session.admin_token_hash);
    return {
      ok: true,
      isAdmin: true,
      name: cached?.admin_name || "Admin",
      listenerId: cached?.listener_id || "",
      fullAudioAccess: true,
      allowed: true,
      audioAccess: {},
      factorySession: String(factorySession || ""),
      source: "factory_session"
    };
  }

  const token = String(adminToken || "").trim();
  if (!token) throw new Error("UNAUTHORIZED");
  const adminTokenHash = await sha256Hex_(token);

  const cached = await cachedAdminToken_(adminTokenHash);
  if (cached) {
    const sessionToken = await issueFactorySession_(token);
    return {
      ok: true,
      isAdmin: true,
      name: cached.admin_name || "Admin",
      listenerId: cached.listener_id || "",
      fullAudioAccess: true,
      allowed: true,
      audioAccess: {},
      factorySession: sessionToken,
      source: "admin_cache"
    };
  }

  const data = await fetchAdminAccess_(token);
  await cacheAdminToken_(adminTokenHash, data);
  const sessionToken = await issueFactorySession_(token);
  return { ...data, factorySession: sessionToken, source: "apps_script" };
}

async function verifyWorker(req: Request, allowDownloadWorker = false) {
  const auth = req.headers.get("authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  if (!token) throw new Error("WORKER_UNAUTHORIZED");
  const { payload } = await jwtVerify(token, JWKS, {
    issuer: "https://token.actions.githubusercontent.com",
    audience: OIDC_AUDIENCE
  });
  if (String(payload.repository || "") !== GITHUB_REPO) throw new Error("WORKER_UNAUTHORIZED");
  if (String(payload.repository_id || "") !== GITHUB_REPO_ID) throw new Error("WORKER_UNAUTHORIZED");
  if (String(payload.ref || "") !== "refs/heads/main") throw new Error("WORKER_UNAUTHORIZED");
  if (!ALLOWED_GITHUB_WORKFLOWS.has(String(payload.workflow_ref || ""))) throw new Error("WORKER_UNAUTHORIZED");
  if (String(payload.workflow_ref || "") === "Glassface-khan/aj-khan-library/.github/workflows/audiobook-download-worker.yml@refs/heads/main" && !allowDownloadWorker) throw new Error("WORKER_UNAUTHORIZED");
  const ev = String(payload.event_name || "");
  if (!["schedule", "workflow_dispatch", "push"].includes(ev)) throw new Error("WORKER_UNAUTHORIZED");
  return payload;
}

async function logEvent(jobId: string, level: string, code: string, message: string, details: any = {}) {
  await supabase.from("audiobook_factory_events").insert({
    job_id: jobId, level, code, message, details
  });
}

async function getJob(jobId: string) {
  const r = await supabase.from("audiobook_factory_jobs").select("*").eq("id", jobId).maybeSingle();
  if (r.error) throw r.error;
  if (!r.data) throw new Error("JOB_NOT_FOUND");
  return r.data;
}

function seriesMetadataFor(siteBookId: string) {
  const map: Record<string, any> = {
    "b_the_hour_v1_optimization": { series_key: "the_hour", series_title: "THE HOUR", series_number: 1, series_total: 4 },
    "b_the_hour_v2_false_dawn": { series_key: "the_hour", series_title: "THE HOUR", series_number: 2, series_total: 4 },
    "b_the_hour_v3_breaking": { series_key: "the_hour", series_title: "THE HOUR", series_number: 3, series_total: 4 },
    "b_the_hour_v4_door_in_the_west": { series_key: "the_hour", series_title: "THE HOUR", series_number: 4, series_total: 4 },
    "b_covenant_of_light_vol1_the_forgetting_v1": { series_key: "covenant_of_light", series_title: "THE COVENANT OF LIGHT", series_number: 1, series_total: 3 },
    "b_covenant_of_light_vol2_the_search_v1": { series_key: "covenant_of_light", series_title: "THE COVENANT OF LIGHT", series_number: 2, series_total: 3 },
    "b_covenant_of_light_vol3_the_return_v1": { series_key: "covenant_of_light", series_title: "THE COVENANT OF LIGHT", series_number: 3, series_total: 3 },
    "b_die_ordnung_v1": { series_key: "trilogie_der_zugehoerigkeit", series_title: "Die Trilogie der Zugehörigkeit", series_number: 1, series_total: 3 },
    "b_die_rueckfuehrung_v1": { series_key: "trilogie_der_zugehoerigkeit", series_title: "Die Trilogie der Zugehörigkeit", series_number: 2, series_total: 3 },
    "b_das_verlassen_v1": { series_key: "trilogie_der_zugehoerigkeit", series_title: "Die Trilogie der Zugehörigkeit", series_number: 3, series_total: 3 },

    "b_the_drop_v1": { series_key: "the_vessel", series_title: "THE VESSEL", series_number: 1, series_total: 3 },
    "b_the_lamp_keeper_v1": { series_key: "the_vessel", series_title: "THE VESSEL", series_number: 2, series_total: 3 },
    "b_written_in_water_v1": { series_key: "the_vessel", series_title: "THE VESSEL", series_number: 3, series_total: 3 },

    "b_the_proof_holding_v1": { series_key: "the_holding", series_title: "THE HOLDING", series_number: 1, series_total: 3 },
    "b_arche_holding_v2": { series_key: "the_holding", series_title: "THE HOLDING", series_number: 2, series_total: 3 },
    "b_the_glass_ladder_holding_v3": { series_key: "the_holding", series_title: "THE HOLDING", series_number: 3, series_total: 3 }
  };
  return map[String(siteBookId || "").trim()] || {};
}

async function voiceWithAvailability(v: any) {
  if (!v || v.sourceType !== "asset") return { ...v, ready: true };
  await ensureFactoryBucket();
  const base = v.source.replace(/\.(wav|mp3)$/i, "");
  const folder = base.split("/")[0];
  const stem = base.split("/").slice(1).join("/");
  const lr = await supabase.storage.from(FACTORY_BUCKET).list(folder, { search: stem, limit: 20 });
  const names = (lr.data || []).map((x: any) => x.name);
  const wav = stem + ".wav";
  const mp3 = stem + ".mp3";
  const existing = names.includes(wav) ? folder + "/" + wav : (names.includes(mp3) ? folder + "/" + mp3 : null);
  return { ...v, source: existing || v.source, ready: !!existing };
}

async function signedVoice(v: any) {
  if (v.sourceType !== "asset") return { ...v };
  const available = await voiceWithAvailability(v);
  if (!available.ready) throw new Error("VOICE_ASSET_MISSING");
  const sr = await supabase.storage.from(FACTORY_BUCKET).createSignedUrl(available.source, 7200);
  if (sr.error) throw sr.error;
  return { ...available, source: sr.data.signedUrl };
}

async function rawUpload(req: Request, op: string) {
  await ensureFactoryBucket();

  if (op === "upload-source") {
    await verifyAdminToken(req.headers.get("x-admin-token") || "", req.headers.get("x-factory-session") || "");
    const jobId = String(req.headers.get("x-job-id") || "").trim();
    const job = await getJob(jobId);
    if (job.status !== "uploading") throw new Error("JOB_NOT_UPLOADABLE");
    const body = new Uint8Array(await req.arrayBuffer());
    if (!body.length || body.length > 20 * 1024 * 1024) throw new Error("INVALID_SOURCE_SIZE");
    const up = await supabase.storage.from(FACTORY_BUCKET).upload(job.source_object_path, body, {
      contentType: /\.epub$/i.test(job.source_file_name) ? "application/octet-stream" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      upsert: true
    });
    if (up.error) throw up.error;
    const ur = await supabase.from("audiobook_factory_jobs").update({
      status: "queued", stage: "waiting_for_cloud_worker", source_byte_size: body.length, updated_at: new Date().toISOString()
    }).eq("id", jobId);
    if (ur.error) throw ur.error;
    await logEvent(jobId, "info", "SOURCE_UPLOADED", "Source manuscript uploaded and queued.", { bytes: body.length });
    return json({ ok: true, jobId, status: "queued" });
  }

  if (op === "upload-voice") {
    await verifyAdminToken(req.headers.get("x-admin-token") || "", req.headers.get("x-factory-session") || "");
    const key = String(req.headers.get("x-voice-key") || "").trim();
    const v = VOICES[key];
    if (!v || v.sourceType !== "asset") throw new Error("INVALID_VOICE");
    const format = String(req.headers.get("x-voice-format") || "wav").toLowerCase() === "mp3" ? "mp3" : "wav";
    const body = new Uint8Array(await req.arrayBuffer());
    if (!body.length || body.length > 15 * 1024 * 1024) throw new Error("INVALID_VOICE_SIZE");
    const base = v.source.replace(/\.(wav|mp3)$/i, "");
    const targetPath = base + "." + format;
    const up = await supabase.storage.from(FACTORY_BUCKET).upload(targetPath, body, {
      contentType: format === "mp3" ? "audio/mpeg" : "audio/wav", upsert: true
    });
    if (up.error) throw up.error;
    const otherPath = base + (format === "mp3" ? ".wav" : ".mp3");
    try { await supabase.storage.from(FACTORY_BUCKET).remove([otherPath]); } catch (_) {}
    return json({ ok: true, voice: { ...v, source: targetPath, ready: true } });
  }

  if (op === "worker-upload-section") {
    await verifyWorker(req);
    const jobId = String(req.headers.get("x-job-id") || "").trim();
    const sectionIndex = Number(req.headers.get("x-section-index"));
    if (!jobId || !Number.isInteger(sectionIndex) || sectionIndex < 0) throw new Error("INVALID_SECTION");
    const job = await getJob(jobId);
    if (job.status === "cancelled") throw new Error("JOB_CANCELLED");
    const sr = await supabase.from("audiobook_factory_sections")
      .select("id,title,section_index").eq("job_id", jobId).eq("section_index", sectionIndex).maybeSingle();
    if (sr.error) throw sr.error;
    if (!sr.data) throw new Error("SECTION_NOT_FOUND");
    // Storage paths must be unique per exact website book and narrator edition.
    // Never use detected_title as the primary path key: series volumes can share
    // the same front-title (e.g. THE HOUR) and would overwrite one another.
    const bookSlug = slug(job.site_book_id || job.requested_title || job.detected_title || job.source_file_name.replace(/\.docx$/i, ""));
    const voiceSlug = slug(job.voice_key || job.voice_name || "voice");
    const path = bookSlug + "/" + voiceSlug + "/" + job.language_code + "/" + sectionFileName(sectionIndex, sr.data.title);
    const body = new Uint8Array(await req.arrayBuffer());
    if (!body.length || body.length > 50 * 1024 * 1024) throw new Error("INVALID_AUDIO_SIZE");
    const up = await supabase.storage.from(AUDIO_BUCKET).upload(path, body, { contentType: "audio/mpeg", upsert: true });
    if (up.error) throw up.error;
    return json({ ok: true, storagePath: path, byteSize: body.length });
  }

  return json({ ok: false, error: "unknown_raw_operation" }, 400);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  const rawOp = String(req.headers.get("x-ajk-op") || "").trim();
  if (rawOp) {
    try { return await rawUpload(req, rawOp); }
    catch (err: any) {
      const c = String(err?.message || "");
      if (c === "UNAUTHORIZED") return json({ ok: false, error: "unauthorized" }, 401);
      if (c === "WORKER_UNAUTHORIZED") return json({ ok: false, error: "worker_unauthorized" }, 401);
      return json({ ok: false, error: c || "upload_failed" }, 400);
    }
  }

  let body: any = {};
  try { body = await req.json(); } catch { return json({ ok: false, error: "invalid_json" }, 400); }
  const op = String(body?.op || "").trim();

  try {
    if (["downloadWorkerClaim","downloadWorkerProgress","downloadWorkerUpload","downloadWorkerFinish"].includes(op)){
      const claims=await verifyWorker(req,true);
      if(String(claims.workflow_ref)!=="Glassface-khan/aj-khan-library/.github/workflows/audiobook-download-worker.yml@refs/heads/main")throw new Error("WORKER_UNAUTHORIZED");
      const runId=Number(claims.run_id);
      if(op==="downloadWorkerClaim"){
        await supabase.from("audiobook_download_jobs").update({status:"failed",error_detail:"Worker expired",updated_at:new Date().toISOString()}).eq("status","building").lt("updated_at",new Date(Date.now()-2*60*60*1000).toISOString());
        const queued=await supabase.from("audiobook_download_jobs").select("*").eq("status","queued").order("created_at").limit(1).maybeSingle();
        if(queued.error)throw queued.error;if(!queued.data)return json({ok:true,job:null});
        const claimed=await supabase.from("audiobook_download_jobs").update({status:"building",worker_run_id:runId,updated_at:new Date().toISOString()}).eq("id",queued.data.id).eq("status","queued").select("*").maybeSingle();
        if(claimed.error)throw claimed.error;if(!claimed.data)return json({ok:true,job:null});
        const snapshot=await downloadSnapshot(supabase,claimed.data.audio_book_id);
        if(snapshot.fingerprint!==claimed.data.source_fingerprint){
          await supabase.from("audiobook_download_jobs").update({status:"failed",error_detail:"Edition changed"}).eq("id",claimed.data.id);
          return json({ok:true,job:null});
        }
        const chapters=[];
        for(const ch of snapshot.chapters){
          const link=await supabase.storage.from("audiobooks").createSignedUrl(ch.storage_path,3600);
          if(link.error)throw link.error;chapters.push({...ch,url:link.data.signedUrl});
        }
        return json({ok:true,job:claimed.data,book:snapshot.book,chapters});
      }
      const found=await supabase.from("audiobook_download_jobs").select("*").eq("id",String(body.jobId||"")).eq("status","building").eq("worker_run_id",runId).single();
      if(found.error)throw found.error;const job=found.data;
      if(op==="downloadWorkerProgress"){
        const r=await supabase.from("audiobook_download_jobs").update({progress_done:Math.max(0,Number(body.done)||0),progress_total:Math.max(0,Number(body.total)||0),updated_at:new Date().toISOString()}).eq("id",job.id);
        if(r.error)throw r.error;return json({ok:true});
      }
      if(op==="downloadWorkerUpload"){
        const name=String(body.name||""),path=downloadFilePath(job.id,name);
        const link=await supabase.storage.from("audiobook-downloads").createSignedUploadUrl(path,{upsert:true});
        if(link.error)throw link.error;return json({ok:true,url:link.data.signedUrl,path});
      }
      const snapshot=await downloadSnapshot(supabase,job.audio_book_id);
      const ready=body.success===true&&snapshot.fingerprint===job.source_fingerprint;
      const files=[];
      if(ready){
        if(!Array.isArray(body.files)||!body.files.length)throw new Error("INVALID_DOWNLOAD_FILES");
        for(const file of body.files){
          const path=downloadFilePath(job.id,String(file.name||""));
          // Storage metadata is checked through the Storage API, not the Data API schema.
          const listing=await supabase.storage.from("audiobook-downloads").list(job.id,{search:file.name,limit:100});
          if(listing.error||!(listing.data||[]).some((x:any)=>x.name===file.name))throw new Error("DOWNLOAD_FILE_MISSING");
          files.push({name:file.name,path,format:file.name.endsWith(".zip")?"ZIP":"M4B",bytes:Math.max(0,Number(file.bytes)||0)});
        }
        if(!files.some((x:any)=>x.format==="ZIP")||!files.some((x:any)=>x.format==="M4B"))throw new Error("DOWNLOAD_FORMAT_MISSING");
      }
      const r=await supabase.from("audiobook_download_jobs").update({status:ready?"ready":"failed",files,error_detail:ready?null:"Download packaging failed or edition changed",updated_at:new Date().toISOString()}).eq("id",job.id).eq("worker_run_id",runId);
      if(r.error)throw r.error;return json({ok:true});
    }

    if (op === "adminSession") {
      const admin = await verifyAdminToken(body.adminToken, body.factorySession);
      return json({ ok: true, factorySession: admin.factorySession || String(body.factorySession || "") });
    }

    if (op === "libraryOverview") {
      await verifyAdminToken(body.adminToken, body.factorySession);

      const br = await supabase.from("audio_books")
        .select("id,site_book_id,title,language_code,narrator_name,voice_key,status,is_active,total_duration_seconds,series_key,series_title,series_number,series_total,created_at,updated_at")
        .eq("is_active", true)
        .order("title", { ascending: true });
      if (br.error) throw br.error;

      const audioBooks = br.data || [];
      const ids = audioBooks.map((b: any) => b.id);
      const chapterCounts: Record<string, number> = {};
      if (ids.length) {
        const cr = await supabase.from("audio_chapters")
          .select("audio_book_id")
          .in("audio_book_id", ids);
        if (cr.error) throw cr.error;
        for (const row of (cr.data || [])) {
          const id = String(row.audio_book_id || "");
          chapterCounts[id] = (chapterCounts[id] || 0) + 1;
        }
      }

      return json({
        ok: true,
        books: audioBooks.map((b: any) => ({
          ...b,
          chapter_count: chapterCounts[b.id] || 0
        }))
      });
    }

    if (op === "voices") {
      await verifyAdminToken(body.adminToken, body.factorySession);
      const voices = await Promise.all(Object.values(VOICES).map((v: any) => voiceWithAvailability(v)));
      return json({ ok: true, voices });
    }

    if (op === "workerVoice") {
      await verifyWorker(req);
      const voice = VOICES[String(body.voiceKey || "")];
      if (!voice) return json({ ok: false, error: "invalid_voice" }, 400);
      return json({ ok: true, voice: await signedVoice(voice) });
    }

    if (op === "editionStatus") {
      await verifyAdminToken(body.adminToken, body.factorySession);
      const voice = VOICES[String(body.voiceKey || "")];
      if (!voice) return json({ ok: false, error: "invalid_voice" }, 400);
      const siteBookId = String(body.siteBookId || "").trim();
      if (!siteBookId) return json({ ok: true, exists: false, activeJob: null });
      const existing = await supabase.from("audio_books")
        .select("id,title,narrator_name,voice_key,status,is_active")
        .eq("site_book_id", siteBookId)
        .eq("voice_key", voice.key)
        .maybeSingle();
      if (existing.error) throw existing.error;

      const activeJob = await supabase.from("audiobook_factory_jobs")
        .select("id,requested_title,status,stage,progress_done,progress_total,qc_status,qc_score,created_at")
        .eq("site_book_id", siteBookId)
        .eq("voice_key", voice.key)
        .in("status", ["uploading","queued","preflight","qc_running","production","finalizing","needs_attention","failed"])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (activeJob.error) throw activeJob.error;

      return json({
        ok: true,
        exists: !!existing.data,
        edition: existing.data || null,
        activeJob: activeJob.data || null
      });
    }

    if (op === "createJob") {
      await verifyAdminToken(body.adminToken, body.factorySession);
      await ensureFactoryBucket();
      const voice = VOICES[String(body.voiceKey || "")];
      if (!voice) return json({ ok: false, error: "invalid_voice" }, 400);
      if (String(body.languageCode || "").toUpperCase() !== voice.languageCode) {
        return json({ ok: false, error: "voice_language_mismatch" }, 400);
      }
      const avail = await voiceWithAvailability(voice);
      if (!avail.ready) return json({ ok: false, error: "voice_asset_missing", voice: avail }, 409);

      const fileName = safeName(String(body.fileName || "manuscript.docx"));
      if (!/\.(docx|epub)$/i.test(fileName)) return json({ ok: false, error: "docx_or_epub_required" }, 400);
      const explicitSiteBookId = String(body.siteBookId || "").trim();
      const siteBookId = explicitSiteBookId || standaloneSiteBookId(fileName);
      const standalone = !explicitSiteBookId;

      const existingEdition = await supabase.from("audio_books")
        .select("id,title,narrator_name,voice_key,status,is_active")
        .eq("site_book_id", siteBookId)
        .eq("voice_key", voice.key)
        .maybeSingle();
      if (existingEdition.error) throw existingEdition.error;
      if (existingEdition.data && body.replaceExisting !== true) {
        return json({ ok: false, error: "edition_exists", edition: existingEdition.data, standalone }, 409);
      }

      const existingActiveJob = await supabase.from("audiobook_factory_jobs")
        .select("id,requested_title,status,stage,created_at")
        .eq("site_book_id", siteBookId)
        .eq("voice_key", voice.key)
        .in("status", ["uploading","queued","preflight","qc_running","production","finalizing","needs_attention","failed"])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (existingActiveJob.error) throw existingActiveJob.error;
      if (existingActiveJob.data) {
        return json({ ok: false, error: "edition_job_exists", job: existingActiveJob.data, standalone }, 409);
      }

      // Idempotency guard: repeated taps / frontend reloads must not create
      // another job for the same manuscript + site book + language + voice
      // while an earlier job is still actionable.
      const requestedTitle = standalone ? null : (String(body.title || "").trim() || null);
      let existingQuery = supabase.from("audiobook_factory_jobs")
        .select("id,status,stage,source_file_name,site_book_id,language_code,voice_key,error_code,created_at")
        .eq("source_file_name", fileName)
        .eq("language_code", voice.languageCode)
        .eq("voice_key", voice.key)
        .in("status", ["uploading","queued","preflight","qc_running","qc_passed","production","finalizing","needs_attention","failed"])
        .order("created_at", { ascending: false })
        .limit(1);
      existingQuery = siteBookId ? existingQuery.eq("site_book_id", siteBookId) : existingQuery.is("site_book_id", null);
      const existingJob = await existingQuery.maybeSingle();
      if (existingJob.error) throw existingJob.error;
      const deterministicSourceError = existingJob.data &&
        ["SOURCE_TITLE_MISMATCH","SOURCE_STRUCTURE_MISMATCH"].includes(String(existingJob.data.error_code || ""));
      if (existingJob.data && !deterministicSourceError) {
        await logEvent(existingJob.data.id, "warning", "DUPLICATE_CREATE_REUSED",
          "Repeated createJob request reused the existing factory job.",
          { sourceFileName: fileName, siteBookId, voiceKey: voice.key, languageCode: voice.languageCode });
        return json({
          ok: true,
          jobId: existingJob.data.id,
          status: existingJob.data.status,
          stage: existingJob.data.stage,
          reused: true
        });
      }

      const jobId = crypto.randomUUID();
      const sourcePath = "sources/" + jobId + "/" + fileName;
      const ins = await supabase.from("audiobook_factory_jobs").insert({
        id: jobId,
        source_file_name: fileName,
        source_object_path: sourcePath,
        requested_title: requestedTitle,
        site_book_id: siteBookId,
        cover_url: String(body.coverUrl || "").trim() || null,
        language_code: voice.languageCode,
        voice_key: voice.key,
        voice_name: voice.name,
        publish_automatically: body.publishAutomatically !== false,
        status: "uploading",
        stage: "source_upload"
      });
      if (ins.error) throw ins.error;
      await logEvent(jobId, "info", "JOB_CREATED", "Factory job created.", {
        voice: voice.name,
        siteBookId,
        standalone
      });
      return json({ ok: true, jobId, sourcePath, status: "uploading", siteBookId, standalone });
    }

    if (op === "listJobs") {
      await verifyAdminToken(body.adminToken, body.factorySession);
      const r = await supabase.from("audiobook_factory_jobs")
        .select("id,created_at,updated_at,source_file_name,requested_title,detected_title,site_book_id,language_code,voice_key,voice_name,status,stage,word_count,expected_sections,detected_sections,progress_done,progress_total,qc_status,qc_score,error_code,error_detail,finished_at", { count: "exact" })
        .order("created_at", { ascending: false }).limit(1000);
      if (r.error) throw r.error;
      if ((r.count || 0) > (r.data || []).length) throw new Error("JOB_INVENTORY_INCOMPLETE");
      return json({ ok: true, jobs: r.data || [] });
    }

    if (op === "jobStatus") {
      await verifyAdminToken(body.adminToken, body.factorySession);
      const job = await getJob(String(body.jobId || ""));
      const sr = await supabase.from("audiobook_factory_sections").select("*").eq("job_id", job.id).order("section_index");
      if (sr.error) throw sr.error;
      const er = await supabase.from("audiobook_factory_events").select("*").eq("job_id", job.id).order("created_at", { ascending: false }).limit(30);
      if (er.error) throw er.error;
      return json({ ok: true, job, sections: sr.data || [], events: er.data || [] });
    }

    if (op === "cancelJob") {
      await verifyAdminToken(body.adminToken, body.factorySession);
      const jobId = String(body.jobId || "");
      const r = await supabase.from("audiobook_factory_jobs").update({
        status: "cancelled", stage: "cancelled", updated_at: new Date().toISOString()
      }).eq("id", jobId);
      if (r.error) throw r.error;
      await logEvent(jobId, "warning", "JOB_CANCELLED", "Job cancelled by admin.");
      return json({ ok: true });
    }

    if (op === "retryJob") {
      await verifyAdminToken(body.adminToken, body.factorySession);
      const jobId = String(body.jobId || "");
      const job = await getJob(jobId);
      if (!["needs_attention", "failed"].includes(job.status)) return json({ ok: false, error: "job_not_retryable" }, 409);

      // Deterministic source problems cannot be healed by rerunning the same file.
      // Force a corrected manuscript/book selection instead of burning cloud runs.
      const summary: any = job.qc_summary || {};
      const requested = String(job.requested_title || "").trim();
      const detected = String(job.detected_title || "").trim();
      const titleMismatch = summary.title_pass === false && requested && detected && slug(requested) !== slug(detected);
      if (titleMismatch) {
        return json({
          ok: false,
          error: "source_title_mismatch",
          detail: "The selected website book does not match the manuscript title. Upload the correct DOCX for the selected book."
        }, 409);
      }
      const structureError = String(summary.error || "");
      if (summary.structure === "failed" || /TOC\/body mismatch/i.test(structureError)) {
        return json({
          ok: false,
          error: "source_structure_mismatch",
          detail: structureError || "The manuscript structure must be corrected before retrying."
        }, 409);
      }
      if (String(job.error_code || "") === "SOURCE_LANGUAGE_MISMATCH" ||
          (summary.detected_language && summary.selected_language && summary.detected_language !== summary.selected_language)) {
        return json({
          ok: false,
          error: "source_language_mismatch",
          detail: "The manuscript language does not match the selected audiobook language/voice. Choose the correct language and narrator."
        }, 409);
      }

      if (job.qc_status === "passed") {
        await supabase.from("audiobook_factory_sections").update({
          status: "pending", qc_status: "pending", updated_at: new Date().toISOString()
        }).eq("job_id", jobId).neq("status", "ready");
      }
      const resumeProduction = job.qc_status === "passed";
      const r = await supabase.from("audiobook_factory_jobs").update({
        status: "queued",
        stage: resumeProduction ? "resume_production" : "preflight_retry",
        ...(resumeProduction ? {} : {
          qc_status: "pending",
          qc_score: null,
          qc_summary: {}
        }),
        error_code: null, error_detail: null,
        last_heartbeat_at: null,
        github_run_id: null,
        retry_count: Number(job.retry_count || 0) + 1,
        updated_at: new Date().toISOString()
      }).eq("id", jobId);
      if (r.error) throw r.error;
      await logEvent(jobId, "info", "JOB_REQUEUED", "Job queued for automatic retry.");
      return json({ ok: true });
    }

    if (op === "queueWakeNeeded") {
      // Deliberately returns only one non-sensitive boolean so the lightweight
      // GitHub watchdog can wake the private worker without holding credentials.
      const now = new Date();
      const staleBefore = new Date(now.getTime() - 30 * 60 * 1000).toISOString();

      const active = await supabase.from("audiobook_factory_jobs")
        .select("id,last_heartbeat_at")
        .in("status", ["preflight","qc_running","production","finalizing"]);
      if (active.error) throw active.error;
      const freshActive = (active.data || []).some((j: any) =>
        j.last_heartbeat_at && String(j.last_heartbeat_at) >= staleBefore
      );
      const staleActive = (active.data || []).some((j: any) =>
        !j.last_heartbeat_at || String(j.last_heartbeat_at) < staleBefore
      );

      const queued = await supabase.from("audiobook_factory_jobs")
        .select("id", { count: "exact", head: true })
        .eq("status", "queued");
      if (queued.error) throw queued.error;

      return json({
        ok: true,
        workerNeeded: !freshActive && ((queued.count || 0) > 0 || staleActive)
      });
    }

    if (op === "workerQueueStatus") {
      await verifyWorker(req);
      const now = new Date();
      const staleBefore = new Date(now.getTime() - 30 * 60 * 1000).toISOString();

      const active = await supabase.from("audiobook_factory_jobs")
        .select("id,status,last_heartbeat_at,updated_at")
        .in("status", ["preflight","qc_running","production","finalizing"])
        .order("updated_at", { ascending: true });
      if (active.error) throw active.error;

      const freshActive = (active.data || []).find((j: any) =>
        j.last_heartbeat_at && String(j.last_heartbeat_at) >= staleBefore
      ) || null;
      const staleActive = (active.data || []).find((j: any) =>
        !j.last_heartbeat_at || String(j.last_heartbeat_at) < staleBefore
      ) || null;

      const qr = await supabase.from("audiobook_factory_jobs")
        .select("id,created_at")
        .eq("status", "queued")
        .order("created_at", { ascending: true })
        .limit(1);
      if (qr.error) throw qr.error;
      const queued = (qr.data || [])[0] || null;

      // The watchdog should dispatch only when no healthy worker is already
      // running. This prevents duplicate queue runs while still recovering a
      // manual retry or a stale worker automatically.
      const workerNeeded = !freshActive && (!!queued || !!staleActive);
      return json({
        ok: true,
        workerNeeded,
        hasQueued: !!queued,
        queuedJobId: queued?.id || null,
        hasFreshActive: !!freshActive,
        activeJobId: freshActive?.id || null,
        hasStaleActive: !!staleActive,
        staleJobId: staleActive?.id || null
      });
    }

    if (op === "workerClaim") {
      const claims: any = await verifyWorker(req);
      const now = new Date();
      const staleBefore = new Date(now.getTime() - 30 * 60 * 1000).toISOString();

      let qr = await supabase.from("audiobook_factory_jobs").select("*")
        .eq("status", "queued").order("created_at", { ascending: true }).limit(1);
      if (qr.error) throw qr.error;
      let job = (qr.data || [])[0] || null;

      if (!job) {
        qr = await supabase.from("audiobook_factory_jobs").select("*")
          .in("status", ["preflight", "qc_running", "production"])
          .lt("last_heartbeat_at", staleBefore)
          .order("updated_at", { ascending: true }).limit(1);
        if (qr.error) throw qr.error;
        job = (qr.data || [])[0] || null;
      }

      if (!job) return json({ ok: true, job: null });

      const resumeProduction = job.qc_status === "passed" && Number(job.detected_sections || 0) > 0;
      const nextStatus = resumeProduction ? "production" : "preflight";
      const ur = await supabase.from("audiobook_factory_jobs").update({
        status: nextStatus,
        stage: resumeProduction ? "resume_production" : "preflight",
        github_run_id: Number(claims.run_id || 0) || null,
        last_heartbeat_at: now.toISOString(),
        production_started_at: resumeProduction ? (job.production_started_at || now.toISOString()) : job.production_started_at,
        updated_at: now.toISOString()
      }).eq("id", job.id).in("status", ["queued","preflight","qc_running","production"]).select("*").maybeSingle();
      if (ur.error) throw ur.error;
      if (!ur.data) return json({ ok: true, job: null });

      const source = await supabase.storage.from(FACTORY_BUCKET).createSignedUrl(job.source_object_path, 7200);
      if (source.error) throw source.error;
      const voice = await signedVoice(VOICES[job.voice_key]);
      const aliases = job.site_book_id
        ? await supabase.from("audiobook_title_aliases").select("alias").eq("site_book_id", job.site_book_id)
        : { data: [], error: null };
      if (aliases.error) throw aliases.error;
      const titleAliases = (aliases.data || []).map((x: any) => String(x.alias || "")).filter(Boolean);
      await logEvent(job.id, "info", "WORKER_CLAIMED", "GitHub cloud worker claimed job.", { runId: claims.run_id, resumeProduction });
      return json({ ok: true, job: ur.data, sourceUrl: source.data.signedUrl, voice, resumeProduction, titleAliases });
    }

    if (op === "workerHeartbeat") {
      await verifyWorker(req);
      const jobId = String(body.jobId || "");
      const r = await supabase.from("audiobook_factory_jobs").update({
        last_heartbeat_at: new Date().toISOString(), updated_at: new Date().toISOString()
      }).eq("id", jobId);
      if (r.error) throw r.error;
      return json({ ok: true });
    }

    if (op === "workerPreflightResult") {
      await verifyWorker(req);
      const jobId = String(body.jobId || "");
      const passed = body.qcStatus === "passed";
      const sections = Array.isArray(body.sections) ? body.sections : [];
      const now = new Date().toISOString();

      if (passed && !sections.length) throw new Error("EMPTY_SECTION_MANIFEST");

      const jr = await supabase.from("audiobook_factory_jobs").update({
        detected_title: String(body.detectedTitle || "").trim() || null,
        source_sha256: String(body.sourceSha256 || "").trim() || null,
        word_count: Number(body.wordCount || 0) || null,
        expected_sections: Number(body.expectedSections || 0) || null,
        detected_sections: Number(body.detectedSections || sections.length) || sections.length,
        progress_total: sections.length,
        qc_status: passed ? "passed" : "failed",
        qc_score: Number.isFinite(Number(body.qcScore)) ? Number(body.qcScore) : null,
        qc_summary: body.qcSummary || {},
        status: passed ? "production" : "needs_attention",
        stage: passed ? "production" : "preflight_qc_failed",
        production_started_at: passed ? now : null,
        last_heartbeat_at: now,
        error_code: passed ? null : String(body.errorCode || "PREPRODUCTION_QC_FAILED"),
        error_detail: passed ? null : String(body.errorDetail || "Pre-production quality gate failed."),
        updated_at: now
      }).eq("id", jobId);
      if (jr.error) throw jr.error;

      if (passed) {
        for (const s of sections) {
          const sectionIndex = Number(s.sectionIndex);
          const existingSection = await supabase
            .from("audiobook_factory_sections")
            .select("id,status,qc_status")
            .eq("job_id", jobId)
            .eq("section_index", sectionIndex)
            .maybeSingle();
          if (existingSection.error) throw existingSection.error;

          if (existingSection.data?.status === "ready" && existingSection.data?.qc_status === "passed") {
            const keep = await supabase.from("audiobook_factory_sections").update({
              section_kind: String(s.kind || "chapter"),
              title: String(s.title || ("Section " + (sectionIndex + 1))),
              source_word_count: Number(s.wordCount || 0),
              updated_at: now
            }).eq("id", existingSection.data.id);
            if (keep.error) throw keep.error;
            continue;
          }

          const up = await supabase.from("audiobook_factory_sections").upsert({
            job_id: jobId,
            section_index: sectionIndex,
            section_kind: String(s.kind || "chapter"),
            title: String(s.title || ("Section " + (sectionIndex + 1))),
            source_word_count: Number(s.wordCount || 0),
            status: "pending",
            qc_status: "pending",
            updated_at: now
          }, { onConflict: "job_id,section_index" });
          if (up.error) throw up.error;
        }
      }
      await logEvent(jobId, passed ? "info" : "error", passed ? "PREPRODUCTION_QC_PASSED" : "PREPRODUCTION_QC_FAILED",
        passed ? "Pre-production quality gate passed; full production released." : "Pre-production quality gate blocked production.",
        body.qcSummary || {});
      return json({ ok: true, releasedToProduction: passed });
    }

    if (op === "workerManifest") {
      await verifyWorker(req);
      const jobId = String(body.jobId || "");
      const job = await getJob(jobId);
      const sr = await supabase.from("audiobook_factory_sections")
        .select("section_index,section_kind,title,source_word_count,status,qc_status,final_storage_path")
        .eq("job_id", jobId).order("section_index");
      if (sr.error) throw sr.error;
      const manifestSections = (sr.data || []).filter((s: any) => s.status !== "excluded");
      const source = await supabase.storage.from(FACTORY_BUCKET).createSignedUrl(job.source_object_path, 7200);
      if (source.error) throw source.error;
      const voice = await signedVoice(VOICES[job.voice_key]);
      const aliases = job.site_book_id
        ? await supabase.from("audiobook_title_aliases").select("alias").eq("site_book_id", job.site_book_id)
        : { data: [], error: null };
      if (aliases.error) throw aliases.error;
      const titleAliases = (aliases.data || []).map((x: any) => String(x.alias || "")).filter(Boolean);
      return json({ ok: true, job, sections: manifestSections, sourceUrl: source.data.signedUrl, voice, titleAliases });
    }

    if (op === "workerSectionStart") {
      await verifyWorker(req);
      const jobId = String(body.jobId || "");
      const idx = Number(body.sectionIndex);
      const current = await supabase.from("audiobook_factory_sections")
        .select("attempt,status").eq("job_id", jobId).eq("section_index", idx).maybeSingle();
      if (current.error) throw current.error;
      if (!current.data) throw new Error("SECTION_NOT_FOUND");
      if (["ready","excluded"].includes(current.data.status)) return json({ ok: true, skip: true });
      const up = await supabase.from("audiobook_factory_sections").update({
        status: "generating", attempt: Number(current.data.attempt || 0) + 1, updated_at: new Date().toISOString()
      }).eq("job_id", jobId).eq("section_index", idx);
      if (up.error) throw up.error;
      await supabase.from("audiobook_factory_jobs").update({
        last_heartbeat_at: new Date().toISOString(), updated_at: new Date().toISOString()
      }).eq("id", jobId);
      return json({ ok: true, skip: false });
    }

    if (op === "workerSectionResult") {
      await verifyWorker(req);
      const jobId = String(body.jobId || "");
      const idx = Number(body.sectionIndex);
      const passed = body.qcStatus === "passed";
      const now = new Date().toISOString();

      const previous = await supabase.from("audiobook_factory_sections")
        .select("status,qc_status,final_storage_path,byte_size,duration_seconds,words_per_minute,transcript_similarity,clipping_ratio,silence_ratio,qc_detail")
        .eq("job_id", jobId).eq("section_index", idx).maybeSingle();
      if (previous.error) throw previous.error;
      const preservePrevious = !passed && !!previous.data?.final_storage_path;

      const ur = await supabase.from("audiobook_factory_sections").update(preservePrevious ? {
        status: "ready",
        qc_status: "passed",
        updated_at: now
      } : {
        status: passed ? "ready" : "needs_attention",
        duration_seconds: Number(body.durationSeconds || 0) || null,
        words_per_minute: Number(body.wordsPerMinute || 0) || null,
        transcript_similarity: Number(body.transcriptSimilarity || 0) || null,
        clipping_ratio: Number(body.clippingRatio || 0) || null,
        silence_ratio: Number(body.silenceRatio || 0) || null,
        qc_status: passed ? "passed" : "failed",
        qc_detail: body.qcDetail || {},
        final_storage_path: passed ? String(body.storagePath || "") : null,
        byte_size: passed ? (Number(body.byteSize || 0) || null) : null,
        updated_at: now
      }).eq("job_id", jobId).eq("section_index", idx);
      if (ur.error) throw ur.error;

      const cr = await supabase.from("audiobook_factory_sections").select("status").eq("job_id", jobId);
      if (cr.error) throw cr.error;
      const effective = (cr.data || []).filter((x: any) => x.status !== "excluded");
      const ready = effective.filter((x: any) => x.status === "ready").length;
      const failed = effective.filter((x: any) => ["needs_attention","failed"].includes(x.status)).length;
      await supabase.from("audiobook_factory_jobs").update({
        progress_done: ready,
        progress_total: effective.length,
        last_heartbeat_at: now,
        updated_at: now,
        ...(failed ? { stage: "production_with_qc_failures" } : {})
      }).eq("id", jobId);
      if (!passed) await logEvent(jobId, "error", "SECTION_QC_FAILED", "Section failed automatic audio QC.", { sectionIndex: idx, qc: body.qcDetail || {} });
      return json({ ok: true, progressDone: ready });
    }

    if (op === "workerFinalize") {
      await verifyWorker(req);
      const jobId = String(body.jobId || "");
      const job = await getJob(jobId);
      const sr = await supabase.from("audiobook_factory_sections").select("*").eq("job_id", jobId).order("section_index");
      if (sr.error) throw sr.error;
      const allSections = sr.data || [];
      const sections = allSections.filter((s: any) => s.status !== "excluded");
      if (!sections.length || sections.some((s: any) => s.status !== "ready" || s.qc_status !== "passed" || !s.final_storage_path)) {
        const incomplete = sections.filter((s: any) => s.status !== "ready" || s.qc_status !== "passed" || !s.final_storage_path);
        const exhausted = incomplete.some((s: any) => Number(s.attempt || 0) >= 3);
        const canAutoRetry = !exhausted && Number(job.retry_count || 0) < Number(job.max_auto_retries || 3);
        if (canAutoRetry) {
          await supabase.from("audiobook_factory_jobs").update({
            status: "queued",
            stage: "auto_retry_queued",
            retry_count: Number(job.retry_count || 0) + 1,
            error_code: null,
            error_detail: null,
            last_heartbeat_at: null,
            updated_at: new Date().toISOString()
          }).eq("id", jobId);
          await logEvent(jobId, "warning", "AUTO_RETRY_QUEUED",
            "One or more sections failed QC or did not finish. A fresh cloud run was queued automatically.",
            { incomplete: incomplete.map((s: any) => ({ index: s.section_index, status: s.status, attempt: s.attempt, qc: s.qc_status })) });
          return json({ ok: true, published: false, status: "queued", autoRetry: true });
        }
        await supabase.from("audiobook_factory_jobs").update({
          status: "needs_attention",
          stage: "production_qc_blocked",
          qc_status: job.qc_status === "passed" ? "warning" : job.qc_status,
          error_code: "SECTION_QC_FAILED",
          error_detail: "Automatic retries were exhausted for one or more sections. Publication is blocked.",
          updated_at: new Date().toISOString()
        }).eq("id", jobId);
        await logEvent(jobId, "error", "PUBLICATION_BLOCKED",
          "Publication blocked because one or more sections failed QC after automatic retries.");
        return json({ ok: true, published: false, status: "needs_attention", autoRetry: false });
      }
      if (!job.site_book_id) {
        const fallbackSiteBookId = standaloneSiteBookId(job.source_file_name || "manuscript.docx");
        const link = await supabase.from("audiobook_factory_jobs").update({
          site_book_id: fallbackSiteBookId,
          updated_at: new Date().toISOString()
        }).eq("id", jobId);
        if (link.error) throw link.error;
        job.site_book_id = fallbackSiteBookId;
        await logEvent(jobId, "info", "STANDALONE_BOOK_ID_ASSIGNED",
          "No author-site book was selected; a stable standalone audiobook ID was assigned.",
          { siteBookId: fallbackSiteBookId });
      }

      const totalDuration = sections.reduce((a: number, s: any) => a + Number(s.duration_seconds || 0), 0);
      const title = job.requested_title || job.detected_title || job.source_file_name.replace(/\.docx$/i, "");
      const seriesMeta = seriesMetadataFor(job.site_book_id);
      const existing = await supabase.from("audio_books").select("id")
        .eq("site_book_id", job.site_book_id)
        .eq("voice_key", job.voice_key)
        .maybeSingle();
      if (existing.error) throw existing.error;

      let audioBookId = existing.data?.id || null;
      if (audioBookId) {
        const bu = await supabase.from("audio_books").update({
          title, language_code: job.language_code, narrator_name: job.voice_name, voice_key: job.voice_key,
          cover_url: job.cover_url || null, total_duration_seconds: totalDuration,
          ...seriesMeta,
          status: "draft", is_active: false, updated_at: new Date().toISOString()
        }).eq("id", audioBookId);
        if (bu.error) throw bu.error;
        const del = await supabase.from("audio_chapters").delete().eq("audio_book_id", audioBookId);
        if (del.error) throw del.error;
      } else {
        const bi = await supabase.from("audio_books").insert({
          site_book_id: job.site_book_id, title, language_code: job.language_code,
          narrator_name: job.voice_name, voice_key: job.voice_key, cover_url: job.cover_url || null,
          total_duration_seconds: totalDuration, ...seriesMeta, status: "draft", is_active: false
        }).select("id").single();
        if (bi.error) throw bi.error;
        audioBookId = bi.data.id;
      }

      const rows = sections.map((s: any) => ({
        audio_book_id: audioBookId,
        chapter_index: s.section_index,
        title: s.title,
        storage_path: s.final_storage_path,
        duration_seconds: s.duration_seconds,
        mime_type: "audio/mpeg",
        byte_size: s.byte_size,
        updated_at: new Date().toISOString()
      }));
      const ci = await supabase.from("audio_chapters").insert(rows);
      if (ci.error) throw ci.error;

      const publish = job.publish_automatically !== false;
      const ba = await supabase.from("audio_books").update({
        status: "ready", is_active: publish, total_duration_seconds: totalDuration, updated_at: new Date().toISOString()
      }).eq("id", audioBookId);
      if (ba.error) throw ba.error;

      const ju = await supabase.from("audiobook_factory_jobs").update({
        status: "ready", stage: publish ? "published" : "ready_not_published",
        progress_done: sections.length, progress_total: sections.length,
        qc_status: "passed", audio_book_id: audioBookId,
        finished_at: new Date().toISOString(), last_heartbeat_at: new Date().toISOString(),
        error_code: null, error_detail: null, updated_at: new Date().toISOString()
      }).eq("id", jobId);
      if (ju.error) throw ju.error;
      await logEvent(jobId, "info", "JOB_READY", publish ? "Audiobook passed final QC and was published." : "Audiobook passed final QC and is ready.");
      return json({ ok: true, published: publish, status: "ready", audioBookId });
    }

    return json({ ok: false, error: "unknown_operation" }, 400);
  } catch (err: any) {
    const c = String(err?.message || "");
    if (c === "UNAUTHORIZED") return json({ ok: false, error: "unauthorized" }, 401);
    if (c === "WORKER_UNAUTHORIZED") return json({ ok: false, error: "worker_unauthorized" }, 401);
    if (c === "ACCESS_SERVICE_UNAVAILABLE") return json({ ok: false, error: "access_service_unavailable" }, 502);
    if (c === "JOB_NOT_FOUND") return json({ ok: false, error: "job_not_found" }, 404);
    return json({ ok: false, error: "server_error", detail: c || String(err) }, 500);
  }
});
