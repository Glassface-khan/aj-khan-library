# Private Audiobook Migration — Supabase → Google Drive
Status: PREPARATION ONLY / NO CUTOVER AUTHORIZED
Snapshot: 2026-10-12 (Europe/Berlin)
Target date: 2026-10-21

## Verified infrastructure
- Supabase project: aj-khan-audio (`ipoqyjrojljmbqslmxxf`) — ACTIVE_HEALTHY.
- Google Drive connector: connected. Existing PRIVATE folder: `Audio` (ID `1FQ5gD7rWjif8PFLucZTr7_mkvEJBiEf_`).
- Private staging folder created 2026-10-12: `_SUPABASE_MIGRATION_2026-10-21` (ID `1Zi1XApHOp1FwzlB-HTHNJZuv4DGP9pvk`).
- Production audiobook backup workflow already exists in `.github/workflows/audiobook-drive-backup.yml`, with Drive OAuth secret *references*, OIDC auth to the Supabase factory API and five-minute periodic runs. **Successful transfer has NOT been demonstrated**.
- There are 33 saved per-book Drive folder targets; none of the rows in `public.audiobook_drive_backups` is populated. Existing worker exports M4B only, *not* the complete chapter/object inventory.
- Keep production workflow and Edge Functions untouched until the replacement path passes an isolated test.

## Inventory (read-only SQL at 2026-10-12)
| Bucket | Visibility | Files | Sum of object metadata byte sizes |
| --- | --- | ---: | ---: |
| `audiobooks` | private | 2683 | 20,652,918,110 |
| `audiobook-downloads` | private | 40 | 1,541,905,847 |
| `audiobook-factory` | private | 84 | 77,281,782 |
| `audio-books` | private | 0 | 0 |
| **Total** | **private** | **2807** | **22,272,105,739** |

Database: 58 `audio_books` rows (57 ready, 1 draft); 2634 `audio_chapters` rows.
- 45 chapter records without matching storage objects are from **inactive draft** version of `The Road it came by` (not an active publication). **Zero active-book chapter records were unmatched** in the source database.
- 94 MP3 storage objects do not match chapter records. **Do not delete these**; preserve under their original bucket/path, as they may be archival or orphaned variants.
- Factory jobs on 12 Oct: 55 ready, 20 cancelled, 5 needs_attention (state may change).
- Only 3 download-job records in `ready` status; the 40 packaged export objects do **not** represent the entire library.

## Required technical transfer implementation — not yet deployed/tested
1. Isolated, read-only Supabase migration gateway, restricted to the specific private GitHub Actions workflow via verified GitHub OIDC token (repository ID, exact main ref, workflow ref, issuer and audience); serve only per-bucket listings and short-lived signed URLs for the four allowlisted buckets, with strict path checks. No public bucket, no release of service-role credentials.
2. Dedicated GitHub Action that uses the already configured *private* Google OAuth credential in GitHub Secrets (not exposed in logs or in frontend code); prove it can create, list and read back a private Drive test folder. The Drive plugin's OAuth permission is separate from this worker's permission.
3. Copy every source object's bytes using a streaming/resumable and retryable worker. Retain bucket name and full original path, with deterministic file IDs / appProperties for idempotence. Prefer bounded batches and persist a checkpoint/manifest outside the runner.
4. Verify each target with byte count and MD5 against the *actual downloaded source*, and re-read Drive metadata; never mark a file migrated solely because upload succeeded. Preserve original files until every active edition and metadata reference has been tested.
5. Perform **initial bulk copy BEFORE 2026-10-21** to reduce 21 Oct work to a delta sync. At cutover re-inventory, reconcile new/changed objects, checksum all, and freeze write operations briefly for final delta.
6. Keep Supabase functional for metadata, user authorization, listening state, streaming and the audiobook factory until the website and private player are genuinely rewired to a secure Drive-backed reader. Google Drive alone is not a drop-in backend replacement.
7. Do not delete any Supabase objects, tables, Edge Functions, keys, storage buckets or the project without a separate explicit user go-ahead **after** successful readback, listening tests, per-book verification, and a rollback period.

## Acceptance criteria for target date
- Pilot: at least one complete private book is accessible and listenable via Drive with chapters and M4B (where present); verify login and no unauthenticated access.
- Comprehensive inventory/export log for 2807 object keys (plus any objects written later), grouped by original bucket, with corresponding destination ID, bytes, MD5, and verification status.
- Zero skipped active published chapters. Keep evidence of inactive draft and 94 unmatched files.
- App/site must still support private listening, author workflow, audiobooks in progress, downloads, and family-specific access where enabled.
- Explicit green-light checklist and rollback plan before switching website URLs. Zero production data deletion before user review.

## Operating constraints / known risks
- Reported quota overages in Supabase Storage and Egress may block or slow bulk transfer; investigate before writing a mass-copy script.
- Metadata sum (~22.27 GB) is a source-side logical inventory, not verified transferred bytes or the current billed storage metric.
- No evidence yet that GitHub Drive OAuth secret refresh works or grants access to the desired folder. Confirm with a **small, private test** before a bulk migration.
- Schedule automation alone does not copy data. A tested runner with durable checkpoints must be installed and observed.

## Safety
PRIVATE ONLY. No public object links, no anyone-with-link Drive sharing, no secrets in git, chat or logs, no bulk deletion, no modification of currently locked manuscript/EPUB archives.
