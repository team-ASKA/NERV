# NERV production readiness audit

Audited 13 October 2026 (Asia/Calcutta). **Recommendation: do not launch the current revision.**

Scope: repository architecture, browser services, authentication, serverless handlers, worker lifecycle, migrations, environment-variable consumers, UI source, local build checks, dependency audit, and current provider documentation. No deployed databases, production settings, real credentials, signed-in browser session, or live paid provider calls were available. UI findings are source-based; screenshots, device testing, and measured accessibility/performance checks remain required. Application code and configuration were not changed during this audit.

## Current system

The browser is a React 18/Vite SPA. Firebase handles sign-in **and Firestore profiles**, despite the README describing Firebase as authentication only. Supabase holds resumes and interview history. Vercel functions verify Firebase tokens and proxy model/speech calls; resume ingestion uses Supabase Storage, a Postgres job ledger, and BullMQ/Redis. A separately deployed worker extracts PDFs and runs synthetic interviews to prime questions and audit prompts.

Useful foundations already exist: a shared round engine, server-side provider secrets, authenticated paid endpoints, per-user rate-limit counters, verified upload ownership and worker checksums, transactional resume persistence, queue retries, worker health endpoints, typed-answer fallback, reusable UI primitives, and explicit unavailable expression states. These are worth retaining. Several implementations do not yet deliver the guarantees described in the README.

## Checks actually run

| Check | Result |
| --- | --- |
| `npm ci --ignore-scripts --dry-run` | Fails: manifest/lockfile mismatch, including missing BullMQ/ioredis and incompatible `debug` resolution. |
| `npm run typecheck` | Fails with nine app diagnostics: unused imports/variables, report expression/type errors, and audio `ArrayBuffer` typing. Stops before checking API/node. |
| `npm run typecheck:api` separately | Fails: BullMQ/ioredis unavailable in the installed tree plus resulting implicit-any errors. |
| `npm run typecheck:node` separately | Passes. |
| `npm run lint` | Crashes in `@typescript-eslint/no-unused-expressions`, before producing a completed lint result. |
| `npm run build` | Passes using the existing installed dependencies. Main JS: 3,367.25 kB, gzip 946.59 kB. A separate physics chunk is 1,987.51 kB, gzip 722.69 kB. Build does not typecheck or prove runtime correctness. |
| Worker typecheck/build | Both fail because worker dependencies are not installed: `pg`, `pino`, BullMQ/ioredis, etc. This does not establish that a correctly installed worker has the same errors. There is no worker lockfile. |
| `npm audit --json` | 66 reported vulnerable package entries: 3 critical, 36 high, 25 moderate, 2 low. Includes development dependencies and obsolete packages still in the stale lockfile; this is not a count of exploitable production issues. Re-audit after repairing the dependency tree. |
| Blank Supabase client initialization | Reproduced `supabaseUrl is required.` |
| Node request-close cancellation | Reproduced `request body complete -> request close -> before response: aborted=true`, without the client disconnecting. |

Local runtime is Node 20.18.0/npm 10.8.2. Both package manifests pin Node 20, which is now EOL. Move both deployment runtimes and CI to a supported LTS release and verify native canvas/PDF dependencies. [Node release schedule](https://github.com/nodejs/Release).

## P0: launch blockers

### 1. The browser data-access boundary is incomplete

Evidence: [Supabase client](src/lib/supabase.ts), [browser data service](src/services/supabaseInterviewService.ts), and [migrations](db/migrations/0001_resume_ingestion.sql).

The Supabase client uses a public key without supplying the signed-in user's Firebase ID token. Browser reads, inserts, and deletes therefore do not carry the Firebase identity. A `.eq('user_id', userId)` filter is caller-controlled and cannot authorize access. Neither migration enables RLS, defines policies, or restricts function execution. The `interviews` table is consumed throughout the app but is never created by the supplied migrations. Firestore security rules and private resume-bucket provisioning are also absent from the repository.

With restrictive policies, these browser calls fail; with permissive grants/policies, they can expose or modify other users' data. Actual deployed exposure must be checked separately.

Required: choose one consistent access path. Either proxy all application data through authenticated server endpoints, or configure Supabase Firebase third-party authentication, pass Firebase tokens through `accessToken`, and define policies using the token's text `sub`. Firebase UIDs are not Supabase UUID user IDs. Version the complete schema, RLS, role grants/RPC restrictions, Firestore rules, and private Storage bucket with PDF size/type limits. Keep job/simulation mutation RPCs available only to the backend roles that need them. [Supabase Firebase integration](https://supabase.com/docs/guides/auth/third-party/firebase-auth).

Acceptance: a fresh database boots from migrations; user A cannot read, write, delete, or invoke privileged operations on user B's data through direct REST/RPC/Storage calls; history save/load/delete succeeds for the owner.

### 2. Queue IDs violate BullMQ's contract; failed-job retries can be swallowed

Evidence: [resume ID](shared/ingestion.ts), [simulation ID](shared/simulation.ts), [API producer](api/_lib/queue.ts), [simulation scheduling](worker/src/jobs/scheduleSims.ts).

`resume:<uid>:<hash>` is passed directly as a BullMQ custom job ID. Simulation IDs use `<simId>:<runId>:<round>`. BullMQ explicitly prohibits `:` in custom job IDs. Use a stable hash or safe encoding for queue IDs, separately from database idempotency keys. [BullMQ job IDs](https://docs.bullmq.io/guide/jobs/job-ids).

There is a second retry issue: failed resume jobs remain in Redis for a day, but a revived DB claim is enqueued with the same ID. Adding an existing ID is ignored, so the DB can return to `queued` without any runnable job. Explicitly retry/reset a failed BullMQ job or assign a new attempt ID. `resumeJobExists()` only checks existence, not whether the job can still execute.

Acceptance: real Redis integration tests cover first upload, concurrent duplicates, a permanently failed upload corrected/retried within a day, Redis loss, and worker death. Each successful retry reaches a terminal ledger state and produces one intended result.

### 3. Streaming cancellation and fallback can corrupt the interview

Evidence: [streaming endpoint](api/interview/next.ts:68), [provider streaming](api/_lib/llm.ts:183).

The endpoint aborts upstream work on `req.on('close')`. On the local Node runtime, this fires after the incoming body completes, before the response completes. Tie cancellation to response disconnection, guarded against normal completion, and verify the deployed Vercel behavior.

The provider layer also falls back to Gemini after Groq has already yielded text and then fails. This can concatenate half of one question with a second question while TTS has already spoken the first. Track whether any output escaped; only switch providers before the first delta. Mid-stream failure needs an explicit interrupted/retry outcome. The SSE fallback path does not consistently mark canned output `degraded`.

Acceptance: test disconnect before/after first token, provider failure before/after first token, slow streams, and stream completion. No mixed questions, continued paid work after disconnect, or successful completion markers on partial output.

### 4. Provider configuration is obsolete

Evidence: [API model layer](api/_lib/llm.ts), [worker model layer](worker/src/llm/groq.ts), [worker defaults](worker/src/config.ts), [TTS handler](api/tts.ts).

Gemini fallback hardcodes `gemini-2.0-flash` and Gemini 1.5 models; the worker hardcodes Gemini 2.0 Flash. Google's current retirement table lists Gemini 2.0 shutdown in June 2026. The installed `@google/generative-ai` SDK is a legacy, unmaintained library. Add a configurable Gemini model shared by both runtimes and migrate to the maintained SDK or a supported REST implementation. [Retirement schedule](https://ai.google.dev/gemini-api/docs/deprecations/), [SDK guidance](https://ai.google.dev/gemini-api/docs/libraries).

Groq's defaults are also stale for normal free/developer accounts: the deprecation page lists Llama 3.1 8B shutdown on 16 August 2026 and Llama 4 Scout on 17 July 2026, with enterprise exceptions. The API and worker need account-specific text/vision smoke tests. Choose an image-capable replacement for PDF extraction; a text model cannot replace Scout just by changing the model name. Vision batching must respect the chosen model's image limits rather than sending the fixed six pages in one request. [Groq deprecations](https://console.groq.com/docs/deprecations), [vision contract](https://console.groq.com/docs/vision).

TTS sends `inputs`, `target_language_code`, and `speaker_voice: 'amrit'`, without an explicit model. The current contract documents `text`, `language_code`, `speaker`, and model-specific voices; current default models do not support the supplied pitch/loudness controls. Update the request schema and validate a model/voice pair. An API-key replacement alone will not fix this. [Sarvam REST contract](https://docs.sarvam.ai/api-reference/text-to-speech/convert).

Acceptance: production-account smoke tests for streaming question, summary, tutor, extraction, scanned PDF, STT, and decoded TTS playback. Provider failures must remain distinguishable from configuration absence.

### 5. Builds and initialization cannot be trusted

Repair manifest/lockfile consistency, remove obsolete locked dependencies, lock the worker dependency tree, resolve the app's type errors, and align ESLint/plugin versions. Require clean installs and all checks in CI for both runtimes.

The README claims missing environment values cannot throw at import time. `src/lib/supabase.ts` disproves this: it calls `createClient('', '')` when unconfigured. Firebase also initializes auth and analytics during module import. These imports run before the React error boundary can render. Add validated configuration and a deliberate setup/unavailable screen; avoid unconditional optional analytics initialization. Verify a completely unconfigured local startup and each missing-required-variable case.

## P1: reliability, privacy, and correctness

| Gap | Evidence / consequence | Required implementation |
| --- | --- | --- |
| Cross-account resume cache | `resumeData`/`resumeText` are global localStorage keys; logout does not clear them. If user B's remote resume read fails or returns nothing, user A's cached resume can be used. Async writes can also outlive account changes. | Scope caches by UID, invalidate on identity changes, clear sensitive state on logout, and guard late writes. |
| Sessions are not durable | Active turns, timer, scratchpad, and artifacts live in memory; finished rounds travel in router state. Current-round refresh loses progress. Reports lack addressable IDs/URLs. | Persist owned interview sessions and incremental round checkpoints; restore or explicitly terminate after refresh; provide durable report routes. Router state can survive some reloads, but it is not durable session storage. |
| Report saves lack idempotency/recovery | `savedRef` is set before persistence succeeds, and only protects one component mount. A failed save has no retry; revisiting/remounting can insert duplicates. | Unique session identity in DB, idempotent finalization, visible save status, and retry/recovery. |
| Duration is inaccurate | `advanceFlow()` drops `RoundArtifacts.durationMinutes`; summary uses chosen budget times number of rounds, even for early completion. | Carry elapsed time per round and sum it; use a deadline/monotonic clock rather than counting timer callbacks. |
| Rate limits fail open | Missing Redis, timeout after 150 ms, or Redis errors allow paid requests. Per-user request counts do not cap account-wide tokens/audio/spend. Worker limiter is per process. | Explicit production failure policy, account-level budgets/concurrency, provider circuit breakers, spend alerts, and request-size/duration quotas. |
| Development auth bypass works in production | `ALLOW_UNVERIFIED_AUTH=true` permits caller-claimed identity without an environment guard. | Refuse this setting in production; constrain it to an explicit local/emulator mode. Test the production invariant. |
| API validation is incomplete | Type assertions do not validate runtime data. Null history entries can throw; invalid rounds silently become technical; summary turn lengths and code/resume inputs are not consistently bounded. STT accepts unbounded decoded audio within platform body limits. | Shared runtime schemas, strict enums, aggregate prompt budgets, audio MIME/size/duration checks, and stable 400/413 responses. |
| Manual audio may exceed serverless body size | PCM records at device sample rate, then gets base64 encoded without a clear maximum recording duration. | Resample/encode appropriately, enforce duration/size before upload, and preserve an answer when transcription fails. |
| API calls can hang or hide outages | API LLM/STT/TTS calls lack consistent deadlines and classified retry behavior. Gemini generation does not honor the passed cancellation signal. Paid failures often become 200 canned responses. | End-to-end deadlines, abort propagation, bounded transient retries, truthful degraded/error states, and retriable error codes. |
| Postgres TLS verification disabled | Worker sets `rejectUnauthorized: false` for non-local database connections. | Verify certificates with provider trust/CA configuration; test pooler TLS. |
| File safety/retention incomplete | Worker checks actual checksum but not actual byte limit; upload size/MIME are client claims unless bucket rules enforce them. Page extraction silently truncates at 12 text/6 vision pages. Render height is not bounded. Failed/abandoned PDFs and job/sim ledgers have no scheduled retention cleanup. | Bucket constraints, worker byte/page/pixel limits, explicit truncation/rejection, bounded render resources, and scheduled retention/orphan cleanup. |
| Job state can diverge | Worker status updates refuse `failed` transitions, but a sweeper can mark a live/stalled run failed; final persistence can later mark it done. Resume sweeper excludes old queued rows. | Attempt/run fencing, state-transition guards in the transaction, queue/ledger reconciliation, and alerts on oldest pending jobs. |
| Simulation scheduling is best effort | Resume commits before simulation scheduling; failures are swallowed, and replay of a done resume skips scheduling. | Durable outbox/reconciliation for missing priming jobs; record prompt/model versions. |
| Cloud camera fallback is automatic | `auto` tries MediaPipe then Hume, which uploads frames. There is no distinct explicit cloud consent in that fallback path. | Default to local/off; require a clear opt-in before cloud frame transfer, explain storage/processing, and make provider selection visible. |
| Metrics imply more certainty than supported | Expression reliability uses hand-set provider constants; skill coverage is keyword mention counting, not verified competence. Historical reports rebuild skills using the user's current resume. | Label heuristics as observations, separate mentions from evaluated competence, validate assessment rubrics, and snapshot the resume/prompt/model used for each session. |
| Identity/profile lifecycle incomplete | AuthProvider and signup independently seed/overwrite Firestore documents. AuthProvider waits for Firestore before rendering children. Password reset, verification, account deletion/export, and consistent profile validation are absent. | One profile creation path, loading/recovery UI, recovery and verification flows, owned account deletion/export across stores. |

Operational gaps: no checked-in automated test suite or CI workflow, container/deploy recipe for the worker, automated migration runner, API readiness check, central exception reporting, request correlation, provider latency/error/token metrics, queue-depth/age alerts, or documented backup/restore and rollback procedure. Worker readiness currently succeeds even when no model provider is configured; distinguish infra readiness from usable interview/extraction capability. Analytics does not replace operational monitoring. Production logs should avoid profile emails/raw provider responses; AuthContext currently logs the profile object.

## Environment/configuration audit

Only `.env.example` exists in this checkout. Actual credential freshness, project ownership, permissions, billing, and deployed secret values were not verified. API-key names such as `GROQ_API_KEY` and `SARVAM_API_KEY` are still consumed by the code; it is primarily defaults, contracts, validation, and documentation that are stale here.

### Existing variables and their status

| Runtime | Variables | Assessment |
| --- | --- | --- |
| Browser Firebase | `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_APP_ID` | Public web config; validate as a set and document authorized domains/auth setup. |
| Browser optional Firebase | `VITE_FIREBASE_STORAGE_BUCKET`, `VITE_FIREBASE_MESSAGING_SENDER_ID`, `VITE_FIREBASE_MEASUREMENT_ID` | Still consumed. Storage initialized but not part of the main resume pipeline; analytics should be optional. |
| Browser Supabase | `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_SUPABASE_PUBLISHABLE_DEFAULT_KEY` | Both key names accepted; old anon takes precedence. Establish a canonical public key name with backwards-compatible aliases. Public key does not convey user identity. |
| Browser analytics | `VITE_POSTHOG_KEY`, `VITE_POSTHOG_HOST` | Optional; example and code disagree on default host. Add deliberate consent/lifecycle handling. |
| Browser API origin | `VITE_API_URL` | **Documented but never read.** Every API caller uses same-origin paths. Remove it or implement centrally; separate-origin support also requires CORS/origin policy. |
| Browser expression | `VITE_EMOTION_PROVIDER`, `VITE_VISION_CDN`, `VITE_FACE_MODEL_URL` | Consumed; `auto` may upload to Hume. Prefer `mediapipe` by default, pin/self-host runtime assets, validate choices. |
| Server auth | `FIREBASE_PROJECT_ID`, `ALLOW_UNVERIFIED_AUTH` | Project falls back to browser project ID. Bypass appears only as a commented example; must be impossible in production. |
| Server models | `GROQ_API_KEY`, `GROQ_MODEL`, `GEMINI_API_KEY` | Consumed; obsolete model defaults. No configurable Gemini model. |
| Server speech | `SARVAM_API_KEY` | Consumed; STT model/TTS contract and voice are hardcoded. Add explicit validated model settings. |
| Optional server cloud expression | `HUME_API_KEY`, `HUME_SECRET_KEY` | Server token exchange exists; include only when cloud capture is intentionally enabled. |
| API + worker data | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `RESUME_BUCKET`, `REDIS_URL` | Consumed. Server initialization accepts only the service-role variable name. Add canonical `SUPABASE_SECRET_KEY` support if migrating to new keys, retaining a deliberate legacy alias. Never make backend keys `VITE_`. |
| Worker DB | `DATABASE_URL`, `DB_POOL_MAX` | Consumed; URL is secret, pool limits need per-replica budgeting and verified TLS. |
| Worker extraction | `GROQ_VISION_MODEL`, `GROQ_TEXT_MODEL` | Consumed; retired defaults for ordinary accounts. Worker text model and API model can diverge, weakening simulation relevance. |
| Worker retention | `RESUME_RETAIN_PDF`, `RESUMES_PER_USER` | Consumed; successful PDFs cleaned best effort, not a complete retention policy. |
| Worker scheduling | `INGEST_CONCURRENCY`, `SIM_CONCURRENCY`, `LLM_RPM`, `ENABLE_INTERVIEW_SIM`, `SIM_AUDIT_RATE` | Consumed; positive-number parsing/fallback is not comprehensive deployment validation. Defaults enable paid background work. |
| Worker process | `PORT`, `LOG_LEVEL`, `NODE_ENV` | Consumed; `NODE_ENV` absent from active example. Validate enum/ranges and deployment defaults. |

Supabase now distinguishes public publishable keys and backend secret keys; legacy anon/service-role keys are still a separate supported key family. Changing variable names is an application convention and must be implemented in consumers before changing deployment settings. [Supabase key documentation](https://supabase.com/docs/guides/getting-started/api-keys).

### Required config changes

1. Separate browser/API/worker templates or clearly specify which runtime receives each field. Add a checked config schema per runtime and a redacted capability/status report. Fail required production configuration before traffic, while optional features remain explicitly unavailable.
2. Add configurable `GEMINI_MODEL` across API and worker; unify/version production and simulation interviewer model selection. Add validated `SARVAM_STT_MODEL`, `SARVAM_TTS_MODEL`, and `SARVAM_TTS_SPEAKER`. These are **proposed variables, not currently implemented**.
3. Implement publishable/secret key aliases consistently and repair Firebase identity forwarding or eliminate direct browser database access.
4. Correct local environment loading: Vite reads root `.env`, but worker scripts run `tsx watch`/`node` without `dotenv` or `--env-file`. Copying the root example into `.env` does not populate the worker process. Document/implement the worker's explicit environment source.
5. Check for accidentally public provider keys in CI and generated bundles; cover `.env.*` secret files in ignore rules, not just the current small named list. Use deployment secret stores and rotate actual secrets when their owner confirms expiry/exposure.

## UI repair plan

There is already a reusable `ui/` layer, so consolidate it instead of introducing another component system. The present issue is incomplete adoption plus a fragmented journey.

| Surface | Concrete issue | Target behavior |
| --- | --- | --- |
| Landing | Desktop hero depends on a scaled external Spline scene; wrapper has no explicit height, and useful desktop copy/CTA is not normal DOM content. Fallback offers no hero CTA. Mobile uses a separate hero. | One responsive DOM hero with clear resume-to-interview value and CTA; optional lazy-loaded illustration with stable dimensions. Verify any testimonial/hiring claims before keeping them. |
| Login/signup | Old black/white styling differs from indigo app primitives; labels lack input associations, visibility buttons lack accessible labels; reset link points to an unregistered route; Remember me is decorative. Signup collects considerable profile information before first value. | Shared auth layout and controls, working reset/persistence behavior, progressive profile setup, field-level errors, and preserved intended destination after login. |
| Navigation | AppShell hides Dashboard/Training links below `sm` and provides no replacement. Setup uses a separate shell. | Usable mobile menu/navigation, consistent account controls, visible current location, and coherent back/exit behavior. |
| Dashboard | A roughly 1,100-line page mixes data access, profile editing, upload, stats, history, and training. First-time users compete with multiple panels/actions. | Make resume upload and start interview the clear primary journey; extract focused panels; separate loading/error/empty/populated states and show backend persistence truthfully. |
| Interview setup | Says microphone is required although the engine supports typed answers. | Explain voice and typed modes, optional camera, provider availability, permissions, total time, and data handling before starting. |
| Interview room | `h-screen`/overflow-hidden with a multi-panel grid can make controls inaccessible on small screens/keyboards. Prominent avatar, webcam, expression panels, transcript, scratchpad, and controls compete. | Prioritize question, answer, and conversation status; secondary camera/expression/editor panels collapse into tabs/drawers. Use dynamic viewport sizing and verify keyboard/open-browser-toolbar layouts. |
| Training | Separate complex full-height layout; very small 9–11 px labels and multiple panels. | Reuse conversation controls/status patterns and a responsive tool panel; make readable text and voice/typed modes obvious. |
| Report/history | Report exists only through navigation state; save failure offers no retry; heuristic composure can dominate assessment; print styles switch body colors without reliably converting dark cards/white text. | Durable report URL, save/retry status, evidence-led feedback, clearly labelled observations, resume snapshot, and verified print/PDF layout. |

Shared accessibility work: dialog accessible names, focus trapping/restoration, content height/scrolling; `aria-describedby` for form errors; labelled icon-only controls; keyboard tabs and live-status announcements; reduced-motion support; verified color contrast; readable type sizes and touch targets. `Modal.tsx` currently implements Escape/backdrop closing and scroll locking but lacks a focus trap, focus restoration, and `aria-labelledby`.

Performance work: lazy-load routes and Spline/Monaco/graph/chart tooling; avoid paying for interview/training/3D dependencies on login or landing. Set bundle and load-performance budgets measured on a mid-range phone and throttled connection. The generated main-bundle size is evidence of a problem; it is not a measured Core Web Vitals result.

Visual acceptance: review landing, auth, empty/populated dashboard, upload failure/progress, permission denied, text-only interview, voice interview, reconnect/error, training, and report at 360/390/768/1440 px. Test mobile landscape, virtual keyboard, 200% zoom, keyboard-only navigation, screen reader announcements, reduced motion, and printing. No visual acceptance is claimed by this source audit.

## Recommended delivery order and launch gate

1. **Make the repository reproducible:** supported runtime, synchronized lockfiles, installed worker, passing types/lint/build, CI. Verify unconfigured startup intentionally renders useful status.
2. **Make data access secure and complete:** auth integration decision, complete schema/policies/rules/bucket, tenant isolation tests, account-scoped caches, idempotent owned report persistence.
3. **Make the core loop work:** safe queue IDs and real retry handling, model/API migrations, proper cancellation and streaming fallback, provider deadlines, bounded uploads/audio, durable sessions and accurate timing.
4. **Repair the user journey:** shared public/auth/app styling, first-upload dashboard, mobile navigation, compact room/training layout, durable readable reports, accessibility/print review.
5. **Prove operations:** staging end-to-end run, failure injection, realistic concurrency/spend tests, central metrics/alerts, retention cleanup, tested restore/rollback, production secret/config validation.

Launch requires a clean checkout to install/build both runtimes, a new environment to bootstrap without manual missing-table work, isolation tests to pass, and an actual browser journey from signup through PDF upload, three rounds, saved report, logout/login, and history retrieval. Repeat with denied devices, unavailable providers, failed uploads, Redis/worker restarts, token expiration, and page refresh. Establish expected concurrency and provider-account budget before calling the platform ready for load.
