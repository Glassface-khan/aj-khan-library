# AF3 V17 Drive pilot — local test readback (2026-11-07)

Status: GEPRÜFT (isolated local tests); BLOCKIERT (guest Drive access / deployment).

## Executed
- Node.js v22.16.0, `node --test`, local reconstruction of the current private manifest, endpoint and Drive adapter modules and their committed tests.
- 7/7 tests passed, 0 failed. This does NOT certify the GitHub Actions workflow or production edge integration; the local sources were reconstructed from GitHub readback, not checked out from the repository.
- Manifest checks: part order, duration, duplicate IDs, chapter catalog mapping, missing chapters.
- Endpoint checks: slot denial, source and part response shape.
- Drive adapter checks: bearer header only, 401 retry, 403/size rejection, blob revocation, empty stream rejection.

## Blocking architecture issue — do not claim guest playback
The current client-side Google Identity Services OAuth obtains a token for the **currently signed-in Google account**, while the five private Lamp Keeper M4B files are owner-only in Drive. An authenticated family guest who is not the Drive owner will therefore receive a Drive 403, even if the AF3 backend grants a library slot. Backend slot authorization does NOT grant Google Drive file permission.

Do not make the files public, share them broadly, or persist owner OAuth tokens in a browser. Choose and security-review a private server-side media gateway or individually approved per-user Drive sharing before enabling family guests. No production changes are authorized by this document.

## Other gates
- Run the committed test suite in CI with verifiable logs.
- Verify Google OAuth client configuration and exact HTTPS origin; user-gesture flow on iOS Safari.
- Review the proposed SQL and the current production verifyAccess contract; do not apply migrations without approval.
- Verify real iPhone owner and guest playback independently.
