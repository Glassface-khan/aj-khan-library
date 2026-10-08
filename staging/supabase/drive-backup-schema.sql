create table public.audiobook_drive_backups (
 id uuid primary key default gen_random_uuid(),
 audio_book_id uuid not null references public.audio_books(id) on delete cascade,
 source_fingerprint text not null,
 status text not null default 'queued' check(status in ('queued','copying','ready','failed','connection_required')),
 worker_run_id bigint,
 folder_id text,
 files jsonb not null default '[]'::jsonb,
 progress_done integer not null default 0,
 progress_total integer not null default 0,
 error_detail text,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(audio_book_id,source_fingerprint)
);
alter table public.audiobook_drive_backups enable row level security;
revoke all on public.audiobook_drive_backups from public,anon,authenticated;
grant all on public.audiobook_drive_backups to service_role;
