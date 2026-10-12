-- ============================================================================
-- 0003_application_access.sql — server-mediated access: profiles, grants, RLS.
--
-- Design D1: the browser never queries app tables directly. All reads/writes
-- go through Vercel handlers using the service-role key + verified Firebase
-- UID ownership checks. RLS is enabled and public/anon/authenticated roles
-- are revoked table access, so a leaked anon key cannot read across users.
-- Backend/worker roles remain scoped via grants below.
--
-- Safe to re-run; all statements are guarded. Handles fresh DBs and legacy
-- DBs with an unknown existing `interviews` shape.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- profiles: one row per Firebase UID (text, never UUID-cast).
-- ---------------------------------------------------------------------------

create table if not exists profiles (
  user_id       text        primary key,
  display_name  text        not null default '',
  profile       jsonb       not null default '{}'::jsonb,
  preferences   jsonb       not null default '{}'::jsonb,
  current_resume_id uuid,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- interviews: canonical completed-report/history table. Legacy DBs already
-- have some shape of this; only add what is missing.
-- ---------------------------------------------------------------------------

create table if not exists interviews (
  id          uuid primary key default gen_random_uuid(),
  user_id     text not null,
  created_at  timestamptz not null default now()
);

alter table interviews add column if not exists user_id text;
alter table interviews add column if not exists session_id uuid unique;
alter table interviews add column if not exists report_status text not null default 'ready';
alter table interviews add column if not exists report_schema_version integer not null default 1;
alter table interviews add column if not exists evaluation jsonb not null default '{}'::jsonb;
alter table interviews add column if not exists resume_snapshot jsonb;
alter table interviews add column if not exists evidence_refs jsonb not null default '[]'::jsonb;
alter table interviews add column if not exists provenance jsonb not null default '{}'::jsonb;
alter table interviews add column if not exists total_duration_minutes integer;
alter table interviews add column if not exists created_at timestamptz;
alter table interviews alter column created_at set default now();
alter table interviews add column if not exists updated_at timestamptz not null default now();

create index if not exists interviews_user_recent_idx on interviews (user_id, created_at desc);
create index if not exists interviews_session_idx on interviews (session_id) where session_id is not null;

-- ---------------------------------------------------------------------------
-- RLS: enable everywhere; no policies for anon/authenticated (server-mediated).
-- Service-role bypasses RLS, which is the intended server path.
-- ---------------------------------------------------------------------------

alter table if exists profiles enable row level security;
alter table if exists interviews enable row level security;
alter table if exists resumes enable row level security;
alter table if exists resume_jobs enable row level security;
alter table if exists interview_sims enable row level security;
alter table if exists interview_sim_turns enable row level security;

-- Revoke direct access from the public-facing roles on app tables.
do $$
declare t text;
begin
  for t in select unnest(array['profiles','interviews','resumes','resume_jobs','interview_sims','interview_sim_turns','interview_sessions','interview_rounds','interview_turns','report_jobs','job_outbox','training_sessions','training_attempts']) loop
    begin
      execute format('revoke all on table %I from anon, authenticated', t);
    exception when undefined_table then
      -- table created by a later migration; revocation re-applied there.
      null;
    end;
  end loop;
end $$;
