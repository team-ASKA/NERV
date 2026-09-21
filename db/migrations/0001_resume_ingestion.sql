-- ============================================================================
-- 0001_resume_ingestion.sql
--
-- Async resume ingestion: job ledger, idempotency, per-user write locks.
--
-- Safe to re-run. Every statement is guarded, so this doubles as the bootstrap
-- for a fresh database and as a migration for the existing one (which already
-- has `interviews` and a simpler `resumes`).
--
-- Concurrency model
--   * Idempotency is enforced by a UNIQUE constraint, not by a read-then-write
--     check — two pods racing on the same upload cannot both win.
--   * Per-user writes serialize on a transaction-scoped advisory lock, so a
--     user uploading twice in the same second can't interleave two parses into
--     a torn row. The lock is released automatically at COMMIT/ROLLBACK, which
--     means a crashed worker never strands it.
--   * `resumes` carries a monotonic `version` for optimistic concurrency on the
--     read-modify-write paths that don't take the advisory lock.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- resumes: extend the existing table rather than replacing it.
-- ---------------------------------------------------------------------------

create table if not exists resumes (
  id          uuid primary key default gen_random_uuid(),
  user_id     text        not null,
  resume_data jsonb       not null default '{}'::jsonb,
  raw_text    text,
  created_at  timestamptz not null default now()
);

alter table resumes add column if not exists content_hash text;
alter table resumes add column if not exists strategy     text;
alter table resumes add column if not exists word_count   integer;
alter table resumes add column if not exists version      integer     not null default 1;
alter table resumes add column if not exists updated_at   timestamptz not null default now();

-- One stored resume per (user, exact file). Re-uploading the same bytes updates
-- in place instead of growing the table — this is what makes the ingest
-- endpoint safely retryable.
create unique index if not exists resumes_user_content_uniq
  on resumes (user_id, content_hash)
  where content_hash is not null;

create index if not exists resumes_user_recent_idx
  on resumes (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- resume_jobs: the ingestion ledger the API polls and the worker drives.
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_type where typname = 'resume_job_status') then
    create type resume_job_status as enum (
      'queued', 'extracting', 'parsing', 'persisting', 'done', 'failed', 'cancelled'
    );
  end if;
end $$;

create table if not exists resume_jobs (
  id               uuid primary key default gen_random_uuid(),
  user_id          text              not null,
  -- sha256(file bytes) scoped to the user. Never shared across users: the same
  -- resume uploaded by two accounts is two independent jobs.
  idempotency_key  text              not null,
  content_hash     text              not null,
  status           resume_job_status not null default 'queued',
  -- 'pdf_text' | 'vlm' — chosen by the router, recorded for observability.
  strategy         text,
  word_count       integer,
  page_count       integer,
  attempts         integer           not null default 0,
  error            text,
  resume_id        uuid references resumes (id) on delete set null,
  -- Set once the job leaves a terminal state so stuck jobs are findable.
  heartbeat_at     timestamptz,
  created_at       timestamptz       not null default now(),
  updated_at       timestamptz       not null default now(),
  finished_at      timestamptz
);

-- The idempotency guarantee. A duplicate enqueue hits this and is folded into
-- the existing job instead of creating a second one.
create unique index if not exists resume_jobs_idempotency_uniq
  on resume_jobs (idempotency_key);

create index if not exists resume_jobs_user_recent_idx
  on resume_jobs (user_id, created_at desc);

-- Partial index: the sweeper only ever scans unfinished work.
create index if not exists resume_jobs_active_idx
  on resume_jobs (status, heartbeat_at)
  where status in ('queued', 'extracting', 'parsing', 'persisting');

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------

create or replace function touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists resumes_touch on resumes;
create trigger resumes_touch before update on resumes
  for each row execute function touch_updated_at();

drop trigger if exists resume_jobs_touch on resume_jobs;
create trigger resume_jobs_touch before update on resume_jobs
  for each row execute function touch_updated_at();

-- ---------------------------------------------------------------------------
-- Advisory lock helper.
--
-- Transaction-scoped so it cannot leak: if the worker dies mid-parse, Postgres
-- releases the lock when the connection's transaction aborts. Callers must be
-- inside an explicit transaction for this to mean anything.
-- ---------------------------------------------------------------------------

create or replace function lock_user_resume(p_user_id text) returns void
language sql as $$
  select pg_advisory_xact_lock(hashtextextended('resume:' || p_user_id, 0));
$$;

-- ---------------------------------------------------------------------------
-- claim_resume_job: atomically create-or-return a job.
--
-- Returns the job row plus `is_new`, so the caller can tell a fresh enqueue
-- (push to BullMQ) from a duplicate (just report status). The ON CONFLICT makes
-- this safe under concurrent identical requests: exactly one caller sees
-- is_new = true.
-- ---------------------------------------------------------------------------

create or replace function claim_resume_job(
  p_user_id         text,
  p_idempotency_key text,
  p_content_hash    text
)
returns table (
  id      uuid,
  status  resume_job_status,
  is_new  boolean
)
language plpgsql as $$
declare
  v_id     uuid;
  v_status resume_job_status;
begin
  insert into resume_jobs (user_id, idempotency_key, content_hash)
  values (p_user_id, p_idempotency_key, p_content_hash)
  on conflict (idempotency_key) do nothing
  returning resume_jobs.id, resume_jobs.status into v_id, v_status;

  if v_id is not null then
    return query select v_id, v_status, true;
    return;
  end if;

  -- Lost the race (or a genuine retry): hand back the existing job.
  return query
    select j.id, j.status, false
    from resume_jobs j
    where j.idempotency_key = p_idempotency_key;
end $$;

-- ---------------------------------------------------------------------------
-- finish_resume_job: persist the parse and close the job in one transaction.
--
-- Takes the per-user advisory lock before upserting so concurrent jobs for the
-- same user serialize here rather than racing the unique index and failing.
-- ---------------------------------------------------------------------------

create or replace function finish_resume_job(
  p_job_id       uuid,
  p_user_id      text,
  p_content_hash text,
  p_resume_data  jsonb,
  p_raw_text     text,
  p_strategy     text,
  p_word_count   integer
)
returns uuid
language plpgsql as $$
declare
  v_resume_id uuid;
begin
  perform lock_user_resume(p_user_id);

  insert into resumes (user_id, resume_data, raw_text, content_hash, strategy, word_count)
  values (p_user_id, p_resume_data, p_raw_text, p_content_hash, p_strategy, p_word_count)
  on conflict (user_id, content_hash) where content_hash is not null
  do update set
    resume_data = excluded.resume_data,
    raw_text    = excluded.raw_text,
    strategy    = excluded.strategy,
    word_count  = excluded.word_count,
    version     = resumes.version + 1
  returning resumes.id into v_resume_id;

  update resume_jobs
     set status      = 'done',
         resume_id   = v_resume_id,
         strategy    = p_strategy,
         word_count  = p_word_count,
         error       = null,
         finished_at = now()
   where resume_jobs.id = p_job_id;

  return v_resume_id;
end $$;

-- ---------------------------------------------------------------------------
-- prune_user_resumes: keep the N most recent per user.
--
-- Raw resume text is the heaviest column in the database and the least useful
-- once superseded. Called after a successful ingest.
-- ---------------------------------------------------------------------------

create or replace function prune_user_resumes(p_user_id text, p_keep integer default 3)
returns integer
language plpgsql as $$
declare
  v_deleted integer;
begin
  with keep as (
    select id from resumes
     where user_id = p_user_id
     order by created_at desc
     limit p_keep
  )
  delete from resumes
   where user_id = p_user_id
     and id not in (select id from keep);

  get diagnostics v_deleted = row_count;
  return v_deleted;
end $$;

-- ---------------------------------------------------------------------------
-- reap_stalled_jobs: recover work orphaned by a worker that died mid-job.
--
-- BullMQ has its own stalled-job detection; this is the database-side backstop
-- so the UI never polls a job that no worker will ever touch again.
-- ---------------------------------------------------------------------------

create or replace function reap_stalled_jobs(p_stale_after interval default interval '5 minutes')
returns integer
language plpgsql as $$
declare
  v_count integer;
begin
  update resume_jobs
     set status      = 'failed',
         error       = 'Worker stopped responding; please retry.',
         finished_at = now()
   where status in ('extracting', 'parsing', 'persisting')
     and coalesce(heartbeat_at, updated_at) < now() - p_stale_after;

  get diagnostics v_count = row_count;
  return v_count;
end $$;
