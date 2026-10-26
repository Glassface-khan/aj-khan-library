# M4B capacity upgrade — staging only

Status: PROPOSAL. No production deployment, merge, or transfers authorized.

## Matched limits

| Check | Python worker | Supabase Edge function |
|---|---|---|
| Number of M4B parts | `MAX_PARTS = 30` | `SIZES.maxParts = 30` |
| Total declared bytes | `MAX_TOTAL = 1000000000` | `SIZES.maxTotal = 1000000000` |
| Maximum bytes per individual part | `source_download` retains `50000000` | `SIZES.maxFile = 50000000` |

These are decimal bytes: 1 GB = 1,000,000,000 bytes. Existing 47/50 MB per-part export issues are separate.

## Proposed minimal diffs

In `ops/ajk_private_auto_m4b_backup.py`:

```diff
-MAX_TOTAL=350000000
-MAX_PARTS=10
+MAX_TOTAL=1000000000
+MAX_PARTS=30
```

In a **version-controlled copy** of the current Supabase Edge function `ajk-private-auto-m4b-backup` v6 (do not deploy):

```diff
-const SIZES={maxFile:50000000,maxTotal:350000000,maxParts:10};
+const SIZES={maxFile:50000000,maxTotal:1000000000,maxParts:30};
```

## Required gates

1. Run existing eight offline tests and add assertions for the actual worker constants, 30-part accepted metadata, 1,000,000,001-byte rejection, and the per-part limit.
2. Verify server/client constants match from checked-in source, including the real Edge function source; no fake server implementation.
3. Preserve whole-manifest rejection (no truncation), sequential numbering, declared-vs-storage size checks, privacy, readback, and no source deletion.
4. Test the real Python entrypoint's sanitized error behavior, not only a test helper.
5. Review `upload()` memory behavior: it uses `path.read_bytes()` per part (up to 50 MB), so the tests do not prove 1 GB transfer stability. Investigate bounded upload memory and timeouts separately.
6. Production remains blocked pending explicit authorization and a controlled integration test.

## Historical finding

Current Edge v6 rejects manifests above ten parts; it does **not** truncate them. Supabase logs from 2026-10-26 07:02 UTC show ten signed URLs, while the currently stored export manifest has twenty parts. The precise historical claim response is not preserved in the reviewed evidence; root cause remains unproven.
