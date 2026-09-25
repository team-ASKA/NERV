-- ============================================================================
-- 0002_interview_simulation.sql
--
-- Offline interview simulation: the agents that interview a synthetic candidate
-- with the production persona, so that
--   * the opening question of every round is already written before the
--     candidate presses Start (the `prime` purpose), and
--   * a regression in the interviewer prompt is found by us on a sampled audit
--     rather than by a candidate mid-interview (the `audit` purpose).
--
-- Safe to re-run. Same concurrency model as 0001: idempotency through a UNIQUE
-- index rather than read-then-write, per-user serialization on a
-- transaction-scoped advisory lock, heartbeats plus a sweeper as the
-- database-side backstop to BullMQ's own stalled-job detection.
--
-- Depends on 0001 for `pgcrypto` and `touch_updated_at()`.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- interview_sims: one row per simulation, whatever its round count.
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_type where typname = 'sim_status') then
    create type sim_status as enum (
      'queued', 'running', 'critiquing', 'done', 'failed', 'cancelled'
    );
  end if;
end $$;

create table if not exists interview_sims (
  id              uuid       primary key default gen_random_uuid(),
  user_id         text       not null,
  -- 'prime' | 'audit'. See shared/simulation.ts for what each costs.
  purpose         text       not null check (purpose in ('prime', 'audit')),
  -- Audit only: which synthetic candidate answered.
  persona         text       check (persona in ('strong', 'average', 'weak', 'rambling')),
  -- sha256 of the resume this sim was built from — its version identifier.
  content_hash    text       not null,
  idempotency_key text       not null,
  status          sim_status not null default 'queued',
  -- { "technical": "…", "core": "…", "hr": "…" } — what the live path reads.
  openers         jsonb      not null default '{}'::jsonb,
  -- Deterministic + model findings, accumulated a round at a time.
  findings        jsonb      not null default '[]'::jsonb,
  -- 0..1, share of interviewer turns with no error-level finding. Audit only.
  score           real,
  verdict         text,
  attempts        integer    not null default 0,
  error           text,
  heartbeat_at    timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  finished_at     timestamptz
);

-- The idempotency guarantee: re-uploading the same resume folds into the sim
-- that already ran for it instead of paying for the tokens twice.
create unique index if not exists interview_sims_idempotency_uniq
  on interview_sims (idempotency_key);

-- The hot-path lookup: "do we already have openers for this user's current
-- resume?" Must be a single index hit — it runs while the candidate waits.
create index if not exists interview_sims_primed_idx
  on interview_sims (user_id, content_hash, purpose)
  where status = 'done';

create index if not exists interview_sims_user_recent_idx
  on interview_sims (user_id, created_at desc);

-- Partial index: the sweeper only ever scans unfinished work.
create index if not exists interview_sims_active_idx
  on interview_sims (status, heartbeat_at)
  where status in ('queued', 'running', 'critiquing');

-- ---------------------------------------------------------------------------
-- interview_sim_turns: the simulated transcript.
--
-- Kept out of the parent row because an audit produces tens of turns and the
-- parent is read on the live path, where dragging a full transcript into a
-- lookup for one opener would be wasteful. Text only — a simulation never has
-- audio or video to begin with.
-- ---------------------------------------------------------------------------

create table if not exists interview_sim_turns (
  sim_id             uuid        not null references interview_sims (id) on delete cascade,
  round              text        not null check (round in ('technical', 'core', 'hr')),
  idx                integer     not null,
  role               text        not null check (role in ('interviewer', 'candidate')),
  content            text        not null,
  latency_ms         integer,
  -- Interviewer turns: quality of the answer this turn responded to, so an
  -- audit can check that difficulty actually tracked answer quality.
  prior_answer_score real,
  created_at         timestamptz not null default now(),
  primary key (sim_id, round, idx)
);

-- The primary key is also the turn-level idempotency guarantee: a round that is
-- retried after a partial failure overwrites its turns instead of doubling them.

-- ---------------------------------------------------------------------------
-- updated_at maintenance (trigger function comes from 0001)
-- ---------------------------------------------------------------------------

drop trigger if exists interview_sims_touch on interview_sims;
create trigger interview_sims_touch before update on interview_sims
  for each row execute function touch_updated_at();

-- ---------------------------------------------------------------------------
-- Advisory lock helper. Transaction-scoped, released at COMMIT/ROLLBACK, so a
-- worker that dies mid-simulation never strands it.
--
-- A different namespace prefix from `lock_user_resume` on purpose: a sim must
-- not block an upload, and an upload must not block a sim.
-- ---------------------------------------------------------------------------

create or replace function lock_user_sim(p_user_id text) returns void
language sql as $$
  select pg_advisory_xact_lock(hashtextextended('sim:' || p_user_id, 0));
$$;

-- ---------------------------------------------------------------------------
-- claim_sim_job: atomically create, revive, or return a simulation.
--
-- Called by the producer only — the per-round follow-up jobs already know their
-- sim id and must not re-claim. Returns the same two flags as
-- `claim_resume_job` so the caller knows whether to actually push to BullMQ:
--   is_new   — a fresh sim was created
--   requeued — a failed (or incomplete) sim was reset for another attempt
--
-- The revive path matters more here than for ingestion: a `prime` sim whose
-- openers are missing a round is useless, and without a way back it would keep
-- being folded into by its own idempotency key forever.
-- ---------------------------------------------------------------------------

drop function if exists claim_sim_job(text, text, text, text, text);

create or replace function claim_sim_job(
  p_user_id         text,
  p_idempotency_key text,
  p_content_hash    text,
  p_purpose         text,
  p_persona         text default null
)
returns table (
  id       uuid,
  status   sim_status,
  is_new   boolean,
  requeued boolean
)
language plpgsql as $$
declare
  v_id      uuid;
  v_status  sim_status;
  v_openers jsonb;
begin
  perform lock_user_sim(p_user_id);

  select s.id, s.status, s.openers into v_id, v_status, v_openers
    from interview_sims s
   where s.idempotency_key = p_idempotency_key;

  if v_id is null then
    insert into interview_sims (user_id, idempotency_key, content_hash, purpose, persona)
    values (p_user_id, p_idempotency_key, p_content_hash, p_purpose, p_persona)
    on conflict (idempotency_key) do nothing
    returning interview_sims.id, interview_sims.status into v_id, v_status;

    if v_id is not null then
      return query select v_id, v_status, true, false;
      return;
    end if;

    -- Lost a race the lock should have prevented; fall through and read it.
    select s.id, s.status, s.openers into v_id, v_status, v_openers
      from interview_sims s
     where s.idempotency_key = p_idempotency_key;
  end if;

  if v_status = 'failed' then
    update interview_sims
       set status      = 'queued',
           error       = null,
           finished_at = null,
           attempts    = 0
     where interview_sims.id = v_id;

    return query select v_id, 'queued'::sim_status, false, true;
    return;
  end if;

  -- A sim that finished without producing an opener for every round did not
  -- actually do its job — the live path would fall back to a live LLM call for
  -- the missing round, which is the cost priming exists to remove.
  if v_status = 'done'
     and p_purpose = 'prime'
     and coalesce((select count(*) from jsonb_object_keys(coalesce(v_openers, '{}'::jsonb))), 0) < 3
  then
    update interview_sims
       set status      = 'queued',
           error       = null,
           finished_at = null,
           attempts    = 0
     where interview_sims.id = v_id;

    return query select v_id, 'queued'::sim_status, false, true;
    return;
  end if;

  return query select v_id, v_status, false, false;
end $$;

-- ---------------------------------------------------------------------------
-- record_sim_turn: append one turn, idempotently.
--
-- An upsert rather than an insert because a round that fails halfway is retried
-- from its first turn: the second run must overwrite the turns of the first,
-- not sit beside them.
-- ---------------------------------------------------------------------------

create or replace function record_sim_turn(
  p_sim_id             uuid,
  p_round              text,
  p_idx                integer,
  p_role               text,
  p_content            text,
  p_latency_ms         integer default null,
  p_prior_answer_score real    default null
) returns void
language sql as $$
  insert into interview_sim_turns
    (sim_id, round, idx, role, content, latency_ms, prior_answer_score)
  values
    (p_sim_id, p_round, p_idx, p_role, p_content, p_latency_ms, p_prior_answer_score)
  on conflict (sim_id, round, idx) do update set
    role               = excluded.role,
    content            = excluded.content,
    latency_ms         = excluded.latency_ms,
    prior_answer_score = excluded.prior_answer_score;
$$;

-- ---------------------------------------------------------------------------
-- finish_sim_round: store a round's opener and its findings.
--
-- `openers` is merged rather than replaced so the three per-round jobs can land
-- in any order, and findings are concatenated. A retried round replaces its own
-- opener; its findings are deduplicated by the caller, which knows the round.
-- ---------------------------------------------------------------------------

create or replace function finish_sim_round(
  p_sim_id   uuid,
  p_round    text,
  p_opener   text,
  p_findings jsonb default '[]'::jsonb
) returns void
language sql as $$
  update interview_sims
     set openers  = openers || jsonb_build_object(p_round, p_opener),
         -- Drop any findings this round produced on a previous attempt before
         -- adding the new ones, so a retry does not double-count them.
         findings = (
           select coalesce(jsonb_agg(f), '[]'::jsonb)
             from jsonb_array_elements(findings) f
            where f ->> 'round' is distinct from p_round
         ) || coalesce(p_findings, '[]'::jsonb),
         status   = case when status = 'queued' then 'running'::sim_status else status end,
         heartbeat_at = now()
   where id = p_sim_id;
$$;

-- ---------------------------------------------------------------------------
-- finish_sim_job / fail_sim_job: close the simulation.
-- ---------------------------------------------------------------------------

create or replace function finish_sim_job(
  p_sim_id  uuid,
  p_score   real default null,
  p_verdict text default null
) returns void
language sql as $$
  update interview_sims
     set status      = 'done',
         score       = coalesce(p_score, score),
         verdict     = coalesce(p_verdict, verdict),
         error       = null,
         finished_at = now()
   where id = p_sim_id
     and status not in ('done', 'failed', 'cancelled');
$$;

create or replace function fail_sim_job(
  p_sim_id uuid,
  p_error  text
) returns void
language sql as $$
  update interview_sims
     set status      = 'failed',
         error       = left(p_error, 500),
         finished_at = now()
   where id = p_sim_id
     and status not in ('done', 'failed', 'cancelled');
$$;

create or replace function touch_sim_heartbeat(p_sim_id uuid) returns void
language sql as $$
  update interview_sims set heartbeat_at = now() where id = p_sim_id;
$$;

-- ---------------------------------------------------------------------------
-- get_primed_openers: the live path's single read.
--
-- Scoped by user as well as content hash so a guessed hash returns nothing, and
-- filtered to `prime` so an audit's openers — written for a synthetic candidate
-- in a persona — can never be spoken to a real one.
--
-- The hash is optional because the browser does not keep one: it hashes a file
-- at upload time and forgets it. When it is omitted the lookup pins itself to
-- the user's newest resume, which is the same row the client reads its resume
-- from, so the opener and the interview are grounded in the same document.
-- Openers written against a resume the candidate has since replaced would be
-- about work they no longer claim.
-- ---------------------------------------------------------------------------

create or replace function get_primed_openers(p_user_id text, p_content_hash text default null)
returns jsonb
language sql stable as $$
  select s.openers
    from interview_sims s
   where s.user_id = p_user_id
     and s.purpose = 'prime'
     and s.status = 'done'
     and s.content_hash = coalesce(
           p_content_hash,
           (select r.content_hash
              from resumes r
             where r.user_id = p_user_id
             order by r.created_at desc
             limit 1))
   order by s.created_at desc
   limit 1;
$$;

-- ---------------------------------------------------------------------------
-- get_sim: one round trip for an operator or a status endpoint.
-- ---------------------------------------------------------------------------

create or replace function get_sim(p_sim_id uuid, p_user_id text)
returns table (
  id          uuid,
  purpose     text,
  persona     text,
  status      sim_status,
  openers     jsonb,
  findings    jsonb,
  score       real,
  verdict     text,
  attempts    integer,
  error       text,
  created_at  timestamptz,
  finished_at timestamptz
)
language sql stable as $$
  select s.id, s.purpose, s.persona, s.status, s.openers, s.findings, s.score,
         s.verdict, s.attempts, s.error, s.created_at, s.finished_at
    from interview_sims s
   where s.id = p_sim_id
     and s.user_id = p_user_id;
$$;

-- ---------------------------------------------------------------------------
-- prune_user_sims: keep the N most recent per user.
--
-- Simulated transcripts are pure diagnostics; once a newer resume version has
-- been primed, the older sim's turns are dead weight. Turns cascade on delete.
-- ---------------------------------------------------------------------------

create or replace function prune_user_sims(p_user_id text, p_keep integer default 4)
returns integer
language plpgsql as $$
declare
  v_deleted integer;
begin
  with keep as (
    select id from interview_sims
     where user_id = p_user_id
     order by created_at desc
     limit p_keep
  )
  delete from interview_sims
   where user_id = p_user_id
     and id not in (select id from keep);

  get diagnostics v_deleted = row_count;
  return v_deleted;
end $$;

-- ---------------------------------------------------------------------------
-- reap_stalled_sims: recover simulations orphaned by a dead worker.
--
-- More patient than `reap_stalled_jobs` (10 minutes rather than 5): a full
-- audit legitimately runs for minutes, and nobody is staring at a spinner
-- waiting for it.
--
-- Also sweeps sims stranded in `queued`, on a much longer fuse. A producer that
-- claims a row and is killed before the enqueue lands leaves no job behind it,
-- and `queued` is not a state anything else recovers from — the idempotency key
-- would fold every future upload of that resume into a row that never runs.
-- Failing it is the cheap fix: `claim_sim_job` revives a `failed` sim. The fuse
-- is long because a sim between rounds is also `queued`, and the cost of failing
-- one early is a re-run, not a wrong answer.
-- ---------------------------------------------------------------------------

create or replace function reap_stalled_sims(p_stale_after interval default interval '10 minutes')
returns integer
language plpgsql as $$
declare
  v_stalled integer;
  v_orphans integer;
begin
  update interview_sims
     set status      = 'failed',
         error       = 'Worker stopped responding.',
         finished_at = now()
   where status in ('running', 'critiquing')
     and coalesce(heartbeat_at, updated_at) < now() - p_stale_after;

  get diagnostics v_stalled = row_count;

  update interview_sims
     set status      = 'failed',
         error       = 'Never picked up by a worker.',
         finished_at = now()
   where status = 'queued'
     and updated_at < now() - (p_stale_after * 3);

  get diagnostics v_orphans = row_count;

  return v_stalled + v_orphans;
end $$;
