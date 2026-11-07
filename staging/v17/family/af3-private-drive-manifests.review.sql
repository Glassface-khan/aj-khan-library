-- REVIEW ONLY - DO NOT APPLY WITHOUT OWNER APPROVAL.
-- Private source of truth for backend-verified M4B Drive parts.
-- Store the validated manifest as JSONB; no public or authenticated access.
BEGIN;
CREATE TABLE IF NOT EXISTS public.af3_private_drive_manifests (
 audio_book_id uuid PRIMARY KEY REFERENCES public.audio_books(id) ON DELETE RESTRICT,
 manifest jsonb NOT NULL CHECK (jsonb_typeof(manifest)='object'),
 updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.af3_private_drive_manifests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.af3_private_drive_manifests FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.af3_private_drive_manifests TO service_role;
-- No RLS policies. The Edge Function must use service_role and check book
-- entitlement + family slot BEFORE selecting this table.
-- Insertion of a private manifest requires a separate reviewed admin operation.
COMMIT;
