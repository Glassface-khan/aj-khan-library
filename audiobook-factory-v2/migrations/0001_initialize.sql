-- AJK Audiobook Factory 2.0 — ISOLATED TEST DATABASE ONLY.
-- ADMIN-ONLY: no family accounts in V2, no admin credentials, raw book text or secret URLs.
-- All admin verification is delegated to the existing Google Apps Script; no access-codes table.
-- The existing Apps Script Access sheet remains the authority for book rights.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS books (
  id TEXT PRIMARY KEY NOT NULL,
  site_book_id TEXT,
  title TEXT NOT NULL,
  description TEXT,
  cover_url TEXT,
  language_code TEXT NOT NULL CHECK (language_code IN ('DE','EN')),
  voice_name TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','review','ready','withdrawn')),
  is_published INTEGER NOT NULL DEFAULT 0 CHECK (is_published IN (0,1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS books_site_and_id ON books(site_book_id,id);
CREATE INDEX IF NOT EXISTS books_status_title ON books(status,is_published,title);

CREATE TABLE IF NOT EXISTS chapters (
  id TEXT PRIMARY KEY NOT NULL,
  book_id TEXT NOT NULL REFERENCES books(id) ON DELETE RESTRICT,
  chapter_number INTEGER NOT NULL CHECK(chapter_number>=0),
  title TEXT NOT NULL,
  duration_seconds REAL CHECK(duration_seconds IS NULL OR duration_seconds>=0),
  r2_key TEXT NOT NULL UNIQUE CHECK(length(r2_key)>0 AND r2_key NOT LIKE '/%'
                 AND r2_key NOT LIKE '%/../%'),
  sha256 TEXT CHECK(sha256 IS NULL OR length(sha256)=64),
  byte_size INTEGER CHECK(byte_size IS NULL OR byte_size>0),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(book_id,chapter_number)
);
CREATE INDEX IF NOT EXISTS chapters_book_order ON chapters(book_id,chapter_number);

-- Reserved for author-only playback; backend read/write endpoints are NOT implemented yet.
CREATE TABLE IF NOT EXISTS listening_progress (
  listener_id TEXT NOT NULL,
  chapter_id TEXT NOT NULL REFERENCES chapters(id) ON DELETE RESTRICT,
  position_seconds REAL NOT NULL DEFAULT 0,
  speed REAL NOT NULL DEFAULT 1.0,
  completed INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY(listener_id,chapter_id)
);

CREATE TABLE IF NOT EXISTS production_jobs (
  id TEXT PRIMARY KEY NOT NULL,
  title TEXT NOT NULL,
  language_code TEXT NOT NULL CHECK(language_code IN ('DE','EN')),
  voice_key TEXT NOT NULL,
  stage TEXT NOT NULL DEFAULT 'awaiting_source'
    CHECK(stage IN ('awaiting_source','awaiting_voice_preflight','samples_building',
    'samples_ready','samples_rejected','approved_to_produce','producing',
    'qc_hold','ready_not_published','published','failed','cancelled')),
  source_r2_key TEXT,
  source_sha256 TEXT,
  qc_status TEXT NOT NULL DEFAULT 'not_started',
  author_approved_at TEXT,
  error_code TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS jobs_stage_created ON production_jobs(stage,created_at);

CREATE TABLE IF NOT EXISTS voice_samples (
  id TEXT PRIMARY KEY NOT NULL,
  job_id TEXT NOT NULL REFERENCES production_jobs(id) ON DELETE RESTRICT,
  sample_type TEXT NOT NULL CHECK(sample_type IN ('beginning','middle','end')),
  source_text_hash TEXT,
  r2_key TEXT NOT NULL,
  transcript_similarity REAL,
  clipping_ratio REAL,
  silence_ratio REAL,
  words_per_minute REAL,
  qc_status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(job_id,sample_type)
);

CREATE TABLE IF NOT EXISTS publication_log (
  id TEXT PRIMARY KEY NOT NULL,
  book_id TEXT NOT NULL REFERENCES books(id) ON DELETE RESTRICT,
  action TEXT NOT NULL,
  actor_listener_id TEXT NOT NULL,
  occurred_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- NO DELETE operations are exposed from the Worker in the initial release.
-- Deleting old Supabase objects requires a separately approved manifest.
