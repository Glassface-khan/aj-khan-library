create table public.audiobook_download_jobs (
 id uuid primary key default gen_random_uuid(),
 audio_book_id uuid not null references public.audio_books(id) on delete cascade,
 source_fingerprint text not null,
 status text not null default 'queued' check(status in ('queued','building','ready','failed')),
 progress_done integer not null default 0,
 progress_total integer not null default 0,
 worker_run_id bigint,
 files jsonb not null default '[]'::jsonb,
 error_detail text,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(audio_book_id,source_fingerprint)
);
alter table public.audiobook_download_jobs enable row level security;
revoke all on public.audiobook_download_jobs from anon,authenticated;
grant all on public.audiobook_download_jobs to service_role;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 values('audiobook-downloads','audiobook-downloads',false,49000000,array['audio/mp4','application/zip'])
 on conflict(id) do nothing;