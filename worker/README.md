# NERV worker

The background half of NERV. A long-lived Node process that consumes two BullMQ
queues:

| Queue | Job | What it does |
| --- | --- | --- |
| `resume-ingest` | `ResumeIngestJob` | Downloads the uploaded PDF, extracts text, routes thin text layers to a vision model, structures the result, writes `resumes`, prunes old versions, then schedules simulations. |
| `interview-sim` | `InterviewSimJob` | Runs a full interview against a synthetic candidate, one round per job. Writes the primed opening question for each round; on sampled runs, critiques the whole transcript. |

**This does not deploy to Vercel.** A serverless function cannot hold a queue
subscription open, and the ingest path uses `pg` directly against a connection
pool. Deploy it as a container or a process: Railway, Render, Fly.io, ECS, or a
plain systemd unit.

---

## Why a worker at all

Resume ingestion is the one slow thing on the user's critical path. A scanned
PDF routed through a vision model takes tens of seconds — far past a serverless
function's timeout, and far too long to hold an HTTP request open. So the
upload endpoint enqueues and returns a job id, the browser polls
`/api/resume/job/[id]`, and the work happens here with retries and backpressure.

Everything the worker does is idempotent, because at-least-once delivery means
every job will occasionally run twice:

- **Claim, don't check.** `claim_resume_job` / `claim_sim_job` resolve
  create-vs-fold-vs-revive in one statement behind a UNIQUE index on the
  idempotency key, so two pods racing the same upload produce one row.
- **Serialize per user, not globally.** Both claims take a transaction-scoped
  `pg_advisory_xact_lock`, which releases at COMMIT/ROLLBACK — a pod that is
  SIGKILLed mid-transaction strands nothing. Resume locks and sim locks use
  different namespace prefixes so an audit can never block an upload.
- **Heartbeat, and sweep from the database.** BullMQ's stalled detection only
  covers jobs it still knows about. `reap_stalled_jobs()` and
  `reap_stalled_sims()` run every 60s as the backstop, and every stranding path
  ends in `failed` — a state the claim functions can revive — never in a state
  that would turn an idempotency key into a tombstone.

---

## Requirements

Node 20. Redis 6+ (or Valkey / Upstash / Redis Cloud). Postgres 14+ via
Supabase or otherwise.

### Migrations, in order

```bash
psql "$DATABASE_URL" -f db/migrations/0001_resume_ingestion.sql
psql "$DATABASE_URL" -f db/migrations/0002_interview_simulation.sql
```

`0002` **must** follow `0001`: it depends on the `pgcrypto` extension and the
`touch_updated_at()` trigger function that `0001` creates. Both files are
idempotent — safe to re-run on every deploy.

### Environment

See the WORKER section of [`.env.example`](../.env.example) for the full list
with defaults. The four that are fatal if missing:

| Variable | Note |
| --- | --- |
| `REDIS_URL` | BullMQ broker. `rediss://` for TLS. |
| `DATABASE_URL` | Postgres. **Use the transaction pooler** — see below. |
| `SUPABASE_URL` | Storage host for the uploaded PDFs. |
| `SUPABASE_SERVICE_ROLE_KEY` | Storage download auth. Bypasses RLS: worker-only, never in a browser bundle. |

`GROQ_API_KEY` / `GEMINI_API_KEY` are not fatal but nearly so: without a model
provider, resumes are parsed by heuristics only, scanned PDFs are rejected, and
the simulation consumer refuses to start rather than mark empty openers `done`.

#### DATABASE_URL: use the transaction pooler

On Supabase that is **port 6543**, not 5432:

```
postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:6543/postgres
```

Every replica holds its own pool of `DB_POOL_MAX` (default 8) connections.
Direct connections at 4 replicas would be 32 of a 60-connection budget before
anything else connects; the pooler multiplexes them. This is safe here because
every database function the worker calls is transaction-scoped — the advisory
locks included, which is exactly why `pg_advisory_xact_lock` was chosen over
the session-scoped variant. **Do not** add `SET`-based session state, prepared
statements that outlive a transaction, or `LISTEN`/`NOTIFY` without moving to
the session pooler first.

---

## Running it

```bash
cd worker && npm install
```

Local development against the root `.env`:

```bash
npm run dev
```

Production:

```bash
npm run build && npm start
```

`build` emits to `dist/`, and because `shared/` lives outside this package the
compiled entrypoint is `dist/worker/src/index.js` — which is what `npm start`
runs. Don't "fix" that path.

### Health endpoints

The process serves both on `PORT` (default 8080):

- **`GET /healthz`** — liveness. Always 200 while the process is alive, and
  deliberately does not touch Redis or Postgres: a dependency blip should get
  the job retried, not the container killed.
- **`GET /readyz`** — readiness. 200 only when it is consuming *and* Redis,
  Postgres and Storage all answer. On 503 the body names the exact missing
  variables and which checks failed.

Point your platform's health check at `/healthz` and your deploy gate at
`/readyz`.

### Missing config does not crash

A crash-looping container tells an operator only that it crashed. This one
stays up, logs each missing variable with what it is for, serves a `/readyz`
that lists them, and starts consuming on the next deploy once they appear.

### Shutdown

`SIGTERM`/`SIGINT` stop intake, wait up to 25s for in-flight jobs, then close
Redis, the pool and the HTTP server. Give the platform a termination grace
period of **at least 30s** (Kubernetes' default is 30; Railway and Render are
fine out of the box). A job cut off mid-flight would be retried anyway, but
finishing cleanly saves the user a duplicate parse.

---

## Scaling

Scale horizontally; the queues make it safe. The knobs, and what actually binds:

| Variable | Default | What it controls |
| --- | --- | --- |
| `INGEST_CONCURRENCY` | 4 | Resume jobs in flight per pod. IO- and API-bound, so it can exceed the core count. |
| `SIM_CONCURRENCY` | 2 | Simulation jobs in flight per pod. |
| `LLM_RPM` | 90 | Token bucket on outbound model calls, **per pod**. |
| `DB_POOL_MAX` | 8 | Postgres connections per pod. |

The real ceiling is `LLM_RPM × replicas` against your provider's account limit —
not the concurrency numbers. Raise concurrency and you queue inside the limiter;
raise replicas without lowering `LLM_RPM` and you get 429s from Groq.

Resume ingestion and simulation run as **two separate `Worker` instances**, not
two job names on one, so a burst of audits — tens of model calls each — cannot
starve the queue a user is actually waiting on.

### What it costs per resume

After each successful ingest the worker interviews a synthetic candidate:

- **prime** — 3 model calls, unconditional. One opening question per round,
  read later by `GET /api/interview/openers`, so the candidate's first question
  costs no model time at all. This is the latency the candidate feels most: it
  is the one turn they wait through with nothing on screen.
- **audit** — ~34 model calls, sampled at `SIM_AUDIT_RATE` (default 0.05).
  Replays a full interview across all three rounds with one of four candidate
  personas and critiques every interviewer turn, so a prompt regression is
  caught by us rather than by a candidate mid-round.

Sampling is deterministic on the resume's content hash — disjoint slices of the
hash pick *whether* to audit and *which* persona — so a retried enqueue makes
the same decision instead of rolling the dice again.

Set `SIM_AUDIT_RATE=0` to keep priming and stop auditing. Set
`ENABLE_INTERVIEW_SIM=false` to turn off both; ingestion is unaffected either
way, since `scheduleSimulations` swallows its own failures and can never fail an
ingest that has already landed.

---

## Layout

```
worker/src/
  index.ts        entrypoint: consumers, health server, sweeper, shutdown
  config.ts       every env var is read here and nowhere else
  db.ts           pg pool + query helper
  redis.ts        ioredis connections (one per queue)
  queues.ts       producer-side Queue handles
  storage.ts      Supabase Storage download/delete
  jobs/
    resumeIngest.ts   the ingest pipeline
    scheduleSims.ts   producer: claims and enqueues prime + sampled audit
    interviewSim.ts    consumer: one round per job, self-chaining
  extract/
    pdfText.ts   pdf.js text layer
    pdfjs.ts     pdf.js setup for Node
    vlm.ts       vision fallback for scanned PDFs
    structure.ts text -> structured resume
  agents/
    interviewer.ts  the production persona, offline
    candidate.ts    synthetic candidate, four personas
    critic.ts       deterministic + model critique of interviewer turns
  llm/
    groq.ts      client
    limiter.ts   token bucket
```

`shared/` (one level up) is compiled into both this package and the frontend.
Because this tree is `moduleResolution: NodeNext`, **imports of `shared/` here
must carry an explicit `.js` extension** — `'../../shared/simulation.js'`. The
`api/` and `src/` trees import the same files extensionlessly. That asymmetry is
real and intentional; matching the tree you are editing is the whole rule.
