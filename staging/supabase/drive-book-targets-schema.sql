create table public.audiobook_drive_targets (
 book_key text primary key,
 folder_id text not null check (folder_id ~ '^[a-zA-Z0-9_-]{10,200}$'),
 updated_at timestamptz not null default now()
);
alter table public.audiobook_drive_targets enable row level security;
revoke all on public.audiobook_drive_targets from public,anon,authenticated;
grant all on public.audiobook_drive_targets to service_role;
