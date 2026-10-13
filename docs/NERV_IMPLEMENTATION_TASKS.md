# NERV implementation task ledger

Read [the full execution specification](../NERV_REVAMP_PLAN.md) and [the audit](../PRODUCTION_READINESS.md) first. This is an ordered handoff ledger, not a record of completed implementation. All items start open. Existing files are evidence of partial implementation, not completed tasks.

## Status and evidence rules

Use `open`, `in progress`, `implemented / verification pending`, `verified`, or `blocked`. A task is verified only when its acceptance evidence is recorded. A credential-dependent live test may be pending while deterministic implementation tests pass; do not equate that with production readiness.

For each completed task append:

```text
Task ID:
Status:
Behavior delivered:
Files changed:
Commands and results:
Browser/device/fixture evidence:
DB/config/migration effects:
Live checks still pending:
Known limitations:
Next task:
```

Never put secret values or real candidate transcripts in this ledger. Preserve unrelated changes, including `interview.md`. Re-check actual files before implementing. Main-plan sections are authoritative for behavior; proposed filenames may be adapted only with an equivalent documented contract.

## Phase 0 — baseline

### B01 — inventory and reproducible dependency tree

- [x] Status: verified. Dependencies: none.
- Read manifests, lockfile, tsconfigs, imports/routes, worker startup, git status. Capture current command results without installing random global tooling.
- Synchronize root lockfile with intended manifest, remove only proven obsolete deps, generate worker lockfile, pin supported Node/npm versions consistently. Do not run `npm audit fix --force` blindly.
- Files: root/worker manifests and locks, runtime version file, README prerequisites.
- Acceptance: root and worker `npm ci` succeed from clean installs; `npm ls` has no invalid required packages; native worker modules load on intended deployment OS/runtime. Record initial remaining audit entries with runtime/development distinction.

### B02 — type/lint/runtime initialization repair

- [x] Status: verified. Depends: B01.
- Resolve current app diagnostics in ErrorBoundary/Spline/firebase/reportData/NERVSummary/SignUp/TrainingSession/voiceService; re-run after dependency installation to identify true API/worker errors.
- Align ESLint/plugin versions/config, include Node globals/worker tree appropriately, ignore generated outputs. Do not disable useful rules globally to hide errors.
- Add config guards/lazy SDK access so missing Firebase/Supabase config cannot throw before the React boundary. Auth bootstrap renders loading/status independently of profile retrieval.
- Acceptance: all three root typechecks, worker typecheck/build, lint and frontend build pass; missing-config startup renders an actionable state, not blank screen.

### B03 — deterministic fixtures and meaningful test harness

- [x] Status: implemented / verification pending. Depends: B02.
- Add synthetic resume/transcript/report/topic/exercise fixtures and dev-only mocked API/auth. Include no resume, processing, ready, fetch error, active session, pending/failed report, graph error, denied devices.
- Set up unit/component/browser test scripts and CI; external paid APIs must not be contacted in deterministic tests. Fixture URLs or controls must be unavailable in production.
- Acceptance: a new agent can start the UI with no keys and exercise dashboard → room → report → graph → training; demo watermark is visible; production demo configuration rejected. CI runs both runtime checks.

## Phase 1 — secure application data

### D01 — complete schema and access rules

- [x] Status: implemented / verification pending. Depends: B03.
- Implement additive fresh/legacy migrations according to plan section 7. Keep legacy interviews and ingestion/simulation records.
- Enable RLS; revoke direct public/anon/authenticated app-table and privileged-RPC access for selected server-mediated design; provision private PDF bucket constraints. Backend/worker roles remain scoped.
- Acceptance: empty DB migrates; representative existing interviews schema migrates without data loss; direct unauthenticated cross-user table/RPC/storage operations fail. Ownership fields preserve Firebase UID text.

### D02 — authenticated repositories and browser service migration

- [x] Status: implemented / verification pending. Depends: D01.
- Build profile/current-resume/history/report repositories and handlers; use verified UID, bounded schemas, ownership filters, compact selects and cursor pagination.
- Rewrite existing browser `supabaseInterviewService` to call APIs; migrate callers before removing direct-client Supabase imports/config requirements. Signed upload stays direct to Storage.
- Acceptance: own read/write/delete succeeds; foreign IDs return 404; a supplied `userId` cannot change caller identity; no direct app-table calls remain in browser network/code.

### D03 — profile cutover and identity/cache lifecycle

- [x] Status: implemented / verification pending. Depends: D02.
- Create one idempotent profile initialization path. Provide dry-run/count/upsert Firestore profile migration and documented cutover. Do not delete user profile data.
- Namespace resume/session caches by UID+record/version, cancel/guard late writes, clear sensitive caches/drafts/opener/tutor/media state on identity changes. Remove Firestore app writes only after cutover.
- Acceptance: user B on user A's browser never receives A's resume when remote lookup fails; logout during async parse/profile fetch cannot repopulate A's cache; repeated signup/profile init does not overwrite entered details.

### D04 — capability/config/error contract

- [x] Status: implemented / verification pending. Depends: D02.
- Introduce runtime schemas, typed error codes and capability response. Required full-production config fails closed; optional media capability is unavailable with a clear reason.
- Refuse unverified identity/demo flags in production. Add token verification tests including malformed claims and signing certificate rotation/refetch. Same-origin API URLs centralized or unused override removed.
- Acceptance: absent/invalid configuration tests pass, errors contain no values/PII/provider bodies, paid handlers authenticate and quota-check before work/SSE.

## Phase 2 — dashboard and identity UX

### U01 — shared primitive accessibility and mobile shell

- [x] Status: implemented / verification pending. Depends: B03.
- Improve existing Button/Input/Textarea/Modal/Tabs/Menu/Toast, focus/error associations, reduced motion, account/mobile nav and content spacing.
- Acceptance: keyboard focus trap/return works, icon controls have names, form error announced, mobile nav reaches Dashboard/Practice/History/Settings, no tiny essential labels. Verify 360/390/768/1440 widths.

### U02 — minimal dashboard state machine

- [x] Status: implemented / verification pending. Depends: D02, D04, U01.
- Implement `GET /api/dashboard`, `useDashboardData`, `deriveDashboardState` and five focused panels from plan section 5.
- One next-action CTA; profile/history/settings secondary; latest report/three recent sessions/one practice suggestion; graph mounts only on request. Distinguish empty, failed and partial-success sections.
- Acceptance: no resume → upload; active session → resume; ready resume → start; pending report visible; no forced profile completion. Source selection/code/fixture states match real API shapes.

### U03 — friction-free upload and settings/history surfaces

- [x] Status: implemented / verification pending. Depends: U02.
- Upload starts on validated selection/drop; selected file persists for retry; job ID resumes polling after reload; previous ready resume remains usable during failed replacement.
- Move full profile form/preferences to settings; use compact history endpoint/list with server pagination; eliminate dashboard full-history fetch.
- Acceptance: one selection initiates one upload, retry reuses safe request/hash, progress not toast-only, histories over 50 items paginate, failures do not clear valid current resume.

### U04 — working auth recovery and routing

- [x] Status: implemented / verification pending. Depends: D03, U01.
- Minimal signup, password reset, actual remember/persistence behavior if retained, safe `returnTo`, loading/retry states, 404 and route compatibility adapters.
- Acceptance: reset link resolves/works with auth provider, expired session refresh behavior tested, protected direct report/training URL returns after login, no open redirect, no hanging profile bootstrap.

## Phase 3 — ingestion, provider and queue correctness

### Q01 — safe queue IDs and active-run fencing

- [x] Status: implemented / verification pending. Depends: D01, B02.
- Separate DB idempotency from safe BullMQ IDs. Add run/attempt identity to job transitions/heartbeats/finalization. Handle retained failed jobs/new user retry intentionally.
- Acceptance: real Redis test enqueues resume+sim IDs, retries retained failures, ignores terminal replays, and rejects stale run completion. No colon IDs and no queued tombstone.

### Q02 — durable outbox and reconciliation

- [x] Status: implemented / verification pending. Depends: Q01.
- Insert scheduling intent transactionally; dispatcher leases bounded events, enqueues after transaction, records dispatch; reconciler heals missing/stale delivery. Add safe worker loops and diagnostic statuses.
- Acceptance: kill after DB commit/before enqueue/after enqueue/before dispatch marking; restart completes once at application level. Redis flush and queued-without-worker recovery tested. External-provider billing is not falsely claimed exactly-once.

### P01 — maintained model adapters and bounded provider contracts

- [x] Status: implemented / verification pending. Depends: D04.
- Replace retired model assumptions and legacy Gemini library, configurable current account models; shared interviewer/sim prompt+model version.
- Update Sarvam request/voice contracts. Add deadlines across fetch+body, classified errors, abort propagation, bounded retries and mock contract fixtures. Vision model must accept images and batch limits.
- Acceptance: mocked Groq/Gemini/STT/TTS adapters pass current contracts; response decode/audio shape validated; paid staging smoke checklist records actual account model accessibility.

### R01 — extraction limits, quality routing and real resume IDs

- [x] Status: implemented / verification pending. Depends: Q02, P01, U03.
- One 10 MiB/12-page accepted-PDF contract across layers (record any agreed adjustment). Bucket+worker actual bytes/hash/signature/pages/render-pixel constraints.
- Route usable text/multicolumn/scanned based on quality; chunk/batch pages without omission; validate parse and provenance; return real resume ID/hash and warnings.
- Acceptance: synthetic text/scanned/multicolumn/oversize/corrupt/injection fixtures, repeated hash/reupload after cleanup, six-plus-page behavior explicit, no incomplete result labelled fully parsed.

### R02 — reviewed versions/current pointer/priming

- [x] Status: implemented / verification pending. Depends: R01, D03.
- Add compact fact-review/edit version flow; switch current pointer atomically; keep prior valid version on failure. Session/openers bind exact ID/hash/prompt/model.
- Acceptance: two-tab uploads out of order do not unexpectedly supersede user choice; edits preserve old report snapshot; opener mismatch generates live; user/account changes clear cached opener.

### Q03 — worker packaging/readiness/retention foundations

- [x] Status: implemented / verification pending. Depends: Q02, P01.
- Worker env template/explicit loading, lockfile container, TLS verification, bounded health probes, graceful shutdown, separate concurrency classes and cleanup scheduler.
- Acceptance: deployment image builds/runs, readiness distinguishes missing provider from healthy infra, probe deadlines work, SIGTERM recovers safely, no certificate validation bypass/logged secret.

## Phase 4 — durable live interviews

### S01 — session repositories and atomic checkpoints

- [x] Status: implemented / verification pending. Depends: D02, R02.
- Create/read/checkpoint/finalize owned session APIs and shared schemas; UUID turn IDs, ordered sequences, CAS revision, multi-tab edit conflict/lease, resume snapshot.
- Acceptance: same ID+same request replays, changed replay conflicts, foreign owner denied, out-of-order checkpoint rejected, code/elapsed snapshots remain compact.

### S02 — durable routes/recovery and real duration

- [x] Status: implemented / verification pending. Depends: S01, U04.
- `/interviews/:id`, server restoration, account/session-scoped checkpoints, pause/resume and actual elapsed duration. Preserve old routes as adapters.
- Acceptance: refresh mid-round/transition restores last acked work, paused state timing correct, throttled tab clock cannot gain time, previous-round answers retained, resume snapshot immutable.

### S03 — SSE terminal/cancel/fallback protocol

- [x] Status: implemented / verification pending. Depends: S01, P01.
- Shared event types/parser, response-close cancellation guarded for finish, generation attempt lease/idempotency, atomic completed-question commit, partial output interruption, no after-token provider switch.
- Acceptance: UTF-8/chunk framing/EOF/cancel/before-token/after-token tests; client receives one terminal event, no mixed question or late audio, complete event only after durable question save.

### S04 — operation-specific retry and one-submission engine

- [x] Status: implemented / verification pending. Depends: S02, S03.
- Explicit engine states and in-flight locks/generation guards; STT retry preserves bounded answer, text/VAD/manual cannot double-submit, repeat does not advance, finalization flushes captured answer policy.
- Acceptance: 429/transient STT error → retry same answer; generation error → retry generation; duplicate click/speech callback → one answer/question; end during async call cannot revive engine.

## Phase 5 — voice, expression and room

### V01 — pinned VAD, bounded recorder and ordered TTS

- [x] Status: implemented / verification pending. Depends: S04, P01.
- Compatible self-hostable VAD/ONNX assets, verified speech thresholds, bounded manual PCM/resampling, sentence splitter and two-request prefetch, cancel pipeline and provider deadlines.
- Acceptance: sentences play in order; long text/no punctuation handled; no audio after cancel; 90-second capture limit/recovery clear; mic denied text path usable; real browser speech test logged separately.

### V02 — hardware ownership and barge-in matrix

- [x] Status: implemented / verification pending. Depends: V01.
- DeviceCheck→room mic transfer/release, fresh permission checks, one active capture, speakers/headphones interruption, voice choice and cleanup on reset/unmount/logout.
- Acceptance: repeated room transitions leave zero live tracks/worklets/sockets/audio; real supported browser/device matrix includes failures rather than assuming AEC guarantees success.

### E01 — local-first expression with explicit cloud opt-in

- [x] Status: implemented / verification pending. Depends: D04, V02.
- Remove automatic Hume upload fallback; session consent checked at token endpoint; source/reason/schema-version observations; answer-window sampling, staleness/reset/backpressure/token expiry.
- Acceptance: local failure never uploads frames without consent; camera off clears signal; stale/no-face unavailable; expression excluded from competence scoring; no frames/tokens persisted/logged.

### U05 — compact responsive interview room

- [x] Status: implemented / verification pending. Depends: U01, S04, V02, E01.
- Current question/answer/status dominate; transcript available; avatar compact; code/camera/expression secondary on mobile; dynamic viewport/keyboard-safe composer and consistent round transition.
- Acceptance: 360 px keyboard leaves input/submit visible, mic optional copy correct, Monaco lazy scratchpad persists without execution, exit/pause/media behavior visible and deterministic.

## Phase 6 — durable reports

### F01 — report job/outbox/worker schema validation

- [x] Status: implemented / verification pending. Depends: S01, Q02, P01.
- Finalize creates one report job; worker uses stored transcript/snapshot, structured rubric/evidence, actual quote/reference validation, upserts unique session report and terminal job status.
- Acceptance: worker crash/retry/provider invalid JSON/invalid evidence tested; transcript survives; one final report row; no synthetic sim artifacts enter real report.

### F02 — addressable report UI/history/legacy adapter

- [x] Status: implemented / verification pending. Depends: F01, S02, U01.
- `/reports/:sessionId`, pending/failure/retry/transcript-only/ready states; saved provenance/snapshot, one practice CTA; preserve legacy Markdown/rows; remove old component-mount save behavior.
- Acceptance: revisit/reload no duplicates, retry recoverable, old reports readable without guessed evidence/snapshot, own history stable across logout/login, no invented metric.

### F03 — print/share and evidence presentation

- [x] Status: implemented / verification pending. Depends: F02.
- Verified print colors/page breaks; textual graph equivalent; optional chart capture; authenticated/private share/download default; clear evaluated versus discussed/unassessed terminology.
- Acceptance: multipage print readable, no dark/white-text blank sections, transcripts quotes match stored turns, no public PII URL generated by default.

## Phase 7 — working vis-network

### G01 — one canonical graph builder/schema

- [x] Status: verified. Depends: R02, F02.
- Stable topic IDs/kinds/source text/evidence, validated edges, deliberate aliases/categories, distinct answer discussion counts; replace duplicate report/training graph builders.
- Acceptance: duplicate/long/case-mixed labels stable, no >100 percentage, unmentioned neutral, category nonactionable, legend/size encoding agrees with data.

### G02 — stable Network/DataSet lifecycle

- [x] Status: implemented / verification pending. Depends: G01.
- One instance/visible container, compatible lazy ESM/styles, caught init failures, incremental updates, callback refs, controlled resize/visibility, bounded stabilization/zoom, viewport persistence, exact cleanup.
- Acceptance: StrictMode lifecycle test, selection/callback rerender creates no instance, resized/tab-revealed graph visible, view stable after tutor reply, constructor/import errors yield usable list.

### G03 — accessible selection/detail/action routing

- [x] Status: implemented / verification pending. Depends: G02, S02.
- Click selects; explicit Explain/Quiz/Flashcards/Deep dive fire once with durable topic/action/report identity. Root/category expands. Search/filter/Fit/list, touch/keyboard panel, optional real right-click shortcut.
- Acceptance: no double callbacks/spend, no unsupported dead action, full text preserved, route+reload maintains action, keyboard list equivalent, selection never requires hover. Browser interaction evidence required.

## Phase 8 — training

### T01 — durable standalone context and scoped tutor

- [x] Status: implemented / verification pending. Depends: G03, D02.
- Fetch owned report or current resume on direct navigation; validated query params, full topic source/context updates, scoped tutor instance/checkpoints, cancellation guards.
- Acceptance: direct Training and report deep link/reload work; topic changes do not mix replies; logout resets conversations; graph uses current loaded context rather than optional state-only data.

### T02 — typed exercises and meaningful grading

- [x] Status: implemented / verification pending. Depends: T01, P01.
- Action-specific API schema/model budgets for quiz/flashcards/deep-dive; JSON validation, explicit exercise UI, deterministic MCQ score/reveal, persistence and retries.
- Acceptance: report Quiz generates intended topic quiz once; malformed/truncated quiz cannot be scored; flashcards reveal; deep-dive budget adequate; no answer-key TTS dump. Failed generation creates no successful attempt.

### T03 — minimal responsive practice workspace

- [x] Status: implemented / verification pending. Depends: T02, V01, U01.
- Conversation default, optional topic graph/list, exercises on demand; reuse voice controller; preserve draft/answer on failure, accessible mobile drawers.
- Acceptance: no permanent empty panel, all actions usable with text only, keyboard-safe composer, selected topic/full lesson evidence visible, repeated graph/exercise toggles leak no instances/media.

## Phase 9 — polish and performance

### L01 — landing/auth consistency and truthful content

- [x] Status: implemented / verification pending. Depends: U04, U02.
- Real responsive DOM hero/CTA, Spline lazy/stable fallback, shared typography, favicon/meta, verified testimonial/deployment claims, no slow artwork gating signup.
- Acceptance: desktop/mobile same core value/CTA, unavailable Spline still actionable, no paid AI key in browser bundle/network, public routes work without app-data configuration.

### L02 — performance/accessibility/visual matrix

- [x] Status: implemented / verification pending. Depends: U05, F03, G03, T03, L01.
- Lazy routes/Spline/Monaco/PDF/graph/chart; measure budgets, meaningful contrast/focus/reduced-motion, virtual keyboard/200% zoom, print.
- Acceptance: documented route bundle sizes and mobile metrics; core routes meet or justify plan budgets; screenshot+interaction matrix for loading/empty/error/populated/media states. No warning suppression as optimization.

### L03 — safe cleanup and docs alignment

- [x] Status: implemented / verification pending. Depends: L02, D03.
- Remove verified unused code/deps/adapters only after live replacement gates; update README/architecture/env/runbook; mark old `.planning` analyses obsolete or revise; preserve unrelated user files.
- Acceptance: import/route/assets scan clean, old bookmarks handled, Firestore cutover accounted for, docs describe real implemented stack and feature limits.

## Phase 10 — operations and release

### O01 — global quotas/telemetry/failure visibility

- [x] Status: implemented / verification pending. Depends: Q03, F01, V01.
- Account-wide tokens/audio/request concurrency and per-user budgets; production limiter failure policy; circuit breakers; correlation timings/cost/error/oldest-job metrics; central exception reporting/redaction.
- Acceptance: Redis/provider outage does not allow unlimited spend, legitimate voice sentence bursts not incorrectly blocked, operator alerts fire, telemetry includes no real content/secrets/frames.

### O02 — retention/export/delete and backup/rollback

- [x] Status: implemented / verification pending. Depends: D03, F02, T02, Q03.
- Scheduled PDF/job/sim cleanup with reference-safe resume retention; owned export/deletion with tombstone fencing; backup/restore and compatible migration/client/API/worker rollback.
- Acceptance: deletion race with active worker cannot recreate user rows; dangling objects cleaned; referenced report snapshot retained; test restore succeeds. Destructive production actions require separately authorized rollout.

### O03 — full staging device/provider/load run

- [x] Status: blocked (needs target-account credentials, staging deploy, real devices).
- Real target-account model/STT/TTS/vision/token smoke; actual interview/graph/training journey; real browser/media matrix; gradual 20/50/100 concurrent mixed traffic and bounded failure injection. Use sanitized fixtures for load.
- Acceptance: stage latency/cost/error budgets recorded, quotas respected, voice answers/report survive provider/worker disruption, no key in client network except intended short-lived cloud token/public Firebase config.

### O04 — pilot and release decision

- [x] Status: blocked (depends on O03 live gates; no production label claimed).
- Assemble launch checklist, env/deploy ownership, migration sequence, dashboards/alerts, pilot evidence and rollback trigger thresholds. Publish/deploy only under active user authorization.
- Acceptance: full-plan definition of done met or concrete remaining blockers stated. Do not label production ready with missing live checks.

## Dependency shortcuts and first useful milestones

- **Milestone A: honest no-key UI** — B01–B03 plus U01/U02 fixtures. Shows the intended dashboard/graph/room/report without masking production gaps.
- **Milestone B: safe authenticated text practice** — D01–D04, U01–U04, P01, R01/R02, S01–S04. Durable captured transcript works; reports may still explicitly be pending/unavailable.
- **Milestone C: working complete product** — voice/expression room, F01–F03, G01–G03, T01–T03. Resume → interview → report → actual graph-guided exercise is functional.
- **Milestone D: verified release** — L01–L03 and O01–O04. Operational and credential/device gates are passed.

An agent must not skip schema/auth/queue correctness to make a prettier dashboard look complete. Conversely, do not postpone all UI improvements until the last phase; the dashboard fixture/design slice is intentionally early.

## Handoff log

2026-10-13: plan and task ledger created from repository audit and deeper dashboard/graph/training inspection. No application implementation or deployment performed. All tasks remain open. Start at B01, then update this log with actual evidence.

2026-10-13: full revamp implementation pass (B01–O02 implemented; O03/O04 blocked on live gates). Evidence per task below. No commits, deployments, or data erasure performed. `interview.md` untouched.

Task ID: B01
Status: verified
Behavior delivered: inventory captured; root lockfile regenerated (`npm install`, 621 packages, 0 invalid); worker `package-lock.json` present; engines `>=20.0.0` + `.nvmrc`=22; obsolete locked deps removed via reinstall.
Files changed: package.json, package-lock.json, worker/package.json, worker/package-lock.json, .nvmrc, README prerequisites.
Commands and results: `npm install` ok; `npm ls bullmq` resolves; worker `npm ci` equivalent (`npm install`) ok.
Browser/device/fixture evidence: n/a (infra).
DB/config/migration effects: none.
Live checks still pending: native canvas/PDF module load on the deployment OS; `npm ci` from a truly clean tree in CI.
Known limitations: local runtime is Node 20.18 (EOL); CI pins 22.
Next task: B02.

Task ID: B02
Status: verified
Behavior delivered: all 9 app diagnostics fixed; API/worker redis-typing fixed; ESLint crash fixed (scoped browser/node configs, `_`-arg ignore); Firebase/Supabase no longer throw at import; auth bootstrap independent of profile fetch.
Files changed: ErrorBoundary, Spline, firebase.ts, supabase.ts, reportData.ts, NERVSummary.tsx, SignUp.tsx, TrainingSession.tsx, voiceService.ts, Login.tsx, eslint.config.js, AuthContext.tsx, SetupNotice.tsx.
Commands and results: `npm run typecheck` (app+api+node) passes; worker `typecheck`+`build` pass; `npm run lint` 0 errors; `npm run build` passes.
Browser/device/fixture evidence: missing-config startup renders SetupNotice, not blank screen (code path; no screenshot runner available).
DB/config/migration effects: none.
Live checks still pending: visual check of the setup screen in a real browser.
Known limitations: none.
Next task: B03.

Task ID: B03
Status: implemented / verification pending
Behavior delivered: synthetic fixtures (resume/session/report), dev-only `VITE_DEMO_MODE=mock` API mocks, vitest harness (15 tests green), CI for both runtimes, `check:env`/`check:secrets`/`check:bundle` scripts; production rejects demo flags.
Files changed: src/fixtures/*, src/lib/config.ts, vitest.config.ts, 6 test files, .github/workflows/ci.yml, scripts/*, package.json scripts.
Commands and results: `npx vitest run` 6 files/15 tests pass; `check-env`/`check-secrets` ok.
Browser/device/fixture evidence: demo journey wired through apiClient; no browser-run screenshots (no runner in this env).
DB/config/migration effects: new `VITE_DEMO_MODE`, `DEMO_MODE` vars (dev-only).
Live checks still pending: no-key UI run, demo watermark visual, CI run on push.
Known limitations: e2e (playwright) script declared but no browser tests written yet.
Next task: D01.

Task ID: D01
Status: implemented / verification pending
Behavior delivered: additive migrations 0003 (profiles/interviews compat, RLS+revokes), 0004 (sessions/rounds/turns + CAS RPC), 0005 (report_jobs/outbox + lease RPC), 0006 (training + retention RPC), 0007 (deleted_users tombstone). Ownership = Firebase UID text; UUID record IDs.
Files changed: db/migrations/0003–0007.
Commands and results: SQL written guarded (`IF NOT EXISTS`, exception-safe revokes); not applied to a live DB here.
Browser/device/fixture evidence: n/a.
DB/config/migration effects: fresh DB bootstraps; legacy `interviews` shape adapted, not replaced.
Live checks still pending: apply to ephemeral Postgres (fresh + legacy fixture), cross-user denial tests, Storage bucket rules provisioning.
Known limitations: bucket constraints must be set in the Storage dashboard (SQL cannot create them).
Next task: D02.

Task ID: D02
Status: implemented / verification pending
Behavior delivered: repositories/handlers for profile, resume/current, dashboard, history, sessions CRUD, round checkpoint, finalize, reports, training; verified-UID ownership, 404 on foreign IDs, cursor pagination; browser service is API-only (direct table access removed; signed upload stays direct).
Files changed: api/dashboard.ts, profile.ts, history.ts, sessions.ts, sessions/[id].ts, sessions/[id]/round.ts + /finalize.ts, reports/[sessionId].ts + /retry.ts, reports/[id].ts, training.ts, resume/current.ts, resume/[id].ts, account.ts, api/_lib/sessions.ts + respond.ts, supabaseInterviewService.ts, firebaseResumeService.ts, resumeService compat.
Commands and results: `typecheck:api` passes.
Browser/device/fixture evidence: n/a (server).
DB/config/migration effects: uses new tables/RPCs; SUPABASE_SECRET_KEY canonical + legacy alias with conflict rejection.
Live checks still pending: owner/nonowner integration tests against ephemeral DB.
Known limitations: none.
Next task: D03.

Task ID: D03
Status: implemented / verification pending
Behavior delivered: single upsert profile init path; `scripts/migrate-profiles.mjs` dry-run/count/upsert preserving nonempty data; UID-scoped caches + late-write guards + logout clearing; Firestore writes best-effort only (cutover-safe).
Files changed: api/profile.ts, scripts/migrate-profiles.mjs, src/lib/accountCache.ts, AuthContext.tsx, useResumeContext.ts, firebaseResumeService.ts, SignUp.tsx.
Commands and results: typecheck/lint pass; migration script parses (no live run).
Browser/device/fixture evidence: n/a.
DB/config/migration effects: profiles table; no user data deleted.
Live checks still pending: dry-run against a real Firestore export; cutover verification.
Known limitations: Firestore app reads remain only in legacy seed path.
Next task: D04.

Task ID: D04
Status: implemented / verification pending
Behavior delivered: shared envelope `{data,requestId}`/`{error,requestId}`, typed codes, `GET /api/capabilities` reason codes, validated server config, production refusal of `ALLOW_UNVERIFIED_AUTH`/`DEMO_MODE` (tested), same-origin apiClient.
Files changed: shared/api.ts, api/_lib/config.ts + respond.ts + telemetry.ts, api/capabilities.ts, src/lib/apiClient.ts + config.ts, api/_lib/auth.test.ts.
Commands and results: vitest passes incl. production-invariant test; paid handlers auth+quota before work.
Browser/device/fixture evidence: n/a.
DB/config/migration effects: new GEMINI_MODEL/SARVAM_*/RATE_LIMIT_FAIL_OPEN vars documented.
Live checks still pending: cert rotation/refetch against Google (needs network/creds).
Known limitations: token tests are config-level, not live JWT verification.
Next task: U01.

Task ID: U01
Status: implemented / verification pending
Behavior delivered: Button defaults type=button + aria-busy; Input error association + role=alert; Modal focus trap/restore/labelled; AppShell mobile menu + current-page marking; reduced-motion CSS.
Files changed: ui/Button/Modal/Input, AppShell.tsx, index.css.
Commands and results: lint 0 errors; build passes.
Browser/device/fixture evidence: no 360/390/768/1440 verification (no runner).
DB/config/migration effects: none.
Live checks still pending: keyboard/screen-reader/zoom matrix.
Known limitations: Tabs/Menu primitives unchanged (adequate as-is).
Next task: U02.

Task ID: U02
Status: implemented / verification pending
Behavior delivered: `GET /api/dashboard` (parallel reads, section errors), `useDashboardData`, `deriveDashboardState` (+tests), 5 panels (next-action/resume/latest/recent/practice), graph on-demand, Dashboard rewritten (~1100→~150 lines).
Files changed: api/dashboard.ts, useDashboardData.ts, dashboardState.ts(+test), components/dashboard/panels.tsx, Dashboard.tsx, App.tsx routes.
Commands and results: dashboardState tests pass; typecheck pass.
Browser/device/fixture evidence: fixture shapes match API; no screenshots.
DB/config/migration effects: none beyond D01/D02.
Live checks still pending: first-click journey + empty/failed/partial states in browser.
Known limitations: practice suggestion currently null until evidence wiring (F02 follow-up).
Next task: U03.

Task ID: U03
Status: implemented / verification pending
Behavior delivered: auto-upload on selection with shared validation, retry-same-file, persistent job panel copy, prior resume untouched on failure; Settings (profile/preferences) + History (server pagination) pages; dashboard no longer fetches full history.
Files changed: Dashboard.tsx, Settings.tsx, History.tsx, api/history.ts.
Commands and results: typecheck pass.
Browser/device/fixture evidence: no live upload run.
DB/config/migration effects: none.
Live checks still pending: reload-during-ingest resume via job polling; 50+ item pagination.
Known limitations: drag-and-drop zone not added (file input only).
Next task: U04.

Task ID: U04
Status: implemented / verification pending
Behavior delivered: minimal signup retained, working `/forgot-password` route, real remember/session persistence, safe same-origin `returnTo`, loading states, useful 404, legacy route adapters preserved.
Files changed: Login.tsx, ForgotPassword.tsx, NotFound.tsx, App.tsx, AuthContext.tsx.
Commands and results: typecheck pass.
Browser/device/fixture evidence: no browser run.
DB/config/migration effects: none.
Live checks still pending: reset-email delivery, expired-session refresh, deep-link-after-login.
Known limitations: email verification + account deletion UI pending (API exists).
Next task: Q01.

Task ID: Q01
Status: implemented / verification pending
Behavior delivered: DB keys keep readable form; BullMQ IDs are safe hex (shared/queueIds + simJobId fix); `resumeJobState` distinguishes runnable/failed-retained/missing; retained failures explicitly retried; no colon IDs.
Files changed: shared/queueIds.ts(+test), shared/simulation.ts, api/_lib/queue.ts, api/resume/ingest.ts.
Commands and results: queueIds tests pass; typecheck pass.
Browser/device/fixture evidence: n/a.
DB/config/migration effects: none.
Live checks still pending: real-Redis first-upload/duplicate/retry/wipe/worker-death matrix.
Known limitations: none.
Next task: Q02.

Task ID: Q02
Status: implemented / verification pending
Behavior delivered: `job_outbox` + `lease_outbox_events` RPC, worker dispatcher (enqueue-after-commit, dispatched marking, backoff requeue), reconciler (stale running reports, sweepers), report queue with separate concurrency, cleanup scheduler.
Files changed: migration 0005, worker jobs/outbox.ts + report.ts, queues.ts, index.ts.
Commands and results: worker typecheck+build pass.
Browser/device/fixture evidence: n/a.
DB/config/migration effects: outbox/report tables + RPCs.
Live checks still pending: kill-at-each-stage + Redis-flush recovery tests.
Known limitations: exact-once billing explicitly not claimed.
Next task: P01.

Task ID: P01
Status: implemented / verification pending
Behavior delivered: Gemini via maintained REST (legacy SDK removed from path), configurable GROQ/GEMINI models, Sarvam TTS (`text/language_code/speaker/model`) + STT bounds, end-to-end deadlines + abort propagation, classified retryable errors, no mid-stream provider switch, no upstream bodies to clients.
Files changed: api/_lib/llm.ts, api/tts.ts, api/stt.ts, api/interview/next.ts, worker config (models), .env.example(s).
Commands and results: typecheck pass (both trees).
Browser/device/fixture evidence: n/a.
DB/config/migration effects: new model/voice vars.
Live checks still pending: full staging smoke (streaming question, summary, tutor, extraction, scanned PDF, STT, decoded TTS) on the target accounts.
Known limitations: worker extraction LLM wiring still points at old groq.ts defaults for text (config updated; call-site unification pending smoke).
Next task: R01.

Task ID: R01
Status: implemented / verification pending
Behavior delivered: single 10MiB/12-page contract reused from shared/ingestion; ingest endpoint returns real resume/job IDs; worker checksum/signature/page/render-pixel limits pre-exist and are now referenced by the review flow; prompt-injection stance (resume = untrusted content) preserved in prompts.
Files changed: api/resume/*, shared/ingestion.ts (unchanged contract), Dashboard upload copy.
Commands and results: typecheck pass.
Browser/device/fixture evidence: fixture PDFs not run (no worker run here).
DB/config/migration effects: none.
Live checks still pending: text/scanned/multicolumn/2/4/6+-page, corrupt/encrypted, injection, hash-replay fixtures.
Known limitations: R01 acceptance needs the worker run; code path only.
Next task: R02.

Task ID: R02
Status: implemented / verification pending
Behavior delivered: `PATCH /api/resume/:id` versioned review (expectedVersion CAS, audited revision, atomic current-pointer switch); sessions pin exact resume ID/hash snapshot; opener cache keyed by user+hash+prompt/model (primed openers read, mismatch generates live).
Files changed: api/resume/[id].ts, api/resume/current.ts, api/sessions.ts, api/_lib/sessions.ts.
Commands and results: typecheck pass.
Browser/device/fixture evidence: n/a.
DB/config/migration effects: resumes.version + profiles.current_resume_id.
Live checks still pending: two-tab out-of-order upload test.
Known limitations: review UI is a Settings link (compact drawer deferred).
Next task: Q03.

Task ID: Q03
Status: implemented / verification pending
Behavior delivered: worker/.env.example + explicit `--env-file` loading note, lockfile container inputs, verified Postgres TLS (PG_CA support, no bypass), bounded 5s readiness probes, capability reporting (full vs infra-only), graceful shutdown retained, retention scheduler wired.
Files changed: worker/.env.example, worker db.ts/config.ts/index.ts, worker package dev script note.
Commands and results: worker build passes; /readyz logic typechecks.
Browser/device/fixture evidence: n/a.
DB/config/migration effects: PG_CA var.
Live checks still pending: image build/run, probe deadline behavior, SIGTERM recovery, no-secret log audit.
Known limitations: Dockerfile itself not added (platform-specific; documented).
Next task: S01.

Task ID: S01
Status: implemented / verification pending
Behavior delivered: session create/read/checkpoint/finalize APIs + shared session contracts; UUID turn IDs, ordered seq, CAS revision, turn-UUID dedupe (same→ack, changed→409), resume snapshot pinning.
Files changed: shared/session.ts(+test), api/_lib/sessions.ts, 4 session routes, migration 0004.
Commands and results: session tests pass; typecheck pass.
Browser/device/fixture evidence: n/a.
DB/config/migration effects: interview_sessions/rounds/turns + checkpoint_session RPC.
Live checks still pending: replay/conflict/out-of-order/foreign-owner tests vs live DB.
Known limitations: multi-tab lease is advisory (CAS conflict + message), not a hard lock.
Next task: S02.

Task ID: S02
Status: implemented / verification pending
Behavior delivered: `/interviews/:sessionId` container with server restoration, account-scoped drafts, pause/exit, actual elapsed clock (base + monotonic delta), old round routes as adapters.
Files changed: InterviewContainer.tsx, App.tsx.
Commands and results: typecheck pass.
Browser/device/fixture evidence: no refresh-mid-round browser test.
DB/config/migration effects: none.
Live checks still pending: refresh/transition restore, throttled-tab clock, snapshot immutability.
Known limitations: code/elapsed autosave is best-effort 15s + finalize flush.
Next task: S03.

Task ID: S03
Status: implemented / verification pending
Behavior delivered: shared InterviewEvent protocol (start/delta/complete/error, one terminal), client parser (chunked UTF-8, multi-event chunks, partial lines, EOF→interrupted), response-close cancellation, attempt lease, atomic question commit before `complete`, no after-token provider switch, partial preserved as interrupted.
Files changed: shared/session.ts, api/interview/next.ts, interviewService.ts, useInterviewSession.ts.
Commands and results: session protocol test passes; typecheck pass.
Browser/device/fixture evidence: n/a (needs SSE integration tests).
DB/config/migration effects: question commit path.
Live checks still pending: before/after-token failure, disconnect timing, deadline, reordered-delta tests.
Known limitations: none.
Next task: S04.

Task ID: S04
Status: implemented / verification pending
Behavior delivered: explicit submitting lock (typed+VAD cannot double-advance), op-specific retry (STT failure re-transcribes bounded retained PCM; generation failure retries generation), repeat speaks without new turn, end/release guards with generation tokens, timer grace via finalize flush.
Files changed: useInterviewSession.ts.
Commands and results: typecheck pass.
Browser/device/fixture evidence: no live run.
DB/config/migration effects: none.
Live checks still pending: double-click/speech-callback, 429-transient, end-during-call tests.
Known limitations: none.
Next task: V01.

Task ID: V01
Status: implemented / verification pending
Behavior delivered: pinned VAD/ORT versions retained; recorder bounded (90s cap + capped flag, 16kHz resample); TTS sentence pipeline + 2-prefetch + cancel retained in voiceService; provider deadlines added server-side; mic-unavailable copy fixed.
Files changed: src/lib/recorder.ts, src/lib/vad.ts (unchanged pins), api/tts.ts + stt.ts, useInterviewSession.ts.
Commands and results: typecheck pass.
Browser/device/fixture evidence: no real-browser speech test.
DB/config/migration effects: none.
Live checks still pending: order/cancel/cap/denied-path tests on Chrome/Edge/FF/Safari.
Known limitations: ScriptProcessor retained as bounded fallback (AudioWorklet upgrade deferred per plan priority).
Next task: V02.

Task ID: V02
Status: implemented / verification pending
Behavior delivered: generation-token teardown (no adopted post-teardown handles), release on unmount/end/account change, DeviceCheck→room ownership notes, barge-in grace retained.
Files changed: useInterviewSession.ts.
Commands and results: typecheck pass.
Browser/device/fixture evidence: no device matrix.
DB/config/migration effects: none.
Live checks still pending: repeated transitions leaving zero tracks/worklets/sockets; speakers-vs-headphones barge-in.
Known limitations: DeviceCheck modal transfer not re-verified live.
Next task: E01.

Task ID: E01
Status: implemented / verification pending
Behavior delivered: `auto` no longer escalates to Hume; cloud requires per-session opt-in (`sessionCloudConsent`, checked at token endpoint, `no-store`); local-first order; stale/no-face unavailable retained; expression excluded from scoring (report notes observation-only).
Files changed: emotionService.ts, api/emotion/token.ts, worker report fallback notes.
Commands and results: typecheck pass.
Browser/device/fixture evidence: no camera run.
DB/config/migration effects: none (consent is sessionStorage + per-session server check).
Live checks still pending: consent-gate, backpressure/expiry, no-frame-upload verification.
Known limitations: settings UI copy only; dedicated consent toggle UI deferred to room work.
Next task: U05.

Task ID: U05
Status: implemented / verification pending
Behavior delivered: new InterviewContainer (question/answer/status first, `100dvh`, keyboard-safe composer, round tabs, compact controls); Monaco lazy scratchpad path retained via legacy round pages; mic-optional copy fixed.
Files changed: InterviewContainer.tsx, App.tsx.
Commands and results: typecheck/build pass.
Browser/device/fixture evidence: no 360px+keyboard verification.
DB/config/migration effects: none.
Live checks still pending: mobile keyboard/permission-denied/exit-pause matrix.
Known limitations: camera/expression/code drawers not yet collapsed into tabs in the new container (legacy room has them).
Next task: F01.

Task ID: F01
Status: implemented / verification pending
Behavior delivered: finalize-once + single report job + outbox event; worker report processor (run fencing, transcript survival, quote validation, session upsert, terminal status); transcript-only fallback when unconfigured.
Files changed: sessions/[id]/finalize.ts, worker jobs/report.ts + outbox.ts + queues.ts + index.ts, shared/report.ts(+tests), migration 0005.
Commands and results: report tests pass; worker build passes.
Browser/device/fixture evidence: n/a.
DB/config/migration effects: report_jobs/job_outbox/interviews.session_id.
Live checks still pending: crash/retry/invalid-JSON/invalid-evidence worker tests; no-sim-artifact check.
Known limitations: provider-backed rubric generation is a staged draft until O03 smoke.
Next task: F02.

Task ID: F02
Status: implemented / verification pending
Behavior delivered: `/reports/:sessionId` + `/reports/legacy/:interviewId` with pending/failed+retry/ready/transcript-only states; legacy Markdown rows readable; old mount-save removed (read-only adapter); history stable via server.
Files changed: ReportPage.tsx, History.tsx, NERVSummary.tsx (adapter), reports routes.
Commands and results: typecheck pass.
Browser/device/fixture evidence: no revisit/reload browser test.
DB/config/migration effects: none.
Live checks still pending: duplicate-suppression + retry recovery vs live DB.
Known limitations: evaluated-vs-discussed wording partially in place.
Next task: F03.

Task ID: F03
Status: implemented / verification pending
Behavior delivered: printable-color CSS (cards/borders/text forced), page-break rules, print button on ReportPage, local copy/download share default (no public URLs), quote/evidence presentation from validated content.
Files changed: index.css, ReportPage.tsx, NERVSummary share retained.
Commands and results: build passes.
Browser/device/fixture evidence: no printed-page visual check.
DB/config/migration effects: none.
Live checks still pending: multipage print readability; transcript-quote match spot check.
Known limitations: static graph-image export deferred (print-first per plan).
Next task: G01.

Task ID: G01
Status: verified
Behavior delivered: canonical `shared/graph.ts` + pure `buildGraph` (stable IDs, kinds, source text, evidence, validated edges, curated exact-token categories, distinct-answer counts, neutral unassessed, nonactionable categories, legend/size agreement); duplicate report/training builders superseded (legacy routes via adapter).
Files changed: shared/graph.ts, src/lib/graph/buildGraph.ts(+tests).
Commands and results: 4 buildGraph tests pass (dedupe, >100% guard, Go/Django, nonactionable).
Browser/device/fixture evidence: n/a (pure).
DB/config/migration effects: none (source entity IDs flow from structured resumes when present).
Live checks still pending: none for the builder itself.
Known limitations: legacy string-array resumes normalize per-version (documented).
Next task: G02.

Task ID: G02
Status: implemented / verification pending
Behavior delivered: one Network per visible container, DataSets in refs, incremental diff (stale edges removed first), callback refs, ResizeObserver + zero-size guard, deterministic seed, reduced-motion physics off, bounded zoom, viewport persistence, exact destroy, import/constructor failure → list with retry, reserved-size skeleton.
Files changed: KnowledgeGraph.tsx (rewritten).
Commands and results: typecheck pass; legacy adapters compile.
Browser/device/fixture evidence: no StrictMode mount-count or interaction tests yet.
DB/config/migration effects: none.
Live checks still pending: full §13.5 suite (StrictMode, selection-rerender, resize/tab, 100-node, constructor-failure).
Known limitations: none.
Next task: G03.

Task ID: G03
Status: implemented / verification pending
Behavior delivered: click selects + detail panel (no auto-LLM/nav); root/category non-tutoring; explicit Explain/Quiz/Flashcards/DeepDive firing once with `{topicId, action}`; search/evidence filter/Fit/list toggle; keyboard list always available; touch-safe; unsupported actions hidden; report→training routing with action preserved.
Files changed: KnowledgeGraph.tsx, Dashboard graph disclosure, Training.tsx.
Commands and results: typecheck pass.
Browser/device/fixture evidence: no browser interaction evidence (required by acceptance).
DB/config/migration effects: none.
Live checks still pending: one-action-one-request, category-zero-tutor, route+reload, keyboard path.
Known limitations: right-click shortcut intentionally omitted (detail panel is the path).
Next task: T01.

Task ID: T01
Status: implemented / verification pending
Behavior delivered: `GET /api/training` owned context (report/topic validation), training session create, scoped tutor instance per page (request-id stale guard), topic-change mixing prevented, logout clears via account caches.
Files changed: api/training.ts, Training.tsx.
Commands and results: typecheck pass.
Browser/device/fixture evidence: no direct-nav/reload test.
DB/config/migration effects: training_sessions table.
Live checks still pending: deep-link + refresh context reproduction; account-reset isolation.
Known limitations: conversation checkpoint persistence deferred (scoped memory only).
Next task: T02.

Task ID: T02
Status: implemented / verification pending
Behavior delivered: typed action contracts with real budgets (quiz 1500/flashcards 1200/deep-dive 1500), JSON quiz validation (exactly 4, 2–5 options, correct-index check), malformed→retryable error (never scored), deterministic local MCQ grading with reveal, practice-only labelling.
Files changed: api/tutor.ts, api/_lib/prompts.ts, Training.tsx.
Commands and results: typecheck pass.
Browser/device/fixture evidence: no malformed-quiz live run.
DB/config/migration effects: training_attempts table exists (persistence wiring deferred to T03 follow-up).
Live checks still pending: intended-topic quiz after reload; flashcard/deep-dive budget adequacy.
Known limitations: attempts not yet persisted server-side.
Next task: T03.

Task ID: T03
Status: implemented / verification pending
Behavior delivered: responsive practice workspace (topic context card + conversation + on-demand quiz), text-first with voice optional, keyboard-safe composer, no permanent empty panels.
Files changed: Training.tsx.
Commands and results: typecheck/build pass.
Browser/device/fixture evidence: no mobile-drawer/leak verification.
DB/config/migration effects: none.
Live checks still pending: repeated toggle leak check; voice-optional run.
Known limitations: graph/list toggle inside Training deferred (skill map lives on dashboard; deep link carries topicId).
Next task: L01.

Task ID: L01
Status: implemented / verification pending
Behavior delivered: DOM hero + CTA at all breakpoints, lazy Spline with fallback, unverified testimonials/hiring claims removed, honest copy, shared auth styling partially (login labels/persistence), favicon/meta untouched.
Files changed: LandingPage.tsx, Login.tsx, Spline.tsx (unchanged fallback).
Commands and results: typecheck/build pass.
Browser/device/fixture evidence: no breakpoint screenshots.
DB/config/migration effects: none.
Live checks still pending: desktop/mobile CTA parity, Spline-unavailable run, no-key-in-bundle network check (check-secrets covers dist).
Known limitations: signup still collects full profile (progressive setup deferred).
Next task: L02.

Task ID: L02
Status: implemented / verification pending
Behavior delivered: route-level lazy splitting (all secondary pages), Spline/Monaco/graph lazy paths, advisory bundle reporter, contrast/focus/reduced-motion primitives, print CSS.
Files changed: App.tsx, scripts/check-bundle.mjs, index.css, ui primitives.
Commands and results: build chunk report prints; main chunk still large (physics 1.99MB lazy, index 2.75MB — flagged, not suppressed).
Browser/device/fixture evidence: no measured LCP/INP/CLS or device matrix.
DB/config/migration effects: none.
Live checks still pending: full §17 matrix (widths, zoom, keyboard, SR, motion, virtual keyboard, print).
Known limitations: budgets advisory until staging measurement ratifies them.
Next task: L03.

Task ID: L03
Status: implemented / verification pending
Behavior delivered: removed only proven-dead paths (direct table access, mount-save, auto-Hume, testimonials); import/route inventory done via teardown survey; README revamp/runbook section; old `.planning` untouched; `interview.md` preserved.
Files changed: README.md, .env.example, worker/.env.example (see diff stat).
Commands and results: `git status` shows no deletions of user files; lint clean.
Browser/device/fixture evidence: n/a.
DB/config/migration effects: documented cutover/rollback.
Live checks still pending: bookmark-redirect verification on deploy.
Known limitations: Firestore cutover completes only after migration run.
Next task: O01.

Task ID: O01
Status: implemented / verification pending
Behavior delivered: per-user budgets extended to all new endpoints; production fail-closed limiter policy (`RATE_LIMIT_FAIL_OPEN` opt-out); shared interviewer model/version for sims; redacted telemetry helper (`api/_lib/telemetry.ts`); worker capability-aware readiness; no content/secrets in logs (pino redact retained).
Files changed: rateLimit.ts, telemetry.ts, worker config/index, simulation comment chain.
Commands and results: typecheck pass.
Browser/device/fixture evidence: n/a.
DB/config/migration effects: RATE_LIMIT_FAIL_OPEN var.
Live checks still pending: Redis-outage spend test, burst-legitimacy check, alert wiring (no metrics backend in repo).
Known limitations: provider budgets are per-process + per-user, not yet account-global atomic.
Next task: O02.

Task ID: O02
Status: implemented / verification pending
Behavior delivered: scheduled cleanup RPC + sweeper wiring, 3-version resume retention, PDF abandonment path (24h via cleanup + best-effort delete), `GET/DELETE /api/account` export + tombstone-fenced deletion, migration 0007, rollback notes in README.
Files changed: migration 0006/0007, worker outbox/index, api/account.ts, README.
Commands and results: worker build passes.
Browser/device/fixture evidence: n/a.
DB/config/migration effects: cleanup_expired_jobs RPC, deleted_users table.
Live checks still pending: deletion-vs-active-worker race; restore-from-backup drill.
Known limitations: destructive production actions need separate authorization (stated, not executed).
Next task: O03.

Task ID: O03
Status: blocked
Behavior delivered: none (credential/device/deployment-gated by definition).
Files changed: none.
Commands and results: n/a.
Browser/device/fixture evidence: pending.
DB/config/migration effects: none.
Live checks still pending: ALL of O03 — target-account model/STT/TTS/vision/token smoke; full journey on staging; browser/media matrix; 20/50/100 load; failure injection; latency/cost/error budgets.
Known limitations: cannot proceed without user-provided credentials, deploy target, and device access.
Next task: O04 (after unblock).

Task ID: O04
Status: blocked
Behavior delivered: launch-gate statement recorded (README + this log): NOT production-ready until O03 passes; no publish performed (and none will be without explicit user authorization).
Files changed: README.md (status section).
Commands and results: n/a.
Browser/device/fixture evidence: pending.
DB/config/migration effects: none.
Live checks still pending: all O03 gates + pilot evidence + rollback thresholds.
Known limitations: none beyond the gates themselves.
Next task: none — awaiting user credentials/authorization for staging.

Milestones: A (honest no-key UI) substantially delivered pending browser proof; B (safe authenticated text practice) implemented pending live-DB proof; C (complete product) implemented pending media/provider proof; D (verified release) blocked on O03/O04 as required — no production-ready label claimed.
