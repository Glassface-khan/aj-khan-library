-- Read-only candidate list for both backup writers. Empty/incomplete/ambiguous
-- receipts fail the entire edition. Never feed this directly to a delete API:
-- the legacy download endpoint remains a live consumer until cutover.
WITH exports AS (
  SELECT j.id, j.audio_book_id, j.source_fingerprint, f->>'name' AS name,
         f->>'path' AS path, (f->>'bytes')::bigint AS bytes
  FROM public.audiobook_download_jobs j
  CROSS JOIN LATERAL jsonb_array_elements(j.files) f
  WHERE j.status='ready' AND f->>'format'='M4B'
), matched AS (
  SELECT e.*, o.id AS storage_object_id, proof.matches, proof.drive_id
  FROM exports e
  LEFT JOIN storage.objects o ON o.bucket_id='audiobook-downloads'
    AND o.name=e.path AND e.path=e.id::text||'/'||e.name
    AND e.name ~ '^m4b-[0-9]{3}\.m4b$'
    AND (o.metadata->>'size')::bigint=e.bytes AND e.bytes>0
  CROSS JOIN LATERAL (
    SELECT count(*) AS matches,min(f->>'id') AS drive_id
    FROM public.audiobook_drive_backups b
    CROSS JOIN LATERAL jsonb_array_elements(b.files) f
    WHERE b.status='ready' AND b.audio_book_id=e.audio_book_id
      AND b.source_fingerprint=e.source_fingerprint
      AND f->>'name'=e.name AND (f->>'bytes')::bigint=e.bytes
      AND f->>'md5' ~ '^[0-9a-fA-F]{32}$' AND length(f->>'id')>=10
  ) proof
), eligible AS (
  SELECT id FROM matched GROUP BY id
  HAVING bool_and(storage_object_id IS NOT NULL AND matches=1)
    AND count(*)=count(DISTINCT name) AND count(*)=count(DISTINCT drive_id)
)
SELECT m.audio_book_id,m.id AS export_job,m.storage_object_id,m.path,m.bytes,m.drive_id,
       'backup_matched_only__playback_and_owner_release_pending' AS state
FROM matched m JOIN eligible USING(id)
WHERE NOT EXISTS (SELECT FROM public.audiobook_factory_jobs p WHERE p.audio_book_id=m.audio_book_id AND p.status NOT IN ('ready','cancelled'))
  AND NOT EXISTS (SELECT FROM public.audiobook_download_jobs j WHERE j.audio_book_id=m.audio_book_id AND j.status NOT IN ('ready','failed'))
  AND NOT EXISTS (SELECT FROM public.audiobook_drive_backups b WHERE b.audio_book_id=m.audio_book_id AND b.status NOT IN ('ready','failed'))
ORDER BY m.id,m.name;
