-- ============================================================================
-- 0005_job_outbox_reports.sql — outbox + report jobs with attempt fencing.
-- ============================================================================

create extension if not exists "pgcrypto";

create table if not exists report_jobs (
  id             uuid primary key default gen_random_uuid(),
  session_id     uuid not null references interview_sessions(id) on delete cascade,
  user_id        text not null,
  report_version integer not null default 1,
  status         text not null default 'queued'
                 check (status in ('queued','running','done','failed')),
  run_id         uuid not null default gen_random_uuid(),
  attempt        integer not null default 0,
  heartbeat_at   timestamptz,
  error_code     text,
  retryable      boolean not null default true,
  provenance     jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (session_id, report_version)
);

create index if not exists report_jobs_pending_idx
  on report_jobs (status, created_at) where status in ('queued','running');

create table if not exists job_outbox (
  event_id       uuid primary key default gen_random_uuid(),
  kind           text not null,
  aggregate_id   uuid,
  business_key   text not null unique,
  run_id         uuid not null,
  payload        jsonb not null default '{}'::jsonb,
  payload_version integer not null default 1,
  available_at   timestamptz not null default now(),
  lease_owner    text,
  lease_expires_at timestamptz,
  dispatched_at  timestamptz,
  terminal_at    timestamptz,
  attempts       integer not null default 0,
  created_at     timestamptz not null default now()
);

create index if not exists job_outbox_available_idx
  on job_outbox (available_at) where terminal_at is null;

alter table if exists report_jobs enable row level security;
alter table if exists job_outbox enable row level security;

do $$
declare t text;
begin
  for t in select unnest(array['report_jobs','job_outbox']) loop
    begin
      execute format('revoke all on table %I from anon, authenticated', t);
    exception when undefined_table then null;
    end;
  end loop;
end $$;

-- Bounded lease of available outbox events (dispatcher calls this, then
-- enqueues to Redis AFTER the transaction commits).
create or replace function lease_outbox_events(p_owner text, p_limit int, p_lease_secs int)
returns setof job_outbox
language sql as $$
  update job_outbox o set lease_owner = p_owner,
    lease_expires_at = now() + make_interval(secs => p_lease_secs),
    attempts = o.attempts + 1
  where o.event_id in (
    select event_id from job_outbox
     where terminal_at is null
       and available_at <= now()
       and (lease_owner is null or lease_expires_at < now())
     order by available_at asc
     limit p_limit
     for update skip locked
  )
  returning *;
$$;
