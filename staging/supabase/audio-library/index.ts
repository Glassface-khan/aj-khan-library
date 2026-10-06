import { downloadSnapshot } from "./download_helpers.ts";
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbwcbRDaWkM1wf3MV_dj4RPw9jQl2Fgc4YfGcmFrGU1S243yvh8WGW7mbyXLbSeVJKI/exec";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false, autoRefreshToken: false }
});

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store"
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: cors });
}

const ADMIN_CACHE_TTL_MS = 60 * 60 * 1000;

async function sha256Hex_(value: string) {
  const bytes = new TextEncoder().encode(String(value || ""));
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(digest).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function adminAccessFromCacheRow_(row: any) {
  if (!row) return null;
  return {
    ok: true,
    isAdmin: true,
    name: row.admin_name || "Admin",
    listenerId: row.listener_id || "",
    fullAudioAccess: true,
    allowed: true,
    audioAccess: {},
    source: "supabase_admin_session"
  };
}

async function cachedAdminByHash_(adminTokenHash: string) {
  const now = new Date().toISOString();
  const r = await supabase.from("audiobook_factory_admin_token_cache")
    .select("admin_token_hash,listener_id,admin_name,expires_at")
    .eq("admin_token_hash", adminTokenHash)
    .gt("expires_at", now)
    .maybeSingle();
  if (r.error) throw r.error;
  return r.data || null;
}

async function cachedAdminFromSession_(factorySession: string) {
  const token = String(factorySession || "").trim();
  if (!token) return null;
  const now = new Date().toISOString();
  const sessionHash = await sha256Hex_(token);
  const sr = await supabase.from("audiobook_factory_admin_sessions")
    .select("admin_token_hash,expires_at")
    .eq("session_hash", sessionHash)
    .gt("expires_at", now)
    .maybeSingle();
  if (sr.error) throw sr.error;
  if (!sr.data) return null;
  await supabase.from("audiobook_factory_admin_sessions")
    .update({ last_used_at: now })
    .eq("session_hash", sessionHash);
  const cached = await cachedAdminByHash_(sr.data.admin_token_hash);
  return adminAccessFromCacheRow_(cached);
}

async function cacheAdminAccess_(adminToken: string, data: any) {
  const hash = await sha256Hex_(adminToken);
  const now = new Date();
  const r = await supabase.from("audiobook_factory_admin_token_cache").upsert({
    admin_token_hash: hash,
    verified_at: now.toISOString(),
    expires_at: new Date(now.getTime() + ADMIN_CACHE_TTL_MS).toISOString(),
    listener_id: String(data?.listenerId || "").trim() || null,
    admin_name: String(data?.name || "Admin").trim() || "Admin"
  }, { onConflict: "admin_token_hash" });
  if (r.error) throw r.error;
}

async function verifyAccess(body: any, bookTitle = "") {
  const code = String(body?.code || "").trim();
  const adminToken = String(body?.adminToken || "").trim();
  const factorySession = String(body?.factorySession || "").trim();

  if (factorySession) {
    const sessionAccess = await cachedAdminFromSession_(factorySession);
    if (sessionAccess) {
      if (!sessionAccess.listenerId) throw new Error("MISSING_LISTENER_ID");
      return sessionAccess;
    }
  }

  if (adminToken) {
    const cached = await cachedAdminByHash_(await sha256Hex_(adminToken));
    if (cached) {
      const access = adminAccessFromCacheRow_(cached);
      if (!access?.listenerId) throw new Error("MISSING_LISTENER_ID");
      return access;
    }
  }

  if (!code && !adminToken) throw new Error("UNAUTHORIZED");

  const params = new URLSearchParams({ action: "checkAudioAccess" });
  if (code) params.set("code", code);
  if (adminToken) params.set("adminToken", adminToken);
  if (bookTitle) params.set("bookTitle", bookTitle);

  let response: Response | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
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
    if (response && response.ok) break;
    if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 300));
  }
  if (!response || !response.ok) throw new Error("ACCESS_SERVICE_UNAVAILABLE");

  const data = await response.json().catch(() => null);
  if (!data || data.ok !== true) throw new Error("UNAUTHORIZED");
  if (adminToken && data.isAdmin === true) await cacheAdminAccess_(adminToken, data);
  if (bookTitle && data.fullAudioAccess !== true && data.allowed !== true) throw new Error("FORBIDDEN");
  if (!data.listenerId) throw new Error("MISSING_LISTENER_ID");
  return data;
}

async function getChapterWithBook(chapterId: string) {
  const { data: chapter, error: chapterError } = await supabase
    .from("audio_chapters")
    .select("id,audio_book_id,chapter_index,title,storage_path,duration_seconds")
    .eq("id", chapterId)
    .maybeSingle();
  if (chapterError) throw chapterError;
  if (!chapter) return null;

  const { data: book, error: bookError } = await supabase
    .from("audio_books")
    .select("id,site_book_id,title,language_code,narrator_name,cover_url,total_duration_seconds,is_active")
    .eq("id", chapter.audio_book_id)
    .maybeSingle();
  if (bookError) throw bookError;
  if (!book || !book.is_active) return null;
  return { chapter, book };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  let body: any = {};
  try { body = await req.json(); }
  catch { return json({ ok: false, error: "invalid_json" }, 400); }

  const op = String(body?.op || body?.action || "");

  try {
    if (op === "availability") {
      // Audio existence is private metadata too. Never reveal which public
      // author-site books have audiobooks without a valid listener/admin grant.
      const access = await verifyAccess(body);

      const r = await supabase
        .from("audio_books")
        .select("site_book_id,voice_key,title")
        .eq("is_active", true)
        .eq("status", "ready");
      if (r.error) throw r.error;

      const allowedTitles = access.fullAudioAccess === true
        ? null
        : new Set(Object.keys(access.audioAccess || {}).filter((title) => access.audioAccess[title] === true));

      const counts: Record<string, number> = {};
      for (const row of (r.data || [])) {
        if (allowedTitles && !allowedTitles.has(String(row.title || ""))) continue;
        const id = String(row.site_book_id || "").trim();
        if (!id) continue;
        counts[id] = (counts[id] || 0) + 1;
      }

      return json({
        ok: true,
        books: Object.entries(counts).map(([site_book_id, voice_count]) => ({
          site_book_id,
          voice_count
        }))
      });
    }

    if (op === "catalog") {
      const access = await verifyAccess(body);

      let q = supabase
        .from("audio_books")
        .select("id,site_book_id,title,language_code,voice_key,narrator_name,cover_url,total_duration_seconds,series_key,series_title,series_number,series_total")
        .eq("is_active", true)
        .order("title", { ascending: true })
        .order("language_code", { ascending: true });

      if (access.fullAudioAccess !== true) {
        const allowedTitles = Object.keys(access.audioAccess || {}).filter((title) => access.audioAccess[title] === true);
        if (!allowedTitles.length) return json({ ok: true, listenerName: access.name || "", books: [] });
        q = q.in("title", allowedTitles);
      }

      const { data: books, error: booksError } = await q;
      if (booksError) throw booksError;
      const list = books || [];
      const ids = list.map((b: any) => b.id);

      let chapters: any[] = [];
      let progress: any[] = [];
      if (ids.length) {
        const cr = await supabase
          .from("audio_chapters")
          .select("id,audio_book_id,chapter_index,title,duration_seconds")
          .in("audio_book_id", ids)
          .order("chapter_index", { ascending: true });
        if (cr.error) throw cr.error;
        chapters = cr.data || [];

        const pr = await supabase
          .from("listening_progress")
          .select("audio_book_id,chapter_id,position_seconds,playback_rate,completed,updated_at")
          .eq("listener_id", access.listenerId)
          .in("audio_book_id", ids);
        if (pr.error) throw pr.error;
        progress = pr.data || [];
      }

      const chaptersByBook = new Map<string, any[]>();
      for (const ch of chapters) {
        const arr = chaptersByBook.get(ch.audio_book_id) || [];
        arr.push({
          id: ch.id,
          chapter_index: ch.chapter_index,
          title: ch.title,
          duration_seconds: ch.duration_seconds || 0
        });
        chaptersByBook.set(ch.audio_book_id, arr);
      }
      const progressByBook = new Map(progress.map((p: any) => [p.audio_book_id, p]));

      return json({
        ok: true,
        listenerName: access.name || "",
        books: list.map((b: any) => ({
          ...b,
          chapters: chaptersByBook.get(b.id) || [],
          progress: progressByBook.get(b.id) || null
        }))
      });
    }

    if (op === "downloadStatus" || op === "requestDownload") {
      const access=await verifyAccess(body);
      const bookId=String(body.bookId||"");
      const snapshot=await downloadSnapshot(supabase,bookId);
      if(access.fullAudioAccess!==true&&access.audioAccess?.[snapshot.book.title]!==true)throw new Error("FORBIDDEN");
      let found=await supabase.from("audiobook_download_jobs").select("*").eq("audio_book_id",bookId).eq("source_fingerprint",snapshot.fingerprint).maybeSingle();
      if(found.error)throw found.error;
      if(op==="requestDownload"&&!found.data){
        const inserted=await supabase.from("audiobook_download_jobs").upsert({audio_book_id:bookId,source_fingerprint:snapshot.fingerprint},{onConflict:"audio_book_id,source_fingerprint",ignoreDuplicates:true});
        if(inserted.error)throw inserted.error;
        found=await supabase.from("audiobook_download_jobs").select("*").eq("audio_book_id",bookId).eq("source_fingerprint",snapshot.fingerprint).single();
        if(found.error)throw found.error;
      }
      if(op==="requestDownload"&&found.data?.status==="failed"){
        const retry=await supabase.from("audiobook_download_jobs").update({status:"queued",error_detail:null,updated_at:new Date().toISOString()}).eq("id",found.data.id).eq("status","failed").select("*").single();
        if(retry.error)throw retry.error;found=retry;
      }
      if(!found.data)return json({ok:true,status:"not_requested",files:[]});
      const job=found.data,files=[];
      if(job.status==="ready"){
        for(const file of job.files||[]){
          const prefix=[snapshot.book.title,snapshot.book.narrator_name,snapshot.book.language_code].filter(Boolean).join(" - ").normalize("NFKD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-zA-Z0-9 ._-]+/g,"").slice(0,140);
          const name=prefix+" - "+file.name;
          const signed=await supabase.storage.from("audiobook-downloads").createSignedUrl(file.path,600,{download:name});
          if(signed.error)throw signed.error;
          files.push({name,format:file.format,bytes:file.bytes,url:signed.data.signedUrl});
        }
      }
      return json({ok:true,status:job.status,progressDone:job.progress_done,progressTotal:job.progress_total,files,error:job.status==="failed"?"Download konnte nicht vorbereitet werden. Bitte erneut versuchen.":null});
    }

    if (op === "chapterUrl" || op === "chapter-url") {
      const chapterId = String(body?.chapterId || "").trim();
      if (!chapterId) return json({ ok: false, error: "missing_chapter_id" }, 400);
      const pair = await getChapterWithBook(chapterId);
      if (!pair) return json({ ok: false, error: "chapter_not_found" }, 404);

      await verifyAccess(body, pair.book.title);

      const signed = await supabase.storage
        .from("audiobooks")
        .createSignedUrl(pair.chapter.storage_path, 3600);
      if (signed.error) throw signed.error;

      return json({ ok: true, url: signed.data.signedUrl });
    }

    if (op === "saveProgress" || op === "save-progress") {
      const chapterId = String(body?.chapterId || "").trim();
      if (!chapterId) return json({ ok: false, error: "missing_chapter_id" }, 400);
      const pair = await getChapterWithBook(chapterId);
      if (!pair) return json({ ok: false, error: "chapter_not_found" }, 404);

      const access = await verifyAccess(body, pair.book.title);
      const position = Math.max(0, Number(body?.positionSeconds || 0));
      const rate = Math.min(3, Math.max(0.5, Number(body?.playbackRate || 1)));
      const completed = body?.completed === true;

      const saved = await supabase.from("listening_progress").upsert({
        listener_id: access.listenerId,
        audio_book_id: pair.book.id,
        chapter_id: pair.chapter.id,
        position_seconds: position,
        playback_rate: rate,
        completed,
        updated_at: new Date().toISOString()
      }, { onConflict: "listener_id,audio_book_id" });
      if (saved.error) throw saved.error;

      return json({ ok: true });
    }

    // Backward compatibility for the earlier internal prototype.
    if (op === "open-book") {
      const title = String(body?.bookTitle || "").trim();
      if (!title) return json({ ok: false, error: "missing_book_title" }, 400);
      const access = await verifyAccess(body, title);
      let q = supabase.from("audio_books").select("*").eq("title", title).eq("is_active", true);
      if (body?.languageCode) q = q.eq("language_code", String(body.languageCode).toUpperCase());
      const br = await q.limit(1).maybeSingle();
      if (br.error) throw br.error;
      if (!br.data) return json({ ok: false, error: "audio_not_found" }, 404);
      const cr = await supabase.from("audio_chapters").select("id,chapter_index,title,storage_path,duration_seconds").eq("audio_book_id", br.data.id).order("chapter_index");
      if (cr.error) throw cr.error;
      const signed = await Promise.all((cr.data || []).map(async (ch: any) => {
        const sr = await supabase.storage.from("audiobooks").createSignedUrl(ch.storage_path, 3600);
        if (sr.error) throw sr.error;
        return { id: ch.id, chapterIndex: ch.chapter_index, title: ch.title, durationSeconds: ch.duration_seconds || 0, streamUrl: sr.data.signedUrl };
      }));
      const pr = await supabase.from("listening_progress").select("chapter_id,position_seconds,playback_rate,completed,updated_at").eq("listener_id", access.listenerId).eq("audio_book_id", br.data.id).maybeSingle();
      if (pr.error) throw pr.error;
      return json({ ok: true, book: { id: br.data.id, title: br.data.title, languageCode: br.data.language_code, narratorName: br.data.narrator_name || "", coverUrl: br.data.cover_url || "", totalDurationSeconds: br.data.total_duration_seconds || 0 }, chapters: signed, progress: pr.data || null });
    }

    return json({ ok: false, error: "unknown_operation" }, 400);
  } catch (err: any) {
    const code = String(err?.message || "");
    if (code === "UNAUTHORIZED") return json({ ok: false, error: "unauthorized" }, 401);
    if (code === "FORBIDDEN") return json({ ok: false, error: "forbidden" }, 403);
    if (code === "ACCESS_SERVICE_UNAVAILABLE") return json({ ok: false, error: "access_service_unavailable" }, 502);
    if (code === "MISSING_LISTENER_ID") return json({ ok: false, error: "missing_listener_id" }, 500);
    return json({ ok: false, error: "server_error", detail: String(err?.message || err) }, 500);
  }
});
