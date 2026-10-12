-- ============================================================================
-- 0006_training_and_retention.sql — training records + retention cleanup.
-- ============================================================================

create extension if not exists "pgcrypto";

create table if not exists training_sessions (
  id             uuid primary key default gen_random_uuid(),
  user_id        text not null,
  report_id      uuid references interviews(id) on delete set null,
  session_id     uuid references interview_sessions(id) on delete set null,
  resume_id      uuid,
  topic_id       text not null,
  topic_label    text not null default '',
  action         text not null default 'explain',
  conversation   jsonb not null default '[]'::jsonb,
  schema_version integer not null default 1,
  revision       integer not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists training_sessions_user_recent_idx
  on training_sessions (user_id, updated_at desc);

create table if not exists training_attempts (
  id             uuid primary key default gen_random_uuid(),
  user_id        text not null,
  training_id    uuid not null references training_sessions(id) on delete cascade,
  exercise_id    text not null,
  exercise_version integer not null default 1,
  action         text not null,
  topic_id       text not null,
  answers        jsonb not null default '{}'::jsonb,
  score          integer,
  max_score      integer,
  provenance     jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now()
);

alter table if exists training_sessions enable row level security;
alter table if exists training_attempts enable row level security;

do $$
declare t text;
begin
  for t in select unnest(array['training_sessions','training_attempts']) loop
    begin
      execute format('revoke all on table %I from anon, authenticated', t);
    exception when undefined_table then null;
    end;
  end loop;
end $$;

-- Retention cleanup: failed/abandoned PDF objects ledger-side, expired sim
-- audits, orphaned outbox terminals. User transcripts/reports are NEVER
-- pruned here — only user-initiated deletion removes those.
create or replace function cleanup_expired_jobs(
  p_outbox_days int default 30, p_sim_days int default 14
) returns table (outbox_removed bigint, sims_removed bigint)
language plpgsql as $$
declare o bigint; s bigint;
begin
  delete from job_outbox where terminal_at < now() - make_interval(days => p_outbox_days);
  get diagnostics o = row_count;
  delete from interview_sims
   where created_at < now() - make_interval(days => p_sim_days)
     and status in ('failed','cancelled');
  get diagnostics s = row_count;
  return query select o, s;
end $$;
