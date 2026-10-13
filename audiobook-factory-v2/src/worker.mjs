// Audiobook Factory 2.0 — ISOLATED Cloudflare Worker prototype.
// Admin-only: verifies the existing author-site admin session; never accepts family codes.
// Ship initially with PILOT_LOCKED=true; NEVER activate private routes before
// rate-limits, cost approval and full end-to-end author-auth tests.
import { isUuid, signTicket, verifyTicket } from "./security.mjs";

const ALLOWED_ORIGIN = "https://glassface-khan.github.io";
const NOW = () => Math.floor(Date.now() / 1000);
const MAX_SOURCE = 15_000_000;
function headers() {
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
    "Access-Control-Allow-Methods": "GET,POST,PUT,OPTIONS",
    "Access-Control-Allow-Headers": "content-type, x-author-token, range",
    "Access-Control-Expose-Headers": "Accept-Ranges,Content-Length,Content-Range",
    "Cache-Control": "private, no-store",
    "Referrer-Policy": "no-referrer",
    "Vary": "Origin",
  };
}
function json(data,status=200) {
  return new Response(JSON.stringify(data),{
    status,headers:{...headers(),"Content-Type":"application/json;charset=utf-8"}
  });
}
function deny() { return json({ok:false,error:"unauthorized"},401); }
function fail() { return json({ok:false,error:"temporarily_unavailable"},503); }
function validOrigin(req) {
  const origin=req.headers.get("Origin");
  return !origin || origin===ALLOWED_ORIGIN;
}
// Fail closed for EVERY private route. Do not unlock until real admin/auth,
// privacy, abuse-limits and full end-to-end tests receive explicit author approval.
// A missing variable is LOCKED, not enabled.
function pilotLocked(env) {
  return env.PILOT_LOCKED !== "false";
}
function ready(env) {
  return Boolean(env.DB && env.PRIVATE_AUDIO && env.TICKET_SECRET && env.GAS_WEB_APP_URL);
}
function limitedText(value,max=255) {
  const result=String(value ?? "").trim();
  return result && result.length<=max ? result : null;
}
// Only the existing administrator may access this prototype.
// Family/visitor access codes are deliberately NOT accepted.
async function authAdmin(env,adminToken) {
  const givenToken=limitedText(adminToken,512);
  if (!givenToken) return null;
  if (!env.GAS_WEB_APP_URL ||
      !env.GAS_WEB_APP_URL.startsWith("https://script.google.com/macros/s/")) return null;
  const body=new URLSearchParams({
    action:"checkAudioAccess",
    adminToken:givenToken
  });
  // POST body is not copied into query strings. Never log the token.
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),8000);
  try {
    const response=await fetch(env.GAS_WEB_APP_URL,{
      method:"POST",
      headers:{"Content-Type":"application/x-www-form-urlencoded"},
      body:body.toString(),
      redirect:"follow",
      signal:controller.signal
    });
    if (!response.ok) return null;
    const d=await response.json();
    // Explicitly fail closed on an ordinary Access-sheet visitor session.
    if (d.ok !== true || d.isAdmin !== true || d.fullAudioAccess !== true ||
        typeof d.listenerId!=="string" ||
        !/^[0-9a-f-]{36}$/i.test(d.listenerId)) return null;
    return {listenerId:d.listenerId,isAdmin:true};
  } catch { return null; }
  finally {clearTimeout(timeout);}
}
async function requireAdmin(req,env,body) {
  const token=(body && body.adminToken) || req.headers.get("X-Author-Token");
  return authAdmin(env,token);
}
async function chapter(env,id) {
  return env.DB.prepare(
    "SELECT c.id AS chapter_id,c.title AS chapter_title,c.chapter_number,c.r2_key,"+
    "b.id AS book_id,b.title AS book_title,b.status,b.is_published "+
    "FROM chapters c JOIN books b ON b.id=c.book_id WHERE c.id=?"
  ).bind(id).first();
}
async function catalog(req,env) {
  const body=await req.json().catch(()=>null);
  if (!body || typeof body!=="object") return json({ok:false,error:"invalid_request"},400);
  const who=await requireAdmin(req,env,body);
  if (!who) return deny();
  const out=await env.DB.prepare(
    "SELECT id,title,cover_url,description,language_code,voice_name "+
    "FROM books WHERE is_published=1 AND status='ready' ORDER BY title LIMIT 300"
  ).all();
  const visible=out.results||[]; // The entire pilot catalog is author-only.
  const books=[];
  for(const b of visible) {
    const rows=await env.DB.prepare(
      "SELECT id,chapter_number,title,duration_seconds FROM chapters "+
      "WHERE book_id=? ORDER BY chapter_number LIMIT 500"
    ).bind(b.id).all();
    books.push({...b,chapters:rows.results||[]});
  }
  return json({ok:true,books,listener_id:who.listenerId});
}
async function ticket(req,env) {
  const body=await req.json().catch(()=>null);
  if (!body || typeof body!=="object") return deny();
  const who=await requireAdmin(req,env,body);
  if (!who) return deny();
  if (!isUuid(body.chapter_id)) return json({ok:false,error:"invalid_chapter"},400);
  const row=await chapter(env,body.chapter_id);
  if (!row || row.is_published!==1 || row.status!=="ready")
    return json({ok:false,error:"not_found"},404);
  // Only a verified author session can mint the short-lived bearer URL.
  const duration=900;
  const signed=await signTicket({
    ch:row.chapter_id, book:row.book_id, listener:who.listenerId,exp:NOW()+duration
  },env.TICKET_SECRET);
  const media=new URL("/v1/media/"+row.chapter_id,new URL(req.url).origin);
  media.searchParams.set("t",signed);
  return json({ok:true,url:media.href,expires_in:duration});
}
async function media(req,env,chapterId) {
  if (!isUuid(chapterId)) return deny();
  const signed=new URL(req.url).searchParams.get("t");
  const payload=await verifyTicket(signed,env.TICKET_SECRET);
  if (!payload || payload.ch!==chapterId) return deny();
  const row=await chapter(env,chapterId);
  if (!row || payload.book!==row.book_id || row.is_published!==1 || row.status!=="ready")
    return deny();
  const range=req.headers.get("Range");
  if (range && !/^bytes=\d*-\d*$/.test(range)) return json({ok:false,error:"invalid_range"},416);
  // D1 NEVER stores secrets or passwords. Only the private R2 key from trusted DB.
  const object=await env.PRIVATE_AUDIO.get(row.r2_key,{
    range: range ? req.headers : undefined,
    onlyIf:req.headers
  });
  if (!object) return json({ok:false,error:"not_found"},404);
  if (!("body" in object)) return new Response(null,{status:412,headers:headers()});
  const h=new Headers(headers());
  object.writeHttpMetadata(h);
  h.set("Content-Type",row.r2_key.endsWith(".m4b")?"audio/mp4":"audio/mpeg");
  h.set("Accept-Ranges","bytes");
  h.set("Content-Disposition","inline");
  h.set("X-Content-Type-Options","nosniff");
  h.set("ETag",object.httpEtag);
  let status=200;
  if (range && object.range) {
    const start=object.range.offset??0;
    const length=object.range.length??(object.size-start);
    h.set("Content-Range",`bytes ${start}-${start+length-1}/${object.size}`);
    h.set("Content-Length",String(length));
    status=206;
  } else {
    h.set("Content-Length",String(object.size));
  }
  return new Response(req.method==="HEAD"?null:object.body,{status,headers:h});
}
async function createJob(req,env) {
  const body=await req.json().catch(()=>null);
  if (!body || !(await requireAdmin(req,env,body))) return deny();
  const title=limitedText(body.title,180),voice=limitedText(body.voice_key,60);
  const language=body.language_code;
  if (!title || !voice || !/^[a-z0-9_-]+$/i.test(voice) ||
      !["EN","DE"].includes(language)) return json({ok:false,error:"invalid_job"},400);
  const id=crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO production_jobs(id,title,language_code,voice_key,stage,created_at) "+
    "VALUES(?,?,?,?,?,?)"
  ).bind(id,title,language,voice,"awaiting_source",new Date().toISOString()).run();
  return json({ok:true,job_id:id,stage:"awaiting_source",note:"Audio synthesis not connected yet"},201);
}
async function uploadSource(req,env,jobId) {
  if (!isUuid(jobId)) return json({ok:false,error:"invalid_job"},400);
  if (!(await requireAdmin(req,env,null))) return deny();
  const job=await env.DB.prepare(
    "SELECT id,stage,source_r2_key FROM production_jobs WHERE id=?"
  ).bind(jobId).first();
  if (!job || job.stage!=="awaiting_source" || job.source_r2_key)
    return json({ok:false,error:"job_not_awaiting_source"},409);
  const declared=Number(req.headers.get("Content-Length")||0);
  if (declared>MAX_SOURCE) return json({ok:false,error:"source_too_large"},413);
  const type=req.headers.get("Content-Type")||"";
  if (!["application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/octet-stream"].includes(type.split(";")[0].trim()))
    return json({ok:false,error:"docx_only"},415);
  const bytes=await req.arrayBuffer();
  if (!bytes.byteLength || bytes.byteLength>MAX_SOURCE) return json({ok:false,error:"source_too_large"},413);
  const magic=new Uint8Array(bytes.slice(0,4));
  if (!(magic[0]===0x50 && magic[1]===0x4b && magic[2]===0x03 && magic[3]===0x04))
    return json({ok:false,error:"invalid_docx"},400);
  const path="sources/"+jobId+"/manuscript.docx";
  const digest=await crypto.subtle.digest("SHA-256",bytes);
  const sha=Array.from(new Uint8Array(digest)).map(x=>x.toString(16).padStart(2,"0")).join("");
  await env.PRIVATE_AUDIO.put(path,bytes,{
    httpMetadata:{contentType:"application/vnd.openxmlformats-officedocument.wordprocessingml.document"}
  });
  const updated=await env.DB.prepare(
    "UPDATE production_jobs SET source_r2_key=?, source_sha256=?,stage='awaiting_voice_preflight' "+
    "WHERE id=? AND stage='awaiting_source' AND source_r2_key IS NULL"
  ).bind(path,sha,jobId).run();
  if (updated.meta?.changes!==1) return json({ok:false,error:"concurrent_job_update"},409);
  return json({ok:true,job_id:jobId,stage:"awaiting_voice_preflight",sha256:sha});
}
async function listJobs(req,env) {
  const body=await req.json().catch(()=>null);
  if (!(await requireAdmin(req,env,body))) return deny();
  const rows=await env.DB.prepare(
    "SELECT id,title,language_code,voice_key,stage,qc_status,created_at "+
    "FROM production_jobs ORDER BY created_at DESC LIMIT 100"
  ).all();
  return json({ok:true,jobs:rows.results||[]});
}
export default {
  async fetch(req,env) {
    const path=new URL(req.url).pathname;
    if (!validOrigin(req)) return json({ok:false,error:"forbidden_origin"},403);
    if (req.method==="OPTIONS") return new Response(null,{status:204,headers:headers()});
    // This public, non-sensitive endpoint allows safe deployment smoke testing.
    if (path==="/health") return json({ok:true,prototype:true,locked:pilotLocked(env)});
    // All catalog, media, admin verification, jobs, and source-upload routes
    // remain unreachable until a separate explicitly authorized unlock.
    if (pilotLocked(env)) return json({ok:false,error:"pilot_locked"},503);
    if (!ready(env)) return fail();
    try {
      if (path==="/v1/catalog" && req.method==="POST") return await catalog(req,env);
      if (path==="/v1/chapter-ticket" && req.method==="POST") return await ticket(req,env);
      if (path.startsWith("/v1/media/") && ["GET","HEAD"].includes(req.method))
        return await media(req,env,path.slice("/v1/media/".length));
      if (path==="/v1/jobs" && req.method==="POST") return await createJob(req,env);
      if (path==="/v1/jobs/list" && req.method==="POST") return await listJobs(req,env);
      const m=path.match(/^\/v1\/jobs\/([0-9a-f-]{36})\/source$/i);
      if (m && req.method==="PUT") return await uploadSource(req,env,m[1]);
      return json({ok:false,error:"not_found"},404);
    } catch {
      // Never log private book names, secret auth codes or ticket URLs.
      return fail();
    }
  }
};
