# Private Google Drive audiobook backup

The Factory's Downloads dialog has an admin-only **Auf Google Drive sichern** action. It queues all M4B parts of the current ready edition, prepares exports if necessary, and copies them on a GitHub runner. Closing Safari does not cancel a job. Supabase originals remain intact. The website player continues using Supabase.

The backup worker uses Google OAuth with exactly `https://www.googleapis.com/auth/drive.file`. It creates an app-owned private Audio folder and an edition folder with title, narrator, and language. The manually created Audio folder belongs to a different OAuth app and is not automatically accessible with this limited scope. No permissions are created or changed. Public, domain, or group sharing on the target folder blocks copying. Explicit user sharing can be managed by the owner in Drive.

## One-time connection required

The ChatGPT Drive connector's authorization cannot be reused by this independent worker. Before real backups can run:

1. Create a Google Cloud OAuth web client for this private application and enable Drive API. Configure the OAuth consent screen for the author's Google account, with only `drive.file` scope.
2. Complete the standard Google authorization-code flow with offline access on that author's account to obtain a refresh token. Use an owner-controlled callback; never paste tokens into chat, public source, frontend fields, workflow inputs, or logs. OAuth consent applications left in external Testing mode may have expiring refresh tokens; configure the consent screen appropriately for durable personal use.
3. Add encrypted repository secrets in Glassface-khan/aj-khan-library: `GOOGLE_DRIVE_CLIENT_ID`, `GOOGLE_DRIVE_CLIENT_SECRET`, and `GOOGLE_DRIVE_REFRESH_TOKEN`.
4. Start a backup from the Factory. The first successful backup creates the app-owned Audio folder and supplies its actual Drive link. Verify all parts and private permissions before relying on it as the only copy.

Missing/revoked credentials show **Google Drive noch nicht verbunden**. A retry after setup reuses the same queue row. Ready jobs are not copied again. New source fingerprints create a separate edition folder. If an owner deletes a Drive backup after it is marked ready, the current UI does not automatically detect that deletion: the completion status is a verified-at-copy-time receipt, not continuous monitoring.

## Authorization and verification

Only the existing Factory admin token/session can request or view backups. Database RLS denies direct anon/authenticated access. Worker operations require GitHub OIDC for the exact repository ID, main branch, allowed event, and private backup workflow; the backup workflow cannot invoke production or download-worker operations. The source snapshot is rechecked at claim and finish. Download paths are constructed/validated server-side. Workers have no Supabase service-role credential. Drive credentials stay only in encrypted repository secrets and runner memory.

Upload receipts are read back and checked by byte size and MD5. Retries discover files by appProperties and reuse verified files. No audio, tokens, or signed URLs are committed or uploaded as workflow artifacts. Failures log only a fixed safe code.

Validation: six worker unit tests (missing credentials, narrow scope, private folder checks, duplicate reuse, hash mismatch, actionable connection status), Factory script syntax, existing privacy harness. Existing staging test has a pre-existing DOCX-clear assertion failure at line 12 on main; unchanged by this feature. End-to-end Drive copying requires the owner's OAuth connection and remains unverified until then.
