# AF3 V17 Family pilot – checkpoint 2026-11-06

This is a branch-scoped implementation checkpoint, not a replacement for the canonical AF3 status register in the books repository.

## GEPRÜFT
- Supabase project ipoqyjrojljmbqslmxxf: database 54 MB; auth.users 0.
- Supabase storage metadata: audiobooks 21,084,527,609 bytes (2722 objects); audiobook-downloads 14,993,263,026 bytes (443); audiobook-factory 81,261,700 bytes (86).
- Drive backup registry: 57 ready, 1 failed. These statuses are **not** Drive byte/hash readback.
- Existing V17 commission scripts depend on Oracle/Tailscale; private Google Drive API playback in Safari is unverified.
- Existing production unchanged.

## ERLEDIGT (source only)
- library-policy.mjs: 3 admin / 1 guest slots, no Drive deletion on removal.
- library-policy.test.mjs: test source; **not executed**.
- drive-range-probe.mjs: authenticated GET bytes=0-1, no full media read, no token persistence.
- drive-range-probe.test.mjs: mocked test source; **not executed**.

## OFFEN / BLOCKIERT
- GEPRÜFT: Production Edge Function audio-library v15 validates guest codes/admin tokens via existing Google Apps Script action checkAudioAccess; its response contains listenerId, isAdmin, fullAudioAccess, audioAccess. Supabase auth.users=0 is expected for this custom login path. Reuse server-verified listenerId, not browser claims.
- Browser Google OAuth consent and actual private Drive Range/CORS response not tested; no guest file permission changes.
- Server-side assignment must be transactional and authenticated. The policy helper is NOT enforcement.
- No downgrade while ~36 GB storage remains; protect legacy guest playback.
- No production deployment, no successful guest playback claim.

## Next safe gate
1. Reuse existing audio-library v15 checkAudioAccess response (listenerId / isAdmin / audioAccess) as the authoritative identity and entitlement input; do not replace login.
2. Execute isolated Node tests.
3. Only with authorized pilot Google account and one explicitly shared file, run the single Safari capability test.
4. If Drive API works, integrate as a separate adapter without modifying the V17 UI.
5. Confirm Drive backup bytes/hashes before any Supabase storage deletion; obtain owner approval before cancel/downgrade.
