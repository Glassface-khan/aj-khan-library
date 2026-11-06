-- AF3 V17 FAMILY PILOT - REVIEW ONLY. DO NOT APPLY TO PRODUCTION.
-- Uses existing public.audio_books and existing server-verified listener_id.
-- Edge function must derive p_listener_id and p_is_owner from verifyAccess();
-- NEVER accept either value from an untrusted browser request.
-- The service-role-only functions serialize each listener's assignments.
BEGIN;
CREATE TABLE IF NOT EXISTS public.af3_family_book_slots (
  listener_id text NOT NULL CHECK (length(listener_id) BETWEEN 1 AND 200),
  audio_book_id uuid NOT NULL REFERENCES public.audio_books(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (listener_id, audio_book_id)
);
ALTER TABLE public.af3_family_book_slots ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.af3_family_book_slots FROM PUBLIC, anon, authenticated;
-- No browser-facing RLS policies. Only the trusted Edge Function uses service_role.

CREATE OR REPLACE FUNCTION public.af3_assign_family_book(
  p_listener_id text, p_audio_book_id uuid, p_is_owner boolean
) RETURNS TABLE (assigned boolean, active_count integer, slot_limit integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE n integer; cap integer;
BEGIN
  IF p_listener_id IS NULL OR length(p_listener_id) NOT BETWEEN 1 AND 200
     OR p_audio_book_id IS NULL OR p_is_owner IS NULL THEN
    RAISE EXCEPTION 'INVALID_ASSIGNMENT';
  END IF;
  -- Serialize concurrent requests for the same listener, including first insert.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_listener_id, 617));
  IF NOT EXISTS (SELECT 1 FROM public.audio_books
    WHERE id=p_audio_book_id AND is_active=true AND status='ready') THEN
    RAISE EXCEPTION 'BOOK_UNAVAILABLE';
  END IF;
  cap := CASE WHEN p_is_owner THEN 3 ELSE 1 END;
  SELECT count(*)::integer INTO n FROM public.af3_family_book_slots
    WHERE listener_id=p_listener_id;
  IF NOT EXISTS (SELECT 1 FROM public.af3_family_book_slots
    WHERE listener_id=p_listener_id AND audio_book_id=p_audio_book_id) THEN
    IF n >= cap THEN RAISE EXCEPTION 'LIBRARY_FULL'; END IF;
    INSERT INTO public.af3_family_book_slots(listener_id,audio_book_id)
      VALUES (p_listener_id,p_audio_book_id);
    n:=n+1;
  END IF;
  RETURN QUERY SELECT true,n,cap;
END;
$$;

CREATE OR REPLACE FUNCTION public.af3_remove_family_book(
  p_listener_id text, p_audio_book_id uuid
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE removed integer;
BEGIN
  IF p_listener_id IS NULL OR length(p_listener_id) NOT BETWEEN 1 AND 200
     OR p_audio_book_id IS NULL THEN RAISE EXCEPTION 'INVALID_REMOVAL'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_listener_id, 617));
  DELETE FROM public.af3_family_book_slots
    WHERE listener_id=p_listener_id AND audio_book_id=p_audio_book_id;
  GET DIAGNOSTICS removed = ROW_COUNT;
  RETURN removed > 0;
END;
$$;
REVOKE ALL ON FUNCTION public.af3_assign_family_book(text,uuid,boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.af3_remove_family_book(text,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.af3_assign_family_book(text,uuid,boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.af3_remove_family_book(text,uuid) TO service_role;
COMMIT;

-- Integration gate: verifyAccess(body) must run before RPC.
-- Check existing audioAccess[book.title] or fullAudioAccess, then call assign.
-- All m4bSource/m4bPart requests must check the same listener/book slot,
-- not merely possession of a Drive file ID. Removing a slot never deletes Drive.
-- Existing books already assigned elsewhere need an explicit migration plan;
-- do not automatically count all 59 catalog titles as library assignments.
-- Rollback (ONLY after owner approval): DROP FUNCTION ...; DROP TABLE ...;
