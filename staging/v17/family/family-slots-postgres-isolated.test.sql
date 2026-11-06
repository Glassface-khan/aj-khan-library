-- AF3 V17: ISOLATED POSTGRESQL 17 TEST ONLY.
-- Prerequisite: disposable database with migration af3-family-slots.review.sql
-- and one ready/active audio_books row. NEVER RUN ON PRODUCTION.
-- Replace UUID with a real fixture row in the disposable database.
-- Run as service_role-equivalent privileged test connection.
BEGIN;
DO $$
DECLARE
  book uuid;
  owner_result record;
  guest_result record;
  duplicate_result record;
  removed boolean;
BEGIN
  SELECT id INTO book FROM public.audio_books WHERE is_active AND status='ready' LIMIT 1;
  IF book IS NULL THEN RAISE EXCEPTION 'TEST_FIXTURE_MISSING'; END IF;
  SELECT * INTO guest_result FROM public.af3_assign_family_book('af3-test-guest',book,false);
  IF guest_result.active_count<>1 OR guest_result.slot_limit<>1 THEN
    RAISE EXCEPTION 'GUEST_LIMIT_WRONG';
  END IF;
  SELECT * INTO duplicate_result FROM public.af3_assign_family_book('af3-test-guest',book,false);
  IF duplicate_result.active_count<>1 THEN RAISE EXCEPTION 'DUPLICATE_SLOT'; END IF;
  SELECT * INTO owner_result FROM public.af3_assign_family_book('af3-test-owner',book,true);
  IF owner_result.active_count<>1 OR owner_result.slot_limit<>3 THEN
    RAISE EXCEPTION 'OWNER_LIMIT_WRONG';
  END IF;
  SELECT public.af3_remove_family_book('af3-test-guest',book) INTO removed;
  IF removed IS DISTINCT FROM true THEN RAISE EXCEPTION 'REMOVE_FAILED'; END IF;
  SELECT public.af3_remove_family_book('af3-test-guest',book) INTO removed;
  IF removed IS DISTINCT FROM false THEN RAISE EXCEPTION 'REMOVE_NOT_IDEMPOTENT'; END IF;
END $$;
ROLLBACK;

-- Additional fixtures required to verify caps: 2 distinct ready books for
-- a guest, 4 distinct ready books for owner. Expect SQLSTATE P0001 and
-- message LIBRARY_FULL on the exceeding assignment.
--
-- CONCURRENCY TEST: run the following in two distinct database connections,
-- against the same guest and TWO different ready books, with a clean slot set.
-- Connection A: BEGIN; SELECT * FROM public.af3_assign_family_book(
--   'af3-concurrent-guest', '<UUID-A>', false); SELECT pg_sleep(2); COMMIT;
-- Connection B (start while A sleeps):
--   BEGIN; SELECT * FROM public.af3_assign_family_book(
--   'af3-concurrent-guest', '<UUID-B>', false); COMMIT;
-- Expected: A succeeds; B waits for A's transaction advisory lock, then
-- raises LIBRARY_FULL. Final count MUST be exactly 1.
-- Repeat 10 times with fresh guest IDs, reverse start order.
--
-- WARNING: Two sequential calls or Promise.all on ONE DB connection do not
-- prove transaction concurrency. Use two real PostgreSQL sessions.
-- DO NOT apply this test to the live Supabase project.
