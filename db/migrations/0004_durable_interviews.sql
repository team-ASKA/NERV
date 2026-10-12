-- ============================================================================
-- 0004_durable_interviews.sql — sessions, rounds, turns, CAS checkpoint RPCs.
-- ============================================================================

create extension if not exists "pgcrypto";

create table if not exists interview_sessions (
  id                uuid primary key default gen_random_uuid(),
  user_id           text        not null,
  resume_id         uuid,
  resume_snapshot   jsonb,
  resume_hash       text,
  status            text        not null default 'active'
                    check (status in ('active','paused','complete','abandoned')),
  current_round     text        not null default 'technical'
                    check (current_round in ('technical','core','hr')),
  duration_minutes  integer     not null default 10,
  input_mode        text        not null default 'both',
  prompt_version    text        not null default 'v1',
  rubric_version    text        not null default 'v1',
  revision          integer     not null default 0,
  active_lease      text,
  lease_expires_at  timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  started_at        timestamptz not null default now(),
  paused_at         timestamptz,
  completed_at      timestamptz
);

create index if not exists interview_sessions_user_recent_idx
  on interview_sessions (user_id, updated_at desc);
create index if not exists interview_sessions_user_active_idx
  on interview_sessions (user_id, status) where status in ('active','paused');

create table if not exists interview_rounds (
  session_id      uuid not null references interview_sessions(id) on delete cascade,
  round           text not null check (round in ('technical','core','hr')),
  status          text not null default 'pending'
                  check (status in ('pending','active','complete')),
  elapsed_ms      integer not null default 0,
  question_budget integer not null default 8,
  last_seq        integer not null default 0,
  code_text       text,
  code_language   text,
  terminal_reason text,
  updated_at      timestamptz not null default now(),
  primary key (session_id, round)
);

create table if not exists interview_turns (
  id             uuid primary key default gen_random_uuid(),
  session_id     uuid not null references interview_sessions(id) on delete cascade,
  round          text not null check (round in ('technical','core','hr')),
  turn_uuid      uuid not null,
  seq            integer not null,
  role           text not null check (role in ('interviewer','candidate')),
  text           text not null,
  delivered_text text,
  question_id    uuid,
  status         text not null default 'complete'
                 check (status in ('complete','interrupted')),
  expression_note text,
  created_at     timestamptz not null default now(),
  unique (session_id, turn_uuid),
  unique (session_id, round, seq)
);

create index if not exists interview_turns_session_round_idx
  on interview_turns (session_id, round, seq);

alter table if exists interview_sessions enable row level security;
alter table if exists interview_rounds enable row level security;
alter table if exists interview_turns enable row level security;

do $$
declare t text;
begin
  for t in select unnest(array['interview_sessions','interview_rounds','interview_turns']) loop
    begin
      execute format('revoke all on table %I from anon, authenticated', t);
    exception when undefined_table then null;
    end;
  end loop;
end $$;

-- Atomic checkpoint: CAS on revision + idempotent turn insert.
create or replace function checkpoint_session(
  p_session uuid, p_owner text, p_expected int,
  p_round text, p_elapsed int,
  p_turns jsonb, p_code text, p_lang text
) returns int
language plpgsql as $$
declare v_rev int;
begin
  select revision into v_rev from interview_sessions
   where id = p_session and user_id = p_owner for update;
  if not found then raise exception 'not_found' using errcode = 'P0001'; end if;
  if v_rev is distinct from p_expected then
    raise exception 'revision_conflict' using errcode = 'P0002';
  end if;

  insert into interview_rounds (session_id, round, status, elapsed_ms, code_text, code_language)
  values (p_session, p_round, 'active', p_elapsed, p_code, p_lang)
  on conflict (session_id, round) do update set
    elapsed_ms = excluded.elapsed_ms,
    code_text = excluded.code_text,
    code_language = excluded.code_language,
    updated_at = now();

  -- Idempotent per turn UUID; same id + different payload → conflict handled
  -- by caller comparing existing row (409), not by silent overwrite.
  insert into interview_turns (session_id, round, turn_uuid, seq, role, text, delivered_text, question_id, status)
  select p_session, p_round,
         (t->>'turnId')::uuid, (t->>'seq')::int, t->>'role', t->>'text',
         nullif(t->>'deliveredText',''), nullif(t->>'questionId','')::uuid,
         coalesce(t->>'status','complete')
    from jsonb_array_elements(p_turns) as t
  on conflict (session_id, turn_uuid) do nothing;

  update interview_sessions
     set revision = revision + 1, updated_at = now(),
         current_round = p_round
   where id = p_session;
  select revision into v_rev from interview_sessions where id = p_session;
  return v_rev;
end $$;
