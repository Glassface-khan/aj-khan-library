# AJK Audiobook Factory 2.0 — Private R2 streaming pilot
**Status: DRAFT / CODE REVIEW ONLY. NO PRODUCTION DEPLOYMENT.**
Date: 2026-10-12
Author site: https://glassface-khan.github.io/aj-khan-library/
Factory: https://glassface-khan.github.io/aj-khan-library/audiobook-factory.html
Actual listening player: \`audio-library.js\` (dynamically loaded by the Factory)
Source Supabase: \`aj-khan-audio\` (\`ipoqyjrojljmbqslmxxf\`)

## 0. Findings and non-negotiable compatibility
- The real production audio player already calls \`api({op:'chapterUrl', chapterId})\` in \`audio-library.js\`, then sets \`audio.src = data.url\`. The Factory calls \`window.AJKAudioLibrary.openAudioBook(id)\`. The main change is in the server-side URL provider, not rebuilding the player.
- Current visitor authentication is **not Supabase Auth**: \`audio-library.js\` reads \`ajk_visitor_access.code\`, \`ajk_admin_token\`, \`ajk_factory_session\` and calls existing Supabase \`audio-library\` function plus Google Apps Script. The source \`auth.users\` count was **0** on 2026-10-12. Do not replace the existing visitor login with the JWT solution without a validated identity bridge and explicit family-account migration.
- Current database has \`public.audio_books\` (58 records), \`public.audio_chapters\` (2634 chapter records), \`public.listening_progress\` (22 records); preserve these and their UUIDs. The *production* migration can extend these tables with \`r2_file_key\` (and checksum), rather than permanently duplicating them.
- The following example implements Gemini's NEW \`books\`, \`chapters\` and \`user_access\` model for an **isolated test project** using Supabase Auth. It cannot serve the current family logins unchanged.
- Google Drive migration/backup planned for **2026-10-21** is a SEPARATE workstream and must not be interrupted. Keep Google Drive as a second private backup after R2 becomes the primary streaming store.
- Do not delete Supabase original files or disable old \`chapterUrl\` until the pilot has been verified on actual iPhone and Windows.

## 1. Proposed architecture
- R2 **Standard storage**, private bucket \`ajk-private-audiobooks\`, public / r2.dev access **disabled**.
- Supabase stays for jobs, titles, progress, playback access and metadata. A new Edge Function is the signed-URL gateway.
- A verified Supabase Auth **user JWT** is required for the *pilot*. The Edge Function gets chapter/owner only from the DB, checks \`books.is_published = true\` and \`user_access\` match before signing.
- Playback flows: login → token → \`POST /functions/v1/r2-audio-url\` with \`{chapter_id}\` → short-lived \`GetObject\` URL → HTML5 \`Audio.src\`.
- The R2 read credential exists **only** in the Edge Function. An independent R2 writer credential is used only by a future migration worker, NEVER by the player.
- IMPORTANT: Presigned URLs are bearer links; someone who copies the link can download the object until it expires. This reduces unauthorized browsing but is **not DRM** or absolute piracy prevention. Do not log these URLs or place them in public analytics.

## 2. Cloudflare Dashboard steps (manual owner setup)
1. Open https://dash.cloudflare.com/ → **R2 Object Storage** (often under Storage & databases) → enable R2. Cloudflare may require billing enrollment/payment information even if monthly use stays in the free tier.
2. Create a **private** Standard Storage bucket, proposed name \`ajk-private-audiobooks\`. Consider EU jurisdiction for regional data-location needs; if you choose that, the S3 endpoint is \`https://<ACCOUNT_ID>.eu.r2.cloudflarestorage.com\`, otherwise \`https://<ACCOUNT_ID>.r2.cloudflarestorage.com\`.
3. Do NOT expose the bucket using \`r2.dev\` or a public custom domain. Do not create public R2 object links.
4. Under R2 → **Manage R2 API tokens**, create a bucket-scoped token with **Object Read** permission for server-side signing. Save **Access Key ID** and **Secret Access Key** securely; the second cannot be recovered later. Save the account ID/endpoints too. Use a separate bucket-scoped **Object Read & Write** token for migration; do not give the player write access.
5. On the bucket → Settings → CORS, apply \`r2-pilot/config/r2-cors.json\`. That allows browser playback from \`https://glassface-khan.github.io\`, including Range requests. Test iPhone Safari and browser seeking: validate HTTP 206, Accept-Ranges and Content-Range.
6. Monitor storage, Class A and Class B request counters. Free quota in October 2026 for Standard: first 10 GB-month, 1M A ops, 10M B ops per month, **no egress charges**. Additional storage is about USD 0.015 per GB-month; Cloudflare billing registration may still be necessary.

Reference: https://developers.cloudflare.com/r2/get-started/
Pricing: https://developers.cloudflare.com/r2/pricing/
Credentials: https://developers.cloudflare.com/r2/api/tokens/
CORS: https://developers.cloudflare.com/r2/buckets/cors/
Presigned URLs: https://developers.cloudflare.com/r2/api/s3/presigned-urls/

## 3. Supabase SQL (new, separate test project only)
See \`r2-pilot/schema/01_private_audio.sql\`.
- Adds \`public.books\`, \`public.chapters\`, \`public.user_access\` with UUID foreign keys and a publication flag.
- Enables RLS and revokes all direct \`anon\` and \`authenticated\` table access; only the backend's service-role client may read/access these tables. This is deliberate; the browser should never directly select the R2 key map.
- **Not executed**, and no existing tables changed.
- First create test \`auth.users\` using Supabase Auth. Then insert a TEST book, TEST chapter with actual R2 object key, set \`books.is_published=true\`, and explicitly grant a single test user a \`user_access\` row. All other users must receive 403.
- Never assume current family codes map to \`auth.users.id\`. Account provisioning and permission migration require their own plan.

## 4. Edge Function (isolated test project)
Source: \`r2-pilot/supabase/functions/r2-audio-url/index.ts\`.
Function name: \`r2-audio-url\`; deploy with \`verify_jwt = true\`.
Add server-side secrets in Supabase Edge Function settings, NOT on GitHub Pages:
- \`SUPABASE_URL\`: matching project URL (normally provided automatically)
- \`SUPABASE_SERVICE_ROLE_KEY\`: matching project's server-only key (or adjust for project-specific secret-key environment; never publish)
- \`R2_PRIVATE_BUCKET\`: private bucket name
- \`R2_S3_ENDPOINT\`: correct account/jurisdiction-specific HTTPS S3 endpoint
- \`R2_READ_ACCESS_KEY_ID\`: bucket-scoped **read-only** R2 token Access Key ID
- \`R2_READ_SECRET_ACCESS_KEY\`: corresponding R2 Secret Access Key
- \`R2_URL_TTL_SECONDS\`: defaults to 900 (15 minutes); can be 7200 for Gemini's 2-hour proposal after reviewing URL-leakage exposure and streaming behavior.

Security controls:
- Exact allowed origin \`https://glassface-khan.github.io\`.
- Validates user JWT via Supabase Auth \`getUser(token)\`, not from user-controlled JSON.
- Input is a UUID chapter ID only. Server resolves the stored object key, confirms published book + explicit user-to-book grant.
- User never supplies \`r2_file_key\`, bucket name or TTL.
- Error responses are generic; presigned URLs and secrets are never logged.
- \`Cache-Control: no-store\`, low TTL; scope backend credentials to read-only bucket.
- CORS does not replace JWT authorization. Add per-user/IP rate limits and abuse alerts before broad availability.
- R2 still permits saving audio while listening; no solution here guarantees piracy prevention.

## 5. Exact frontend integration point
The existing Factory dynamically loads \`audio-library.js\`; do NOT put playback logic or secrets in \`audiobook-factory.html\` itself.

In \`audio-library.js\`, \`loadChapter(book, chapter, ...)\` previously contained:
\`\`\`js
const data = await api({ op: 'chapterUrl', chapterId: chapter.id });
const audio = ensureAudio();
audio.src = data.url;
\`\`\`
The feature branch adds \`authorizedChapterUrl_(chapterId)\` and replaces only that call with:
\`\`\`js
const signedPlaybackUrl = await authorizedChapterUrl_(chapter.id);
const audio = ensureAudio();
audio.src = signedPlaybackUrl;
\`\`\`
With \`window.AJK_R2_PILOT\` unset or \`enabled: false\`, \`authorizedChapterUrl_\` calls the **original backend**, so existing family listening remains unchanged. With the pilot explicitly enabled, it obtains a Supabase Auth user JWT and sends the chapter ID to the new Edge Function.

Optional test configuration template:
\`r2-pilot/frontend/pilot-config.example.js\`
- Load Supabase JS v2 browser SDK in an isolated test page, then instantiate \`window.AJK_R2_PILOT\`.
- Do **not** put the R2 access key or Supabase service-role key in any JavaScript/HTML file.
- Sign in the designated TEST Supabase Auth user using the SDK \`signInWithPassword\` or magic link, then call \`getSession\`. Do not put user passwords or session tokens in GitHub.
- To activate in a test page only, switch the example's \`enabled: false\` to \`true\`. Never put an enabled configuration on the production homepage without passing all gates below.

## 6. Acceptance and failure tests
- A user with no JWT → HTTP 401.
- A user JWT from a different Supabase project or invalid/expired JWT → HTTP 401.
- A verified user with no \`user_access\` row → HTTP 403; cannot get link just by guessing another chapter UUID.
- A verified permitted user for published book → JSON with signed GET URL, no R2 credentials, proper no-store headers.
- Private R2 object is not available at public r2.dev/custom URL.
- Fresh signed URL streams through HTML5 Audio and yields R2 GET 200/206 range responses; seeking and pause/resume tested on Windows Firefox/Chrome and iOS Safari.
- Expired link returns 403; after reauthorization a NEW link works. Before broad release, implement robust URL renewal for multi-hour chapters or long pauses. 15-minute TTL without refresh is a *pilot* limitation.
- Revoke book access: new signing requests immediately fail. Previously minted URLs continue working until expiration — unavoidable with plain presigned URLs. For instant revocation, use a streaming proxy / Cloudflare Worker with per-request authorization instead of directly exposing signed links.
- Compare sampled source and R2 byte counts, SHA-256, duration, chapter IDs, order, bookmarks and voice/edition mapping. Don't trust multipart upload ETag as a cryptographic hash.
- Test absent file, CORS failure, R2 API outage and source Supabase quotas. Maintain fallback to the existing Supabase player during pilot.

## 7. Implementation order and release gates
1. **NO CUTOVER**: Finish Google Drive archival migration preparation for 21 Oct independently.
2. Enable R2 account/billing and create a private Standard bucket + restricted read/writer API tokens (owner must authorize account setup). Obtain account endpoint. No public access.
3. Provision NEW test Supabase project with Auth, SQL and Edge secrets, deploy Edge Function there only; separately bootstrap private test object and one TEST user (not real family accounts).
4. Test one MP3 chapter and one M4B (if desired); validate range playback, auth denial, token expiry and privacy.
5. Decide production compatibility: **Recommended** preserve existing author-site account codes and existing \`audio-library\` API for now; make its existing *server-side verified* \`chapterUrl\` operation sign R2 URLs, using existing rights. Only later introduce Supabase Auth for users if that change is genuinely desirable.
6. Add a durable, idempotent transfer worker (Supabase Storage/Google Drive → R2), original key manifest, byte counts and SHA-256; checkpoint retries and errors; transfer active editions first. Prepare a reader-only R2 principal. Avoid duplicating or overwriting master EPUB/audio archives.
7. Publish changed Player/edge routing only after written go-ahead, successful iPhone listening, family access check, backup verification and a fallback plan. Never delete original Supabase files until a separate deletion authorization.

## 8. Costs and privacy notes
- R2 is inexpensive, not guaranteed 100% free beyond 10 GB. It may require billing setup.
- Short-lived presigned URLs **do not prevent deliberate copying, re-sharing or audio capture**. Two-hour URL TTL increases the period of exposure.
- Hosting on GitHub Pages does not expose bucket objects if R2 public access remains off.
- User personal information, listening history and audit logs remain under the existing/updated backend, not public pages.
- Before production, update the published privacy policy to disclose Cloudflare as a storage processor and evaluate cross-border processing/jurisdiction.
- Google Drive remains a separate backup, not an automatically secure player replacement.

**Decision required for rollout:** whether to keep existing family access codes (recommended for the first R2 pilot) or deliberately migrate to Supabase Auth with new login and verified grants. A new Supabase Auth approach is modeled here but is NOT a drop-in replacement for the existing codes.
