-- AJK R2 PRIVATE AUDIO - PROPOSED SCHEMA FOR A SEPARATE TEST PROJECT
-- NOT applied to the production Supabase project.
-- Apply only after a backup and after Supabase Auth users have been set up.
-- Keep existing audio_books, audio_chapters and listening_progress intact.
-- Migrate existing audio_books.id/audio_chapters.id as book/chapter IDs when possible.

create table if not exists public.books (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(trim(title)) > 0),
  cover_url text,
  description text,
  is_published boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.chapters (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references public.books(id) on delete restrict,
  chapter_number integer not null check (chapter_number >= 0),
  title text not null,
  r2_file_key text not null unique check (
     length(r2_file_key) between 1 and 1024
     and r2_file_key !~ '(^/|(^|/)\.\.(/|$))'
  ),
  byte_size bigint check (byte_size is null or byte_size > 0),
  sha256 text check (sha256 is null or sha256 ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  unique(book_id, chapter_number)
);
create index if not exists chapters_book_id_idx on public.chapters (book_id);

-- This is for a FUTURE Supabase Auth model. Existing private family codes
-- from Apps Script are NOT auth.users UUIDs and must not be inserted here.
create table if not exists public.user_access (
  user_id uuid not null references auth.users(id) on delete cascade,
  book_id uuid not null references public.books(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, book_id)
);
create index if not exists user_access_book_idx on public.user_access (book_id);

-- Private server-only tables: no direct browser access.
alter table public.books enable row level security;
alter table public.chapters enable row level security;
alter table public.user_access enable row level security;

revoke all on table public.books, public.chapters, public.user_access
  from anon, authenticated;
grant select, insert, update, delete
  on table public.books, public.chapters, public.user_access to service_role;

comment on table public.books is
  'R2 pilot: protected audiobook editions, not yet wired to author website';
comment on table public.chapters is
  'Private R2 object keys; never store presigned URLs in database';
comment on table public.user_access is
  'Explicit access grants for verified Supabase Auth users only';
