# NERV — full revamp implementation plan

Version 1.0 · 13 October 2026 · based on the current repository, not the older pitch architecture.

This document is an execution specification for an implementing agent. The companion [task ledger](docs/NERV_IMPLEMENTATION_TASKS.md) defines work packages and acceptance evidence. Read [the production audit](PRODUCTION_READINESS.md) for supporting findings. This plan supersedes the earlier eight-phase plan where they disagree. No implementation task is marked complete merely because a similarly named file already exists.

## 1. Outcome and boundaries

Ship a reliable, polished practice interview product in the existing React/Vite + Vercel architecture. A candidate can sign in, upload a resume, check the extracted facts, start a three-round interview, answer by voice or text, leave/recover safely, receive a saved evidence-based report, and practise a specific topic through a working graph and tutor.

The dashboard should help the candidate take the next useful action with minimal decisions. The graph should be a working navigation tool, not decorative evidence of a score. Camera analysis remains an optional, honest expression observation feature. Preserve the near-black/indigo aesthetic, Inter/Montserrat, local MP4 avatar, and optional Spline landing artwork.

Keep:

- React 18, Vite, TypeScript, Tailwind and Vercel functions.
- Firebase authentication; Supabase Postgres and private resume Storage.
- Existing BullMQ worker for PDF ingestion and optional simulations.
- One professional resume-grounded interviewer with separate round rubrics.
- Monaco as a technical scratchpad; do not execute code on the server.
- Sarvam speech adapters and optional Hume, subject to current contract verification.
- vis-network/vis-data for the interactive map, with a usable topic-list alternative.

Do not add Next.js, LangGraph, MongoDB, another auth provider, server code execution, recruiter dashboards, candidate ranking, billing, or social features to this release. Campus screening remains a possible deployment context, but this release does not establish a validated autonomous hiring assessment. Any claims about awards, deployments, testimonials, and employer outcomes must be verified before publication.

The target is a working vertical slice first, then polish and operational proof. A phase may be buildable without being publicly launchable. Production access/credentials, live device tests, and deployment verification remain explicit gates; fixtures cannot pass them.

## 2. Reconcile the old plan with the real starting point

| Older claim/task | Actual baseline | Implementing action |
| --- | --- | --- |
| Four separate interview loops | `useInterviewSession` and `InterviewRoom` already serve the round pages. | Repair lifecycle/retry/state behavior and add persistence; do not introduce another engine. |
| Two hostile/supportive live engines | `api/interview/next.ts` and shared prompt contracts already unify generation. | Verify every path uses this layer; retire only genuinely unused code. |
| Missing VAD/streaming | VAD wrapper, streaming LLM, sentence TTS exist. | Test real endpointing/barge-in, fix cancellation and partial-stream semantics, pin compatible assets. |
| AI secrets in browser | Current inspected consumers use server-only AI keys. | Keep that boundary, add CI/bundle checks; do not assume previously named `VITE_` secrets still exist. |
| Missing design system | `ui/`, AppShell and tokens exist. | Improve accessibility and adoption; avoid building a parallel component library. |
| Firebase is auth only | AuthContext/signup/dashboard still read/write Firestore profiles. | Migrate profiles to Supabase and remove Firestore application use. |
| No async ingestion | API, two SQL migrations, worker and Redis queue already exist. | Fix IDs/retry/reconciliation, make extraction safe, and add reproducible deployment. |
| Hume is sole emotion path | Local MediaPipe plus Hume fallback exist. | Local by default; explicit cloud opt-in; no fabricated readings. |
| Delete Results/server/old services | Many listed files are already absent. | Build an import/route inventory before deleting. Do not recreate obsolete modules to satisfy the old plan. |
| Groq Llama 3.1 + Gemini 1.5/2.0 defaults | Current provider lifecycle has moved on. | Select currently accessible models per account, through validated config. |

Baseline evidence: clean install fails because root lockfile is stale; app typecheck has nine diagnostics; API/worker checks lack installed queue/worker dependencies; lint crashes; frontend build passes with a 3.37 MB main chunk. Only `.env.example` is available. Preserve unrelated `interview.md` and any user changes. Never use a broad cleanup/reset to make the tree look clean.

## 3. Architecture decisions to follow

### D1. One authenticated server boundary for application data

Use Firebase ID tokens on all application API calls. Route profile, resume metadata, sessions, history, reports, and training persistence through Vercel handlers. The browser does not query/mutate Supabase tables directly. Storage uploads remain browser-to-Storage through narrowly scoped signed upload URLs.

Reason: the app already verifies Firebase tokens server-side; extending that boundary is a smaller, clearer change than maintaining both direct Firebase-to-Supabase third-party auth and API authorization. Backend derives UID from the verified token, checks ownership, and never trusts a body `userId`. RLS is still enabled on app tables; revoke public/anon/authenticated table and mutation-RPC access for this server-mediated design. Backend credentials remain privileged and server-only, so application ownership checks and restricted DB worker roles remain mandatory.

Consequences:

- Replace `supabaseInterviewService` internals with authenticated API calls before removing imports of `src/lib/supabase.ts`.
- New browser deploys do not require Supabase public credentials unless a verified SDK-based Storage flow needs them; prefer PUT to signed URL so they can be retired.
- Firebase becomes auth only after a safe profile migration. Temporary Firestore compatibility is explicitly time-limited.
- A future direct-client data design requires a separate ADR and RLS/third-party-auth tests; agents must not introduce one silently.

### D2. Client controls the live interaction; server owns durable state

The browser controls the live transcript, VAD, draft text, media, and scratchpad. Compact checkpoints are persisted to owned server sessions. Durable turns, resume snapshot, round state, and report are the recovery source. Serverless handlers remain stateless between invocations; do not use module Maps for user sessions.

For generation, identify the session/round/turn request. Server resolves the pinned resume and validates submitted recent turns against the persisted sequence. Use the client's just-captured answer immediately after its checkpoint succeeds; do not independently re-fetch and re-submit it in two paths. The server does not ingest webcam frames unless the user explicitly chose cloud analysis; raw audio exists only transiently for transcription.

### D3. Extend existing tables with additive migrations

Retain `resumes`, `resume_jobs`, `interview_sims`, `interview_sim_turns` and existing `interviews` rows. Add `profiles`, `interview_sessions`, `interview_rounds`, `interview_turns`, `report_jobs`, `job_outbox`, and minimal `training_sessions`/`training_attempts`. Use `interviews` as the canonical completed-report/history table rather than introducing an overlapping `results` table.

Migrations must handle both a fresh database and a deployed legacy database with unknown existing `interviews` shape. Inspect a schema-only dump when credentials become available; do not assume production matches code interfaces. Migration files are append-only after deployment. Backfills are separate, idempotent, bounded jobs with a dry-run/count mode.

### D4. Persist before generating final reports

Finalization atomically marks the session complete, snapshots all round artifacts, and creates a report job/outbox entry. API responds with pending report status. Worker generates a schema-validated report, persists it to `interviews`, and marks the job terminal. Report route polls/backoffs or refreshes status. Provider failure does not erase the transcript or pretend a report exists.

The first durable session slice can ship before report jobs are connected, showing a transcript-only report with a clearly unavailable written evaluation. The production release requires report retry/recovery and real generation. Do not add a second ephemeral client-only summary save.

### D5. Models are deployment configuration, not permanent product decisions

Keep Groq primary and Gemini fallback where accessible. A current model/voice contract must be verified against the target account. Text, vision, report, and interviewer needs differ. All prompts/rubrics and relevant model selection carry versions. Simulations use the production interviewer prompt/model config, but their output is never evidence about a real candidate.

Groq documents retired Llama defaults for free/developer tiers with enterprise exceptions; Google documents Gemini 2.0 retirement and an unmaintained legacy SDK. Sarvam's current TTS contract differs from the repository payload. These require adapter work, not just new secrets. [Groq lifecycle](https://console.groq.com/docs/deprecations), [Gemini lifecycle](https://ai.google.dev/gemini-api/docs/deprecations/), [Google libraries](https://ai.google.dev/gemini-api/docs/libraries), [Sarvam TTS](https://docs.sarvam.ai/api-reference/text-to-speech/convert).

### D6. Assessment and expression remain separate

Text/code answer evidence drives competency feedback and difficulty. Expression observations may soften phrasing, offer a pause, or change pacing; they do not determine correctness, confidence in ability, hiring suitability, or pass/fail. Preserve optional expression readouts, but label their heuristic interpretation and provenance. No face/no model/stale frames means unavailable, not zero. Unmentioned topics are unassessed, not weak.

### D7. Development without credentials is a first-class workflow

Add deterministic development-only fixtures and mocked API responses for every important UI state. Explicit demo mode is visibly labelled, isolated from production credentials/data, and rejected by production config/build rules. No silent mock scores or synthetic interviews in real user history. Without configuration, render a setup/unavailable view and disable affected actions truthfully. A no-key UI run is a valid UI check, not a successful live integration check.

## 4. Product journeys and information architecture

Primary journey: landing → sign in → dashboard → upload/verify resume → start → technical/core/HR → saved report → practise selected topic.

Returning journey: dashboard → resume paused interview or start another → latest report → one recommended practice action.

Routes (preserve aliases during migration):

| Route | Meaning |
| --- | --- |
| `/`, `/login`, `/signup`, `/forgot-password` | Public/identity flows. |
| `/dashboard` | Minimal next-action page. |
| `/interviews/new` | Optional setup/device confirmation; reuse current setup until migrated. |
| `/interviews/:sessionId` | Recoverable interview container; round comes from durable session. |
| `/reports/:sessionId` | Addressable pending/ready/failed/transcript-only report. |
| `/reports/legacy/:interviewId` | Existing historical row without a durable session; backend applies the same owner check. |
| `/history` | Paginated full history, not a dashboard tab. |
| `/training?reportId=…&topicId=…&action=explain` | Durable, validated context; action also supports quiz/flashcards/deep-dive. |
| `/settings` | Profile, devices/preferences, privacy, account management. |

Old `/multi-round-interview`, round routes, `/nerv-summary`, and `/training-session` remain guarded adapters until all links migrate. Handle old navigation-state reports with a compatibility view; do not discard historical rows. Unknown URLs show a useful 404. Login preserves safe same-origin `returnTo`. Report/history ownership errors return 404, not data revealing whether another user's ID exists.

## 5. Minimal dashboard specification

### 5.1 Layout

Use AppShell with a compact header: NERV, Dashboard, Practice, History, account menu. Desktop content max-width 1,120 px; consistent 24–32 px section spacing. Mobile has a visible accessible menu. No permanent large sidebar.

The first viewport contains:

1. Short greeting and one sentence of useful status.
2. One primary next-action panel: upload resume, resume interview, or start interview.
3. Compact resume status/replace control.
4. Latest completed report or pending report status.

Below this, show at most three recent sessions and one recommended practice topic with `Practise topic`. A small `View skill map` disclosure opens the graph only on demand; the graph is not a large, always-mounted dashboard panel. Full profile forms, salary/LinkedIn details, resume links, graph explorer, history pagination, and broad metric cards move to relevant secondary surfaces.

### 5.2 State-to-action rules

| User state | Primary CTA | Secondary affordance |
| --- | --- | --- |
| No valid resume | `Upload resume` | Small `Try a general interview` link, clearly generic. |
| File selected | Automatically upload after validation | Cancel before upload; retry same file on error. No second mandatory Upload button. |
| Ingesting | Inline stage/status; no Start CTA for that pending resume | Existing ready resume can still start; distinguish it from the replacement. |
| Parsed, needs review | `Review resume` | Explicitly show extracted facts, not invented numeric resume strength. |
| Ready, no active interview | `Start interview` | `Replace resume`; last-used duration/input preferences. |
| Active recoverable interview | `Resume interview` | Start new with explicit abandon/keep choice. |
| Completed, report pending | `View report status` | Start another remains a secondary action. |
| Report ready | `Start interview` | Latest report and recommended practice below. |
| Data fetch failed | Inline retry for the failed section | Healthy sections stay usable; empty history is not substituted for failure. |

Default full interview remains three rounds and 10 minutes per round unless last-used preference changes it. Display `Up to 30 minutes; rounds may finish earlier`. Keep 5/10/15 options in a compact disclosure rather than a forced setup page. Starting without a resume requires an explicit general-practice choice, not silent generic fallback after a failed resume fetch.

Upload stage lives in a persistent panel and survives navigation/reload through job metadata. A toast supplements the panel; it is not the sole record of progress/failure. Successful resume replacement changes the current pointer only after extraction/review succeeds; failed replacement leaves the prior ready resume intact.

### 5.3 Components and data hooks

Extract `DashboardNextAction`, `ResumeStatusCard`, `LatestReportCard`, `RecentInterviewList`, and `SuggestedPractice`. Use `useDashboardData` for a composed endpoint response. State transitions belong in an explicit `deriveDashboardState` function, not scattered booleans.

`GET /api/dashboard` should return profile, current resume metadata, one active session, one latest report, three recent sessions, and a practice suggestion. Backend executes independent reads in parallel, selects compact fields, and returns section-level errors only where safe. Avoid fetching all transcripts or all historical rows into the dashboard. Session/history counts must come from server aggregates when needed.

Acceptance: first-time user reaches upload in one click and starts after successful parse/review without profile completion; returning user resumes in one click; no more than one primary CTA per panel; 360 px viewport works without horizontal scroll; keyboard focus proceeds in reading order; empty/loading/error states have distinct copy.

## 6. Visual system and reusable UI behavior

Keep palette around `#080808` and `#6366F1`. Use surface/border/text tokens consistently; indigo signals actions/selection, not every decoration. Prefer flat panels and restrained shadows. Body 14–16 px, secondary copy at least 12–13 px where readable; no 9 px operational labels. Use consistent 8/12/16/24/32 spacing, 40–44 px control heights, and clear hover/focus/disabled states. Preserve the type families with stable fallbacks and self-host if feasible.

Improve existing primitives:

- Button defaults `type="button"`, loading state, labelled icon controls, disabled semantics.
- Inputs/textarea associate labels, descriptions, errors; stable IDs; `aria-invalid` and `aria-describedby`.
- Modal handles accessible name, initial focus, focus trap, restoration, Escape, bounded scrolling, and background inertness. Adopt a small proven accessible primitive if hand-maintaining these behaviors becomes brittle; do not add a second visual system.
- Tabs have appropriate roles and keyboard navigation; compact menus work on touch.
- Toasts are announced appropriately and do not duplicate blocking errors; long-lived failures have inline recovery.
- Skeletons match actual layout and avoid animated motion under reduced-motion preference.
- Dialogs/menus close deterministically on route changes; motion respects reduced motion.
- Print/report styling explicitly converts cards/borders/text to printable colors.

Landing uses real DOM headline/CTA at all breakpoints; Spline is optional lazy artwork with stable dimensions and a useful fallback. Auth uses the same primitives, working recovery, minimal signup, and no decorative Remember me control. Interview/training use `100dvh` with scrollable content and visible composer under mobile keyboard; responsive acceptance determines exact panel breakpoints.

## 7. Data model and migration contracts

All ownership fields are Firebase UID **text**, not UUID casts. All application record IDs are generated UUIDs. Use UTC timestamps. Add unique constraints, indexes, foreign keys, bounded JSON schemas in application validation, and schema-version fields where shapes evolve.

| Table | Required fields / invariants |
| --- | --- |
| `profiles` | `user_id` PK, display name, optional profile JSON, preferences JSON, `current_resume_id`, timestamps. Preferences contain duration/input/camera consent choices, not secrets. |
| `resumes` | Existing fields plus source filename/size, extraction schema version, review state, provenance/source references, immutable structured version/snapshot. Editing facts creates a version or audited revision; never mutates past session snapshots. |
| `interview_sessions` | `id`, `user_id`, `resume_id`, immutable resume snapshot/hash, status, current round, configured duration, input mode, prompt/rubric versions, revision, started/paused/completed times, actual elapsed total. |
| `interview_rounds` | Session+round unique, status, elapsed ms, remaining ms/deadline snapshot, question budget, last accepted sequence, compact code snapshot/language, terminal reason. |
| `interview_turns` | Session, round, turn UUID (client for answers, server for generated questions), server sequence, role, text, question/source IDs, status (`complete`/`interrupted`), timestamp, optional expression aggregate. Preserve generated text separately from delivered text when interrupted. Unique turn UUID within session and unique ordered sequence within round. |
| `interviews` | Existing report fields retained; add unique nullable session ID, report schema/version/status, structured evaluation JSON, resume snapshot, evidence references, generation provenance, timestamps. Old rows remain readable with a legacy adapter. |
| `report_jobs` | Session+report version/generation unique, status, attempt/run ID, heartbeat, error code, retryability, provider provenance, timestamps. |
| `job_outbox` | UUID event ID, kind, aggregate/job ID, attempt/run ID, payload/version, availability time, lease expiry/owner, dispatched/terminal timestamps, attempts. Unique business operation key per run. |
| `training_sessions` | Owner, source report/session, current topic/action, compact saved conversation, schema version, revision, timestamps. |
| `training_attempts` | Owner/session, generated exercise ID/version, action/topic, submitted answers, score only for valid quiz, retry/provenance fields. |

Report schema includes per-round observations, evaluated competency dimensions, evidence turn IDs, recommendations, unassessed topics, optional expression observations, and provenance. A number without a defined rubric/evidence is omitted. Quotes must reference actual candidate turns; validate substring/reference matches before presentation. Skill mention counts are separate from competency evidence.

Do not create a `profiles.email` duplicate unless needed; Firebase owns identity. Do not persist ID tokens, provider keys, base64 audio, webcam images/video, or raw provider error bodies. Store compact text/aggregates only; truncate/redact operator logs independently from persisted user evidence.

Migration order (proposed new files, inspect schema before implementing):

1. `0003_application_access.sql`: baseline `interviews` compatibility, profile/session/report tables as needed, indexes, RLS and grants. Existing deployments may require separate table creation/adaptation statements.
2. `0004_durable_interviews.sql`: rounds/turns/revisions/idempotent session RPCs.
3. `0005_job_outbox_reports.sql`: outbox/report jobs, attempt fencing and recovery functions.
4. `0006_training_and_retention.sql`: training records and cleanup functions.

Keep migrations reversible in rollout design even if automatic down migrations are inappropriate: deploy additive DB changes first, compatible backend second, client third; retain old readers until backfill finishes. Snapshot/backup and test restore before destructive cleanup. Historical `interviews` rows receive stable report routes, but must not be assigned guessed session IDs or resume snapshots.

Profiles migration: backend administrative script uses Firebase Admin only if needed to read Firestore with authorized credentials. Dry-run, counts, upsert per UID, preserve nonempty existing Supabase data, record completion. During cutover, new profile writes go only to Supabase; any temporary legacy reads are backend-only and visible in a migration log. Remove Firebase Firestore/Storage application imports after cutover, not before users' existing profile data is accounted for.

## 8. API contract specification

Use shared runtime schemas (a modest dependency such as Zod is acceptable) and inferred TypeScript contracts in `shared/`. Validate every endpoint's body/query. API authentication happens before paid work and before SSE headers. Responses use `{ data, requestId }` or `{ error: { code, message, retryable, retryAfterSeconds? }, requestId }`; never expose credentials/provider bodies/stacks. Return 400 validation, 401 identity, 404 nonowned/missing records, 409 revision/idempotency conflict, 413 oversized input, 429 quota, 503 unavailable capability, 502 bounded upstream failure. Methods set `Allow`; sensitive responses use `no-store`.

| Endpoint | Input → behavior |
| --- | --- |
| `GET /api/capabilities` | Nonsecret capability booleans and reason codes; no credential details. Production readiness is separate/private as appropriate. |
| `GET /api/dashboard` | Composed minimal current-user view. |
| `GET/PATCH /api/profile` | Validated profile/preferences; Firebase UID derived server-side. |
| `GET /api/resume/current` | Current ready/reviewable resume with ID/hash/provenance; distinguish none from failure. |
| Existing resume upload/ingest/job routes | Preserve signed upload workflow; extend response to actual `resumeId`, file metadata, review state and warnings. |
| `PATCH /api/resume/:id` | Reviewed structured facts with expected version; create revision, update current pointer. |
| `POST /api/sessions` | `requestId`, resume ID or explicit generic mode, duration/input preferences → owned session snapshot. |
| `GET /api/sessions/:id` | Compact recoverable session, current round, ordered turns and code. |
| `PATCH /api/sessions/:id/round` | Expected revision, round, appended turns, elapsed checkpoint, scratchpad → atomic validation/CAS; no caller owner IDs. |
| `POST /api/interview/next` | Session ID, round, turn request ID, expected revision and current answer checkpoint reference → streamed question. |
| `POST /api/sessions/:id/finalize` | Final expected revision/artifacts → complete once, queue report once, return report location/status. |
| `GET /api/history` | Cursor/limit filters → compact records. Default 20, hard max 50. |
| `GET /api/reports/:sessionId` | Owned structured/legacy report and job status. |
| `POST /api/reports/:sessionId/retry` | Retryable failed job → a new bounded attempt; no duplicate report row. |
| `DELETE /api/reports/:id` | Owned deletion with lifecycle defined; do not leave dangling public report routes. |
| Existing `/api/stt`, `/api/tts` | Validated bounded provider adapters; explicit absent/transient/empty result codes. |
| Existing `/api/emotion/token` | Auth+quota+explicit cloud preference; token returned `no-store`; never logged. |
| `GET/POST/PATCH /api/training…` | Owned context/session creation and checkpoint; action-specific schema outputs. |
| `/api/tutor` | Typed action, topic ID, training session ID, request ID, message/recent turns → conversation or validated exercise; do not encode every action as arbitrary prose. |

Vercel route files may combine methods where sensible; avoid creating dozens of functions purely to mirror the table. Check hosting-plan function count, duration, and body limits before final layout. No broad CORS allowance is needed for the selected same-origin design. If a separate API origin is later required, centralize base URL and an explicit origin allowlist; otherwise remove unused `VITE_API_URL`.

### 8.1 Checkpoint and multi-tab semantics

Append turns atomically with revision compare-and-swap and dedupe by turn UUID. Replaying an identical request returns the original acknowledgement; same ID with different payload returns 409. Sequence gaps/overlaps with changed content are rejected. A session is editable by one active tab lease at a time or explicitly conflicts; never last-write-wins entire transcript JSON. A lease timeout permits takeover with a visible explanation. Client cache/checkpoints are scoped by UID/session and cleared on logout.

Autosave after each completed candidate/interviewer turn, round transition, pause, and code debounce. Do not write every audio frame, token, or keystroke. A debounce around 1 second for scratchpad and bounded periodic checkpoint for elapsed time is sufficient; finalization flushes pending writes. Use a monotonic live clock, snapshot elapsed time to DB, and define pauses consistently. Background tabs cannot extend allocated active time through timer throttling.

Session duration records actual active round time. Browser unload cannot guarantee a last network write; recovery uses last acknowledged checkpoint. A lost unsaved segment is disclosed rather than invented. Partial interviewer text is marked interrupted, not retrospectively replaced with an unheard complete question.

### 8.2 SSE protocol

Define and share event schemas:

```ts
type InterviewEvent =
  | { type: 'start'; requestId: string; questionId: string; promptVersion: string }
  | { type: 'delta'; questionId: string; seq: number; text: string }
  | { type: 'complete'; questionId: string; text: string; revision: number; provider: string; model: string }
  | { type: 'error'; questionId?: string; code: string; retryable: boolean; partial: boolean };
```

Exactly one terminal complete/error event per stream. Client parser handles chunked UTF-8, multiple events/chunk, partial lines, empty deltas, unexpected EOF, and abort. Do not continue speaking after abort/route change. Provider fallback is allowed only before any user-visible text/audio has escaped. After a partial stream, preserve its interrupted status and ask the user to retry/repeat; do not append another provider's fresh question. Use response disconnection plus completion guards for cancellation. Explicit upstream deadlines apply to generation and response body consumption, not only fetch headers.

The generation handler commits the completed question with its server question/turn UUID before emitting `complete`, returning the new session revision. The browser reconciles that acknowledged turn; it does not append it again through checkpointing. During interruption, checkpoint delivered text/playback status against that question ID without erasing the original generated text; evaluation uses candidate answers and what was delivered. A DB commit failure is a retryable terminal error, not a completed question. This defines one owner for question persistence and avoids double writes between the stream handler and client autosave.

Question request IDs dedupe UI retries within a session. A claimed generation attempt has a lease; stale attempts can be retried without two attempts concurrently committing one question. Barge-in aborts the attempt/speech and persists the partial boundary. Exactly-once external model billing is not promised; application commits and UI turns must be idempotent.

## 9. Resume pipeline implementation

1. Unify the upload limit now: proposed 10 MiB PDF, max 12 pages for accepted files; one shared constant consumed by dashboard/API/worker/bucket. Current dashboard says 5 MB while shared contracts allow 10 MB. Adjust once if hosting/provider constraints require it, then update every layer.
2. Auto-upload on file selection/drop after shared validation. File extension/MIME are preliminary; worker verifies actual bytes, PDF signature/parser result, checksum, page count, render pixel budget, and decoding limits. Reject NaN/infinite/fractional claimed sizes and enforce actual limits after download.
3. Keep the direct signed URL. Provision a private bucket with allowed content types/size. Signed URL expiry comes from the actual Storage API contract, not a locally invented TTL. Signed upserts of the same hash are replay-safe; avoid overwriting active inputs without explicit version handling.
4. Text extraction first when usable. Use `looksColumnar`/quality indicators in routing instead of assuming all documents above 500 words require paid vision. Scanned PDFs require configured vision; unavailable vision returns a clear actionable error.
5. Vision processes bounded batches sized to the selected model's image/payload limits, maintains page order and document section continuity, and never silently drops later pages. Track pages read/total and warnings. Large malformed page dimensions cannot allocate unbounded canvas memory.
6. Extend section-aware structured extraction with schema validation and provenance. Extracted facts are claims, not endorsed truth. LLM instructions embedded in resumes are untrusted content and never override system prompts. No fabricated roles/skills from heuristic fallback.
7. Persist one structured version plus raw text bounded by retention policy, then atomically switch the user's current resume pointer when ready. Return actual resume ID/hash; current service incorrectly uses job ID as resume ID.
8. Add a compact review drawer/page: name, skills, projects, roles; highlight extraction warnings, allow edits, save revision. Default happy path is one confirmation; do not force every field to be retyped.
9. Session creation pins that exact reviewed version and hash. Primed openers require matching user+resume hash+prompt/model version; no newest-resume lookup races or stale account opener cache. A miss generates live.
10. Direct parser remains an explicitly configured local/basic fallback. It cannot silently claim scanning support or remote persistence. Default production full mode requires the worker and queue; queue outages keep the prior valid resume and show pending/retry truthfully.

Tests: text/scanned/multicolumn/two-page/four-page PDFs, repeated same hash, checksum mismatch, invalid MIME/oversize, encrypted/corrupt PDF, extraction empty result, edit/revision, two tabs uploading different files, reupload after old PDF cleanup, stale job completion versus current pointer. Fixtures contain synthetic resumes without real candidate PII.

## 10. Queue and worker correctness

Preserve DB business idempotency keys if useful, but never use colon-delimited values directly as BullMQ job IDs. Use a safe UUID or SHA-256-derived prefix/hyphen ID. [BullMQ ID contract](https://docs.bullmq.io/guide/jobs/job-ids).

Make the job ledger/outbox the durable source; Redis is a delivery mechanism. For resume/report/simulation scheduling:

1. Transaction creates or revives a job with a new run/attempt ID and inserts outbox event.
2. Dispatcher atomically leases available events using bounded batches (`FOR UPDATE SKIP LOCKED` or a reviewed equivalent); transaction ends before Redis/network calls.
3. Enqueue uses the event/run ID as BullMQ ID; marking dispatched after enqueue is replay-safe. Failed dispatch retains event for retry/backoff.
4. Consumer atomically claims the matching active run; heartbeats include run ID. DB writes/finish use that run token. Stale consumers cannot finalize/cancel a newer run.
5. Automatic BullMQ attempts stay within a run; user retry creates/retries runnable work intentionally. A failed retained Redis job cannot suppress a new run.
6. Reconciler handles queued-without-Redis, dispatched-without-consumer, stale running jobs, already-done redis replays, and committed-ingest-without-prime. Recovery is automatic and bounded; no user reupload needed to repair infra state.
7. Record terminal reason/error code; preserve diagnostic operator errors privately. Retry policy distinguishes network/429/5xx from checksum/invalid PDF/configuration failures.
8. Cleanup runs as scheduled worker work: failed/abandoned PDF objects, expired ledgers/transcripts/sim audits, orphaned references. Successful best-effort delete is supplemented by periodic reconciliation.

Worker command loads explicit worker env file locally; production env injected. Boot validates fatal configuration and serves health even if intentionally unready. Readiness checks DB/Redis/Storage and enabled required model capabilities with timeouts; health endpoints must never hang indefinitely. Verified Postgres/Redis TLS, least-privilege DB role, no secrets in logs, nonroot container, lockfile-based build, and graceful shutdown with a platform termination grace longer than the worker deadline.

Keep simulations optional. Enable priming after basic generation works; start audit sampling at zero, then controlled staging sampling. Outbox recovery and prompt/model/hash invalidation are required before relying on primed openings. Add report queue concurrency separate from ingestion so long reports/audits cannot starve uploads. Account-wide provider budgets apply across API+all worker replicas; per-process bucket alone is insufficient.

## 11. Voice and live interview behavior

Keep the hook and engine, but make state transitions explicit and testable:

`idle → preparing → generating/speaking → listening → transcribing → saving → generating`, with `paused`, `recoverable-error`, `finishing`, and `ended` branches. Separate streamed generation from audible playback; they may overlap but are not the same state.

Required invariants:

- One answer submission/generation at a time per engine; typed submit and VAD speech-end cannot both advance the turn.
- `Retry` retries the failed operation. Current retry always calls `askNext()`, including after a failed STT answer; preserve captured PCM in bounded memory long enough to retry transcription or offer typed recovery instead of skipping the answer.
- Unmount/end/account change cancels all upstream calls, clears playback queue and timers, destroys VAD/worklet, stops recorder/mic/camera, closes Hume socket, and ignores late completions using generation/request guards.
- Barge-in cancels queued and current TTS, aborts ongoing text stream, preserves what was actually delivered, then accepts one answer. No callbacks resurrect old audio after cancellation.
- Device check does not leave a second live mic or cached session-wide permission result that masks a newly denied device. Transfer ownership or release before room acquires it.
- Voice/typed choices are explicit. Mic denied/no VAD leads to push-to-talk or text; camera denied never prevents answering.
- STT never treats provider/network failure as silence. Keep the unsent answer available and surface retry/typing.
- Repeat speaks the same committed question without adding a duplicate turn or question count.
- Timer completion while transcribing/saving uses a defined policy: accept an already-captured answer within a bounded grace period, then finalize; do not lose it silently.

Sarvam adapter: explicit supported model and voice; enforce current text/audio contracts; normalize provider results; bounded timeouts and retry-after. Use current `text/language_code/speaker/model` contract where documented. Chunk TTS on complete sentences with a max-length fallback for long/no-punctuation streams; preserve abbreviations/code and ordered playback. At most two prefetched sentence requests initially; cancel outstanding ones on barge-in. Audio-context unlock occurs on user gesture.

VAD: pin compatible VAD/ONNX assets and CSP/self-host settings, measure endpointing with pauses/accents/background noise, and provide manual mode. Echo-cancellation support alone is not proof of perfect interruption quality; test speakers/headphones. Replace deprecated ScriptProcessor recorder with AudioWorklet or a verified browser codec path if necessary; prioritize a bounded working fallback before that optimization. Resample manual PCM to supported mono sample rate and enforce e.g. 90-second maximum answer/decoded audio size. Communicate the limit without an unexpected discard.

Interview room: primary column is current question/transcript/composer; small status/timer; avatar in a compact optional presence area. Camera/expression/code are secondary drawers/tabs on mobile. Monaco mounts only when Code opened, persists text/language, never implies execution. Round transitions preserve session and explain next round; avoid repeated setup/permissions.

## 12. Expression implementation

Use MediaPipe local mode by default. Remove automatic cloud escalation in `auto`: local failure must remain unavailable unless the user explicitly accepted cloud processing. Cloud preference is server-recorded per session/preferences and checked before minting a token; UI states that frames leave the device. Camera permission by itself is not cloud consent.

Use one interpretation schema for live read and report, with source, availability/reason, captured time, frame/sample count, heuristic dimensions, and schema version. Sample within the answer window; current all-session rolling state is not a precise measurement of one answer. Reset/restrict buffers at round/session/account boundaries, handle no-face/staleness, and stop work when camera off/paused. Do not claim reliability constants are calibrated probabilities.

MediaPipe CPU/GPU load and Hume frame rate must be bounded. Capture one low-resolution cloud frame at a configurable interval (initially around one second), with backpressure: if the socket/provider is busy, skip instead of queueing frames. Client logs never print frames/tokens. Token expiration/reconnect has bounded backoff and visible status; existing frame stream closes on exit. No report “composure score” when no reliable samples, and expression does not enter hiring/competency scoring.

## 13. vis-network workstream — make it actually work

### 13.1 Concrete current bugs to address

- `KnowledgeGraph` recreates Network on `data`, active selection, and callback identity changes; selecting a training topic can reset the viewport/physics.
- `handleNodeClick` invokes both explain and select; report currently wires both to navigation.
- Coverage is `mentionCount / totalQuestions`; multiple keyword mentions can produce values over 100%. Node size is based on depth, despite report copy claiming mention-based size.
- Summary and training implement different graph builders/classification. Raw labels as IDs collide; truncated labels are passed as topic identity.
- Training treats level-2 category nodes as topics; skill categories can initiate irrelevant tutoring.
- Hover-only context menu is difficult on mobile and can disappear while pointer moves into it; report copy says right-click, but graph has no right-click handler.
- Menu always exposes quiz/flashcards/deep-dive even if callbacks are missing, resulting in inert actions.
- Module/constructor failures after the first import check lack a reliable caught error path; async init may reject unhandled.
- Canvas is not a keyboard/screen-reader topic navigator; fixed-height boxes can mount at zero/hidden size.
- Direct Training navigation does not load a resume/report; `focusTopic` passed from report is not part of the declared/consumed route contract. Report quiz selection loses the intended action.

### 13.2 Canonical graph model

Create `shared/graph.ts` and `src/lib/graph/buildGraph.ts` (or a shared pure builder if worker needs it). Keep graph independent of provider output:

```ts
type TopicKind = 'root' | 'category' | 'skill' | 'project' | 'experience' | 'education' | 'achievement';
type TopicEvidence = 'unassessed' | 'discussed' | 'supported' | 'needs-practice';
interface TopicNode {
  id: string;                  // stable type + entity ID, never display-label parsing
  kind: TopicKind;
  label: string;               // full user-facing label
  shortLabel: string;          // presentation only
  sourceEntityId?: string;
  sourceText?: string;
  categoryId?: string;
  evidence: TopicEvidence;
  evidenceTurnIds: string[];
  discussedAnswerCount?: number;
  eligibleAnswerCount?: number;
  actionable: boolean;
}
interface TopicEdge { id: string; from: string; to: string; kind: 'contains' | 'uses' }
```

Source entity IDs persist in structured resumes; legacy string arrays normalize to stable deterministic IDs scoped to resume version, with collision handling. Normalize case/aliases carefully while retaining display labels; do not merge distinct entities just because short labels match. Every edge references existing nodes; no duplicates. Classification uses curated exact tokens/aliases instead of broad substring matches such as `go`, `ui`, `ci`. Projects link to skills only when source/evidence explicitly supports that relationship; inferred relationships must be labelled and optional.

Default graph shows source topics grouped by type/discipline. Unassessed is neutral; discussed is indigo; evidence-supported/needs-practice may use labelled badges and redundant shape/text cues. A keyword mention alone never creates `supported` or `needs-practice`. If percentages are displayed, count distinct candidate answer/question IDs, define denominator, exclude nonapplicable answers, and guarantee 0–100 by construction. Otherwise display `Discussed in 2 answers`, which is clearer. Node-size encoding must match legend and copy.

### 13.3 Rendering/lifecycle algorithm

1. Lazy import a verified compatible ESM/peer package entrypoint and required styles. Catch import, DataSet creation, and Network construction failures. Type refs/handlers with actual library types; remove `any` where contracts are known.
2. Mount one Network for one visible graph container lifetime. Keep node/edge DataSets in refs. Register handlers once; handlers read latest callbacks/data via refs. Cleanup removes listeners/observer/timers and calls `destroy()` once.
3. Diff node/edge IDs and apply DataSet add/update/remove. Remove stale edges before nodes; add nodes before edges. A selection change updates colors and `selectNodes`, not the instance. [Network API](https://visjs.github.io/vis-network/docs/network/), [DataSet API](https://visjs.github.io/vis-data/data/dataset.html).
4. Save viewport scale/position and optionally dragged positions keyed by user/resume/report. Restore on cosmetic updates; fit only on first nonempty mount, explicit Fit, or a meaningful filter transition. Selection or a tutor reply never auto-fits.
5. Observe container size/visibility. Only initialize/fit with nonzero dimensions; redraw when a tab/drawer becomes visible. Resize does not continuously restart physics. Font-ready layout is handled deliberately.
6. Use deterministic seed/layout for small resume graphs. Stabilize within a bounded time then stop physics; reduced-motion uses stable hierarchical/precomputed positions. Fit animation respects reduced motion. Bound zoom range and avoid unexpected page-scroll interception on mobile.
7. Large topic sets initially cap visible nodes (e.g. 80); collapse groups/search/filter before expanding. Do not silently omit source entities—show counts and `Show more`. Above budget, default to list view.
8. Failed graph shows accessible topics with retry; empty data shows upload/practice guidance; loading has a reserved-size skeleton. No blank canvas is an accepted terminal state.

### 13.4 Interaction contract

One click/tap selects a topic and opens an adjacent detail panel; it does **not** automatically spend an LLM call or navigate. Root/category selects/expands groups, never tutors by default. Detail panel includes full source text, evidence status, relevant transcript references, and explicit `Explain`, `Quiz`, `Flashcards`, `Deep dive` actions when available. Each action carries `{ topicId, action, sourceReportId, sourceResumeId }` and fires once.

Desktop may offer a right-click menu as a shortcut; keyboard menu button and mobile detail panel expose identical actions. If retaining NodeContextMenu, portal it, clamp to viewport, add focus/keyboard/escape handling, and make pointer handoff stable. Hide unsupported actions instead of rendering dead buttons. No functionality requires hover.

Provide search, category/evidence filters, Fit, zoom, and Graph/List toggle. Keyboard-accessible topic list is always available, not only on module failure; it shares selection/actions with canvas. Full labels/tooltips are safe text, not injected HTML. Choosing Quiz in report routes to training with action preserved; loading training from that URL reproduces context after refresh.

### 13.5 Graph acceptance suite

Mount/update/unmount under React StrictMode; count instance create/destroy calls. Selection/callback rerender must not create a new instance. Empty → populated, data replacement/removal, duplicate labels, long labels, invalid edges, unmeasured values, repeated mentions, mixed case, and 100-node fixture. Check viewport stable after selection, resize/tab reveal visible, failures show list, one action equals one request, category selection creates zero tutor calls. Browser tests cover drag/zoom/Fit, node click/detail/action, touch viewport, keyboard list/actions, reduced motion, route restore, and no stale listeners after repeated navigation. Screenshots alone do not prove graph interactions.

## 14. Training and report implementation

### Training

Resolve context from authenticated backend by report/topic IDs, otherwise load the current resume. Direct nav and reload must work. No required router-state blobs. Full topic identity/source text reaches the tutor; selected topic is updated in service context, not only UI state. Create a scoped tutor session instance per page/session; avoid singleton conversation leaking between users/routes.

Default desktop: topic list/optional graph left, conversation center, exercises open on demand. Mobile: conversation default with Topics and Exercise drawers. No permanent empty quiz/avatar columns. Clicking a topic selects; explicit action starts work. Preserve draft and request/answer recovery; cancellation on topic/session reset prevents old replies entering a new session.

Tutor output contracts:

- `explain`/conversation: text plus optional brief code/example, speech text separately.
- `quiz`: JSON array of exactly requested bounded questions/options/correct option/explanation with schema validation; malformed responses offer retry, never a falsely scored quiz.
- `flashcards`: typed front/back cards with reveal controls.
- `deep-dive`: brief structured lesson and one follow-up; avoid forcing a long lesson into a 500-token spoken-chat budget.

Give exercises appropriate token budgets; current four-question quiz shares a 500-token prose endpoint and brittle Markdown parser. Grade MCQ answers deterministically after submit; reveal answers then. Persist attempt/result/provenance and allow retry. Practice mode can deliver answer keys to the client, but do not describe it as a secure exam. Avoid reading quiz options/answer keys aloud automatically; speak a short “quiz ready” cue only if voice is enabled.

### Report

Route starts with clear pending/failed/ready/transcript-only state. Summary leads with actionable evidence and one next step, followed by round breakdown, supporting quotes, topic discussion/evaluation, optional expression observations. Skill map and transcript are secondary tabs/disclosures; print mode presents essential textual content, not canvas-only information.

Worker validates structured report and evidence references before save. Backend generates Markdown/presentation from validated content or keeps old Markdown as legacy fallback; UI does not scrape arbitrary headings to recover a rubric. Preserve source resume snapshot and prompt/model versions. Report generation retry is idempotent; refresh/revisit never duplicates history.

Export first supports verified browser print with readable colors/page breaks, optionally a static graph image plus textual legend. PDF generation is a later enhancement only if print is insufficient. Sharing defaults to local copy/download; no public report URLs or PII exposure without a separately designed consent/access mechanism. Reports remain owned/authenticated.

## 15. Configuration specification

Implement schemas in `src/lib/config.ts`, `api/_lib/config.ts`, and revised `worker/src/config.ts`. Defaults never hide malformed explicit values. Missing required production keys report exact variable names privately, not values; public capabilities contain generic reason codes. No SDK initializes invalid required config during module import.

| Group | Canonical variables / behavior |
| --- | --- |
| Browser auth | `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_APP_ID`; optional sender/measurement fields only if used. Firebase web API key is public—do not remove all `VITE_*_API_KEY` by regex. |
| Browser data | Retire Supabase anon/publishable variables after direct-table access removal. Compatibility aliases remain documented only until consumers migrate. |
| Browser UI/telemetry | `VITE_POSTHOG_KEY`, `VITE_POSTHOG_HOST`, `VITE_EMOTION_PROVIDER=mediapipe`, vision/model asset URLs. Optional analytics; preference/consent-aware lifecycle, reset on logout. |
| API auth/data | `FIREBASE_PROJECT_ID`, `SUPABASE_URL`, `SUPABASE_SECRET_KEY` canonical with temporary `SUPABASE_SERVICE_ROLE_KEY` alias, `RESUME_BUCKET`, `REDIS_URL`, explicit app mode. |
| AI text | `GROQ_API_KEY`, `GROQ_MODEL`, `GROQ_TEXT_MODEL`, `GEMINI_API_KEY`, new `GEMINI_MODEL`, optional report-specific model only if justified. Shared interviewer model/version used by simulations. |
| AI vision | `GROQ_VISION_MODEL` verified image-capable account model; model-specific image/token/payload config. Add fallback only when genuinely implemented. |
| Speech | `SARVAM_API_KEY`, new `SARVAM_STT_MODEL`, `SARVAM_TTS_MODEL`, `SARVAM_TTS_SPEAKER`; validated language/sample-rate settings. |
| Optional cloud vision | `HUME_API_KEY`, `HUME_SECRET_KEY`; feature disabled without keys and user consent. |
| Worker | `DATABASE_URL`, verified CA/TLS settings if required, `DB_POOL_MAX`, `PORT`, `LOG_LEVEL`, `NODE_ENV`, ingestion/sim/report concurrency, model quota, retention days, outbox intervals. |
| Local demo | Explicit dev-only mock flag; production rejects it and `ALLOW_UNVERIFIED_AUTH`. Prefer mocked Firebase/API flows over enabling claimed UID in real handlers. |

Document each variable's consumer, tier, required mode, default, validation, and secret status. Split `.env.example`, `worker/.env.example` and deployment matrix to prevent accidentally assuming root Vite env loads worker Node. Prefer Node 24 LTS, pinned consistently in both manifests/CI/container; verify hosting support and provider SDK/native module compatibility before adopting it. If implementation occurs later, recheck the supported LTS schedule. Resolve server aliases with blank-string handling and reject conflicting configured values where ambiguity could select a wrong project.

Recommended release modes: development demo; authenticated basic text mode (explicitly configured parser limitations); production full mode with Storage+DB+Redis+worker+LLM. Mode selection is explicit, not inferred from every failure. Voice/camera remain optional capabilities in production full mode. An outage changes availability; it does not silently convert real data into a demo.

## 16. Execution phases and gates

Each phase ends with an evidence entry in the task ledger, green relevant checks, and a working fixture journey. Release claims wait for the final gates. Implement tasks in dependency order; avoid a single huge simultaneous rewrite.

### Phase 0 — reproducible baseline and fixtures

Tasks: inventory imports/routes/env; repair lockfiles; install root/worker; pin supported runtime; fix types/lint; small meaningful tests and CI; boot-safe config; fixture harness. Test missing configuration startup. Introduce route lazy loading where low-risk. Remove only proven dead dependencies/code after import checks. Do not delete public MP4/PDF/model assets without usage verification.

Files: manifests/locks/tsconfigs/eslint, `src/lib/config.ts`, `api/_lib/config.ts`, worker config, `src/main.tsx`, `src/lib/firebase.ts`, `src/lib/supabase.ts`, test/fixture setup and `.github/workflows/ci.yml`.

Gate: clean install root+worker, all typechecks/lint/build, no import-time blank-screen crash, deterministic fixtures for dashboard/room/report/training, baseline bundle report. No production auth bypass.

### Phase 1 — data boundary and complete schema

Tasks: additive migrations/grants/private bucket; authenticated profile/resume/history/dashboard services; migrate browser data service to API; account-scoped caches/logout lifecycle; safe profile migration tool and compatibility adapters. Implement section error states without redesigning every page yet.

Files: migrations, `api/_lib/auth.ts`, `api/_lib/supabaseAdmin.ts`, new data repositories/handlers, existing data/resume/AuthContext services.

Gate: fresh DB bootstrap and legacy migration fixture; owner/nonowner tests; direct anon RPC/table denial; own history/resume succeeds; profile and cache cannot cross users. Ready for safe authenticated basic text workflow.

### Phase 2 — minimal dashboard and auth/app shell

Tasks: improved primitives, mobile nav, minimal dashboard per section 5; auto-upload UI with mocked progress then real current endpoint; preferences in settings; reset password and safe login return; first-time journey and truthful failures. Keep older round/report routes working during this phase.

Files: UI primitives/AppShell/Navbar, Dashboard and new small panels/hooks, Login/SignUp/ForgotPassword/Settings/History, route adapters and styles.

Gate: fixture screenshots and keyboard tests at four widths; first useful action in one click; no mandatory salary/expertise/profile setup; no broken nav; each API error remains visible/retriable.

### Phase 3 — queue/resume/provider repairs

Tasks: safe IDs, run fencing/outbox/reconciliation, worker env/container, actual upload constraints, current model/voice adapters/deadlines, validated extraction/review/provenance/current pointer, exact resume-bound priming.

Files: existing ingestion/simulation contracts/SQL/API/worker jobs plus outbox contract/dispatcher/reconciler, provider modules, resume review UI.

Gate: real Redis/DB integration fixture workflow and failure injection; repeated/revived jobs work; no silent page omission; resume ID/hash pinned; provider mock contracts pass. Paid-account smoke tests tracked separately.

### Phase 4 — durable sessions and reliable live loop

Tasks: create/read/checkpoint/finalize session APIs, CAS/multi-tab handling, route identity, actual timer/duration, SSE protocol/cancellation/fallback, operation-specific retries and answer retention, resume/paused session recovery.

Files: `shared/session.ts`/schemas/events, session repository/handlers/migrations, `useInterviewSession`, interview services, `interviewFlow`, InterviewRoom and round adapters.

Gate: text interview from resume to complete durable transcript; refresh after each round/current turn; duplicate retry/double-click/typed+VAD cannot double-submit; partial stream handled; no lost answer on STT refusal; old route adapters still work.

### Phase 5 — voice/camera and room polish

Tasks: verify real VAD/assets/STT/TTS, ordered sentence pipeline/backpressure/cancel, bounded manual recording, permission ownership, explicit cloud consent, answer-window expression aggregation, mobile room/Monaco drawers/avatar cleanup.

Gate: Chrome/Edge/Firefox/Safari capability matrix; mobile keyboard/permission denial; speakers/headphones barge-in; repeated mount/unmount ends all media; no frame upload without cloud opt-in. Mark unavailable hardware tests pending rather than green.

### Phase 6 — durable evidence reports

Tasks: report job/outbox/worker, validated structured evaluation/evidence, idempotent saved history, retry status, resume snapshots, durable report route, print and legacy rendering. Remove client-only insert from NERVSummary after new path passes.

Gate: finalize/retry/revisit inserts one report; worker crash recovers; incorrect quote/model output fails validation; historical report uses its snapshot or clearly unavailable legacy context; print is readable and no signal is fabricated.

### Phase 7 — graph lifecycle and navigation

Tasks: canonical builder/types, safe IDs/classification/evidence semantics, stable Network/DataSets/resize/failure handling, topic detail/actions/list, durable action routes. Do this before rewriting tutoring around the graph.

Gate: full graph suite from section 13.5, one event/action, stable viewport, no category tutoring, direct/deep-linked topic context preserved, usable list fallback and touch/keyboard paths.

### Phase 8 — training exercises and standalone entry

Tasks: backend-loaded context, scoped conversation/voice, typed action contracts and adequate model budgets, validated quiz/flashcards/deep-dive components, durable attempts, simplified responsive layout, graph integration.

Gate: direct Training nav loads current resume; report Quiz action produces that topic's quiz after reload; malformed exercise not scored; repeated actions/reset/cancellation do not mix conversations; voice optional, all exercises work via text.

### Phase 9 — landing, performance, accessibility, cleanup

Tasks: DOM hero with optional lazy Spline, truthful marketing, fonts/assets, route chunking, accessibility fixes, reduced motion, history pagination, print/share UX, delete proven old adapters only after redirects/data compatibility verified.

Gate: visual/accessibility route matrix, initial bundle budget and graph lazy load verified, cold/slow network usable, no secret in build/network, no dead controls/imports, fallback screenshots.

### Phase 10 — production operations and release

Tasks: environment validation/deploy matrix, migrations/backups/restore, worker health/rollout, central errors/metrics/redaction, quotas/load/failure tests, retention/account deletion/export, real provider/device smoke, staged release and rollback.

Gate: all launch checklist items pass with real credentials/deployment; privacy-sensitive captures have consent; realistic expected concurrency stays within agreed latency/cost budget; operator can detect/recover worker/provider failure. Deployment/publishing requires explicit authorization if not already provided.

## 17. Verification strategy and proposed budgets

Do not spend time writing tests that only mirror Tailwind classes. Tests should protect ownership, state, asynchronous recovery, graph lifecycle, and evidence integrity. Use Vitest for pure/unit/component tests and Playwright for browser integration if not already available; use real ephemeral/local Redis+Postgres for queue/migration tests. No active preview/browser tool is assumed: use the actual available browser skill/tool or local runner. The old `preview_start`/`preview_console_logs` names are not a portability contract.

Proposed package scripts: root `typecheck`, `lint`, `build`, `test`, `test:integration`, `test:e2e`, `check:env`, `check:secrets`, `check:bundle`; worker `typecheck`, `build`, `test`. CI runs deterministic suites without real paid credentials. Live provider smoke is a separately authorized/manual staging job with sanitized output.

Risk-focused test matrix:

| Area | Mandatory scenarios |
| --- | --- |
| Auth/data | Invalid/expired/wrong-project/malformed tokens; production bypass refusal; certificate refresh; owner/nonowner CRUD/RPC/storage; logout while request pending. |
| Config | No env, one missing required variable, invalid URL/number/model settings, conflicting aliases, optional capability absent, production demo refusal. |
| Session | Double submit, duplicate/reordered checkpoint, revision conflict/two tabs, pause/reload, round end during save/STT, elapsed-clock throttling, idempotent finalization. |
| Streams | Provider before-token/after-token failure, disconnect, EOF, UTF-8 framing, deadline, reordered/late deltas, cancel during TTS synthesis/playback. |
| Queues | Failed job retained/revived, DB commit before enqueue, dispatcher dies after enqueue, worker death, Redis flush, stale run completion, prune/retention effects. |
| Resume | All section 9 fixtures plus prompt injection in source PDF and reviewed resume changes after session creation. |
| Graph/training | All section 13.5 checks, direct nav/deep link/refresh, single intended tutor action, malformed exercise, account reset. |
| UI | 360/390/768/1440 px, 200% zoom, keyboard, reduced motion, virtual keyboard, loading/empty/error/partial-success, print. |

Proposed engineering targets—verify feasibility in staging, not promises:

- Dashboard usable UI within 2.5 s on defined mid-range mobile/4G profile; LCP ≤2.5 s, INP ≤200 ms, CLS ≤0.1 where measurable.
- Initial public/auth route JS ≤300 kB gzip; authenticated dashboard ≤450 kB gzip loaded eagerly. Spline/Monaco/graph/PDF tooling load only when needed. Adjust budgets through a recorded measured decision, not by suppressing warnings.
- Graph 50 nodes: visible/interactable within 1 s after its JS/assets arrive; bounded stabilization ≤1.5 s; selection keeps viewport; zero animation under reduced-motion.
- Warm next-question first visible token p95 ≤2 s after generation request; first audible question p95 ≤3.5 s, separately measure STT and end-of-answer-to-audio. Provider and network dependence is explicit.
- VAD trailing silence target around 500–900 ms with a tunable setting; avoid chopping thoughtful pauses. Barge-in playback cancellation target ≤200 ms after accepted speech-start detection.
- Worker queue-oldest-age alert before the 180-second client poll timeout; short resume text extraction p95 target ≤15 s, scanned pipeline measured separately.
- All paid endpoints enforce account+user budgets; no unbounded active request/audio/frame buffer. Start load verification at 20 then 50 then 100 concurrent sessions with mixed realistic traffic, not simultaneous maximal calls. Synthetic mocks test infrastructure separately from provider-account quotas.

Measure stage timings with request/session/turn IDs: speech-end, STT start/end, checkpoint ack, LLM first token/end, TTS first response/audio start, playback cancel, worker queue delay, extraction/report latency, token/audio spend. Never log transcript text, resumes, cloud frames, tokens, or PII by default. Alerts cover rate-limit bypass/unavailability, provider 429/5xx, oldest jobs, failed reports, readiness, error spikes, and cost thresholds.

## 18. Release and retention policy

Before collecting real users, choose and document storage lifetime. Proposed starting defaults: keep three recent resume versions unless referenced by sessions; successful source PDFs deleted after verified parse/review policy; abandoned/failed objects cleaned within 24 hours; detailed simulation/audit artifacts expire after 14 days; job ledger after 30 days where safe. User transcripts/reports remain until user deletion under a documented configurable retention policy. Do not prune FK-referenced session resume snapshots. These values are implementation defaults to review, not assertions about existing deployment requirements.

Account export covers owned profiles/resumes/sessions/reports/training records. Account deletion atomically blocks new writes, schedules retryable DB/Storage cleanup, and deletes Firebase identity only according to the documented recoverable workflow. Late worker writes must not recreate deleted user data; use deletion/tombstone fencing. Analytics identity resets on logout/deletion.

Release stages: local deterministic demo → authenticated basic text integration → full staging with real worker/speech/camera → small pilot → production. Use additive compatible DB/API deploys and explicit feature flags for durable sessions/reports. Avoid sending old clients an incompatible SSE shape without versioning/adapter support. Document rollback for client/API/worker versions, keep schema compatibility, and actually test backup restoration.

## 19. Definition of done

The implementing agent supplies:

1. Green clean-install checks for both runtimes with exact commands/results and supported runtime versions.
2. Applied fresh/legacy migrations, complete grants/storage setup, and passing ownership tests.
3. Working real journey: signup → resume upload/review → voice/text interview → durable report → logout/login → history → graph action → training exercise.
4. No-key/demo journey with honest labelled states; no production bypass or mocked real-history data.
5. Working graph lifecycle/actions/list/resize and direct training/report URLs after refresh.
6. Mobile/keyboard/permissions/reduced-motion/print visual and interaction evidence.
7. Provider-account smoke results, latency/load measurements, quotas, media cleanup verification, and redacted operational monitoring.
8. Current env/deployment/setup/runbook documentation and a migration/rollback/retention plan.
9. A completed task ledger distinguishing tested, implementation-complete, awaiting credentials/devices, and deferred work. No “production-ready” label while required live gates are pending.

## 20. Handoff instructions for any agent

Read this document, the audit, the task ledger, applicable AGENTS.md files, and current `git status`. Inspect files before editing; the tree may have advanced. Complete the earliest unblocked task, record evidence, and keep existing working paths until their replacement passes. A plan task is permission to implement within the user's authorized scope, not permission to send messages, publish, erase deployed data, or invent missing production settings.

Use narrow, reviewable edits. Schema/API contracts precede their consumers. Do not refactor shared contracts independently in several workstreams. Preserve `.js` shared imports in worker NodeNext tree; API/browser bundler imports follow their existing conventions. No broad `any` or disabled lint/types as a completion shortcut. Do not add another state/store library unless the current approach demonstrably cannot meet a requirement.

At each task boundary record: changed files, behavioral outcome, commands/test result, fixture screenshot/interaction evidence where relevant, migration/environment effects, unresolved live verification, and the next task. A blocked credential-dependent test does not block implementing and testing unrelated UI/contract/recovery work. Do not create commits/branches/deployments merely because the old plan mentioned them; follow the active user's authorization.
