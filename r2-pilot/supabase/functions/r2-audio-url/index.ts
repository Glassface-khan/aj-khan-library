// R2 pilot ONLY — do not deploy until Supabase Auth accounts are provisioned.
// Secured with Supabase user JWT and explicit server-side book permission.
// This code is intentionally separate from the current Apps Script access-code API.
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { S3Client, GetObjectCommand } from "npm:@aws-sdk/client-s3@3.901.0";
import { getSignedUrl } from "npm:@aws-sdk/s3-request-presigner@3.901.0";

const ALLOWED_ORIGIN = "https://glassface-khan.github.io";
const cors = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Max-Age": "600",
  "Vary": "Origin",
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" },
  });
}

const need = (name: string) => {
  const value = Deno.env.get(name);
  if (!value) throw new Error("MISSING_SERVER_CONFIG");
  return value;
};

// Reuse one S3 signer per runtime instance. The R2 credentials are never returned.
let signer: S3Client | undefined;
function s3(): S3Client {
  if (!signer) {
    signer = new S3Client({
      region: "auto",
      endpoint: need("R2_S3_ENDPOINT"),
      forcePathStyle: true,
      credentials: {
        accessKeyId: need("R2_READ_ACCESS_KEY_ID"),
        secretAccessKey: need("R2_READ_SECRET_ACCESS_KEY"),
      },
    });
  }
  return signer;
}
function ttl(): number {
  // 15 minutes by default; may be set as high as 7200 for long mobile playback.
  // Longer TTL = longer window in which copied URLs can be reused by outsiders.
  const raw = Number(Deno.env.get("R2_URL_TTL_SECONDS") || "900");
  return Number.isInteger(raw) && raw >= 60 && raw <= 7200 ? raw : 900;
}

Deno.serve(async (req: Request): Promise<Response> => {
  const origin = req.headers.get("origin");
  // CORS is NOT authorization; JWT and DB access checks below always apply.
  if (origin && origin !== ALLOWED_ORIGIN) return json({ error: "forbidden_origin" }, 403);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const authorization = req.headers.get("authorization") || "";
  const match = authorization.match(/^Bearer\s+([A-Za-z0-9._-]+)$/i);
  if (!match) return json({ error: "authentication_required" }, 401);

  let chapterId: unknown;
  try {
    const body = await req.json();
    chapterId = body?.chapter_id;
  } catch { return json({ error: "invalid_json" }, 400); }
  if (typeof chapterId !== "string" || !uuid.test(chapterId)) {
    return json({ error: "invalid_chapter_id" }, 400);
  }

  try {
    const admin = createClient(need("SUPABASE_URL"), need("SUPABASE_SERVICE_ROLE_KEY"), {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    // A verified user must come from the SAME Supabase project as user_access.
    const { data: authData, error: authError } = await admin.auth.getUser(match[1]);
    const user = authData?.user;
    if (authError || !user || user.is_anonymous) return json({ error: "authentication_required" }, 401);

    const { data: chapter, error: chapterError } = await admin
      .from("chapters").select("book_id,r2_file_key")
      .eq("id", chapterId).maybeSingle();
    if (chapterError) throw chapterError;
    if (!chapter) return json({ error: "not_found" }, 404);

    const [{ data: book, error: bookError }, { data: grant, error: grantError }] =
      await Promise.all([
        admin.from("books").select("is_published").eq("id", chapter.book_id).maybeSingle(),
        admin.from("user_access").select("book_id").eq("user_id", user.id)
          .eq("book_id", chapter.book_id).maybeSingle(),
      ]);
    if (bookError || grantError) throw bookError || grantError;
    if (!book?.is_published || !grant) return json({ error: "access_denied" }, 403);

    const key: string = chapter.r2_file_key;
    if (typeof key !== "string" || !key || key.startsWith("/") ||
        key.split("/").includes("..")) return json({ error: "invalid_file_reference" }, 500);

    // Do NOT accept bucket or file key from the browser.
    const lifetime = ttl();
    const signed = await getSignedUrl(s3(), new GetObjectCommand({
      Bucket: need("R2_PRIVATE_BUCKET"),
      Key: key,
    }), { expiresIn: lifetime });

    // Anyone in possession of this URL can use it until expiry.
    return json({ url: signed, expires_in: lifetime });
  } catch (_err) {
    // Never include service-role keys, R2 credentials, object paths, URLs or raw errors.
    return json({ error: "temporary_backend_error" }, 503);
  }
});
