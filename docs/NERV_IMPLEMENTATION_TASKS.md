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

- [ ] Status: open. Dependencies: none.
- Read manifests, lockfile, tsconfigs, imports/routes, worker startup, git status. Capture current command results without installing random global tooling.
- Synchronize root lockfile with intended manifest, remove only proven obsolete deps, generate worker lockfile, pin supported Node/npm versions consistently. Do not run `npm audit fix --force` blindly.
- Files: root/worker manifests and locks, runtime version file, README prerequisites.
- Acceptance: root and worker `npm ci` succeed from clean installs; `npm ls` has no invalid required packages; native worker modules load on intended deployment OS/runtime. Record initial remaining audit entries with runtime/development distinction.

### B02 — type/lint/runtime initialization repair

- [ ] Status: open. Depends: B01.
- Resolve current app diagnostics in ErrorBoundary/Spline/firebase/reportData/NERVSummary/SignUp/TrainingSession/voiceService; re-run after dependency installation to identify true API/worker errors.
- Align ESLint/plugin versions/config, include Node globals/worker tree appropriately, ignore generated outputs. Do not disable useful rules globally to hide errors.
- Add config guards/lazy SDK access so missing Firebase/Supabase config cannot throw before the React boundary. Auth bootstrap renders loading/status independently of profile retrieval.
- Acceptance: all three root typechecks, worker typecheck/build, lint and frontend build pass; missing-config startup renders an actionable state, not blank screen.

### B03 — deterministic fixtures and meaningful test harness

- [ ] Status: open. Depends: B02.
- Add synthetic resume/transcript/report/topic/exercise fixtures and dev-only mocked API/auth. Include no resume, processing, ready, fetch error, active session, pending/failed report, graph error, denied devices.
- Set up unit/component/browser test scripts and CI; external paid APIs must not be contacted in deterministic tests. Fixture URLs or controls must be unavailable in production.
- Acceptance: a new agent can start the UI with no keys and exercise dashboard → room → report → graph → training; demo watermark is visible; production demo configuration rejected. CI runs both runtime checks.

## Phase 1 — secure application data

### D01 — complete schema and access rules

- [ ] Status: open. Depends: B03.
- Implement additive fresh/legacy migrations according to plan section 7. Keep legacy interviews and ingestion/simulation records.
- Enable RLS; revoke direct public/anon/authenticated app-table and privileged-RPC access for selected server-mediated design; provision private PDF bucket constraints. Backend/worker roles remain scoped.
- Acceptance: empty DB migrates; representative existing interviews schema migrates without data loss; direct unauthenticated cross-user table/RPC/storage operations fail. Ownership fields preserve Firebase UID text.

### D02 — authenticated repositories and browser service migration

- [ ] Status: open. Depends: D01.
- Build profile/current-resume/history/report repositories and handlers; use verified UID, bounded schemas, ownership filters, compact selects and cursor pagination.
- Rewrite existing browser `supabaseInterviewService` to call APIs; migrate callers before removing direct-client Supabase imports/config requirements. Signed upload stays direct to Storage.
- Acceptance: own read/write/delete succeeds; foreign IDs return 404; a supplied `userId` cannot change caller identity; no direct app-table calls remain in browser network/code.

### D03 — profile cutover and identity/cache lifecycle

- [ ] Status: open. Depends: D02.
- Create one idempotent profile initialization path. Provide dry-run/count/upsert Firestore profile migration and documented cutover. Do not delete user profile data.
- Namespace resume/session caches by UID+record/version, cancel/guard late writes, clear sensitive caches/drafts/opener/tutor/media state on identity changes. Remove Firestore app writes only after cutover.
- Acceptance: user B on user A's browser never receives A's resume when remote lookup fails; logout during async parse/profile fetch cannot repopulate A's cache; repeated signup/profile init does not overwrite entered details.

### D04 — capability/config/error contract

- [ ] Status: open. Depends: D02.
- Introduce runtime schemas, typed error codes and capability response. Required full-production config fails closed; optional media capability is unavailable with a clear reason.
- Refuse unverified identity/demo flags in production. Add token verification tests including malformed claims and signing certificate rotation/refetch. Same-origin API URLs centralized or unused override removed.
- Acceptance: absent/invalid configuration tests pass, errors contain no values/PII/provider bodies, paid handlers authenticate and quota-check before work/SSE.

## Phase 2 — dashboard and identity UX

### U01 — shared primitive accessibility and mobile shell

- [ ] Status: open. Depends: B03.
- Improve existing Button/Input/Textarea/Modal/Tabs/Menu/Toast, focus/error associations, reduced motion, account/mobile nav and content spacing.
- Acceptance: keyboard focus trap/return works, icon controls have names, form error announced, mobile nav reaches Dashboard/Practice/History/Settings, no tiny essential labels. Verify 360/390/768/1440 widths.

### U02 — minimal dashboard state machine

- [ ] Status: open. Depends: D02, D04, U01.
- Implement `GET /api/dashboard`, `useDashboardData`, `deriveDashboardState` and five focused panels from plan section 5.
- One next-action CTA; profile/history/settings secondary; latest report/three recent sessions/one practice suggestion; graph mounts only on request. Distinguish empty, failed and partial-success sections.
- Acceptance: no resume → upload; active session → resume; ready resume → start; pending report visible; no forced profile completion. Source selection/code/fixture states match real API shapes.

### U03 — friction-free upload and settings/history surfaces

- [ ] Status: open. Depends: U02.
- Upload starts on validated selection/drop; selected file persists for retry; job ID resumes polling after reload; previous ready resume remains usable during failed replacement.
- Move full profile form/preferences to settings; use compact history endpoint/list with server pagination; eliminate dashboard full-history fetch.
- Acceptance: one selection initiates one upload, retry reuses safe request/hash, progress not toast-only, histories over 50 items paginate, failures do not clear valid current resume.

### U04 — working auth recovery and routing

- [ ] Status: open. Depends: D03, U01.
- Minimal signup, password reset, actual remember/persistence behavior if retained, safe `returnTo`, loading/retry states, 404 and route compatibility adapters.
- Acceptance: reset link resolves/works with auth provider, expired session refresh behavior tested, protected direct report/training URL returns after login, no open redirect, no hanging profile bootstrap.

## Phase 3 — ingestion, provider and queue correctness

### Q01 — safe queue IDs and active-run fencing

- [ ] Status: open. Depends: D01, B02.
- Separate DB idempotency from safe BullMQ IDs. Add run/attempt identity to job transitions/heartbeats/finalization. Handle retained failed jobs/new user retry intentionally.
- Acceptance: real Redis test enqueues resume+sim IDs, retries retained failures, ignores terminal replays, and rejects stale run completion. No colon IDs and no queued tombstone.

### Q02 — durable outbox and reconciliation

- [ ] Status: open. Depends: Q01.
- Insert scheduling intent transactionally; dispatcher leases bounded events, enqueues after transaction, records dispatch; reconciler heals missing/stale delivery. Add safe worker loops and diagnostic statuses.
- Acceptance: kill after DB commit/before enqueue/after enqueue/before dispatch marking; restart completes once at application level. Redis flush and queued-without-worker recovery tested. External-provider billing is not falsely claimed exactly-once.

### P01 — maintained model adapters and bounded provider contracts

- [ ] Status: open. Depends: D04.
- Replace retired model assumptions and legacy Gemini library, configurable current account models; shared interviewer/sim prompt+model version.
- Update Sarvam request/voice contracts. Add deadlines across fetch+body, classified errors, abort propagation, bounded retries and mock contract fixtures. Vision model must accept images and batch limits.
- Acceptance: mocked Groq/Gemini/STT/TTS adapters pass current contracts; response decode/audio shape validated; paid staging smoke checklist records actual account model accessibility.

### R01 — extraction limits, quality routing and real resume IDs

- [ ] Status: open. Depends: Q02, P01, U03.
- One 10 MiB/12-page accepted-PDF contract across layers (record any agreed adjustment). Bucket+worker actual bytes/hash/signature/pages/render-pixel constraints.
- Route usable text/multicolumn/scanned based on quality; chunk/batch pages without omission; validate parse and provenance; return real resume ID/hash and warnings.
- Acceptance: synthetic text/scanned/multicolumn/oversize/corrupt/injection fixtures, repeated hash/reupload after cleanup, six-plus-page behavior explicit, no incomplete result labelled fully parsed.

### R02 — reviewed versions/current pointer/priming

- [ ] Status: open. Depends: R01, D03.
- Add compact fact-review/edit version flow; switch current pointer atomically; keep prior valid version on failure. Session/openers bind exact ID/hash/prompt/model.
- Acceptance: two-tab uploads out of order do not unexpectedly supersede user choice; edits preserve old report snapshot; opener mismatch generates live; user/account changes clear cached opener.

### Q03 — worker packaging/readiness/retention foundations

- [ ] Status: open. Depends: Q02, P01.
- Worker env template/explicit loading, lockfile container, TLS verification, bounded health probes, graceful shutdown, separate concurrency classes and cleanup scheduler.
- Acceptance: deployment image builds/runs, readiness distinguishes missing provider from healthy infra, probe deadlines work, SIGTERM recovers safely, no certificate validation bypass/logged secret.

## Phase 4 — durable live interviews

### S01 — session repositories and atomic checkpoints

- [ ] Status: open. Depends: D02, R02.
- Create/read/checkpoint/finalize owned session APIs and shared schemas; UUID turn IDs, ordered sequences, CAS revision, multi-tab edit conflict/lease, resume snapshot.
- Acceptance: same ID+same request replays, changed replay conflicts, foreign owner denied, out-of-order checkpoint rejected, code/elapsed snapshots remain compact.

### S02 — durable routes/recovery and real duration

- [ ] Status: open. Depends: S01, U04.
- `/interviews/:id`, server restoration, account/session-scoped checkpoints, pause/resume and actual elapsed duration. Preserve old routes as adapters.
- Acceptance: refresh mid-round/transition restores last acked work, paused state timing correct, throttled tab clock cannot gain time, previous-round answers retained, resume snapshot immutable.

### S03 — SSE terminal/cancel/fallback protocol

- [ ] Status: open. Depends: S01, P01.
- Shared event types/parser, response-close cancellation guarded for finish, generation attempt lease/idempotency, atomic completed-question commit, partial output interruption, no after-token provider switch.
- Acceptance: UTF-8/chunk framing/EOF/cancel/before-token/after-token tests; client receives one terminal event, no mixed question or late audio, complete event only after durable question save.

### S04 — operation-specific retry and one-submission engine

- [ ] Status: open. Depends: S02, S03.
- Explicit engine states and in-flight locks/generation guards; STT retry preserves bounded answer, text/VAD/manual cannot double-submit, repeat does not advance, finalization flushes captured answer policy.
- Acceptance: 429/transient STT error → retry same answer; generation error → retry generation; duplicate click/speech callback → one answer/question; end during async call cannot revive engine.

## Phase 5 — voice, expression and room

### V01 — pinned VAD, bounded recorder and ordered TTS

- [ ] Status: open. Depends: S04, P01.
- Compatible self-hostable VAD/ONNX assets, verified speech thresholds, bounded manual PCM/resampling, sentence splitter and two-request prefetch, cancel pipeline and provider deadlines.
- Acceptance: sentences play in order; long text/no punctuation handled; no audio after cancel; 90-second capture limit/recovery clear; mic denied text path usable; real browser speech test logged separately.

### V02 — hardware ownership and barge-in matrix

- [ ] Status: open. Depends: V01.
- DeviceCheck→room mic transfer/release, fresh permission checks, one active capture, speakers/headphones interruption, voice choice and cleanup on reset/unmount/logout.
- Acceptance: repeated room transitions leave zero live tracks/worklets/sockets/audio; real supported browser/device matrix includes failures rather than assuming AEC guarantees success.

### E01 — local-first expression with explicit cloud opt-in

- [ ] Status: open. Depends: D04, V02.
- Remove automatic Hume upload fallback; session consent checked at token endpoint; source/reason/schema-version observations; answer-window sampling, staleness/reset/backpressure/token expiry.
- Acceptance: local failure never uploads frames without consent; camera off clears signal; stale/no-face unavailable; expression excluded from competence scoring; no frames/tokens persisted/logged.

### U05 — compact responsive interview room

- [ ] Status: open. Depends: U01, S04, V02, E01.
- Current question/answer/status dominate; transcript available; avatar compact; code/camera/expression secondary on mobile; dynamic viewport/keyboard-safe composer and consistent round transition.
- Acceptance: 360 px keyboard leaves input/submit visible, mic optional copy correct, Monaco lazy scratchpad persists without execution, exit/pause/media behavior visible and deterministic.

## Phase 6 — durable reports

### F01 — report job/outbox/worker schema validation

- [ ] Status: open. Depends: S01, Q02, P01.
- Finalize creates one report job; worker uses stored transcript/snapshot, structured rubric/evidence, actual quote/reference validation, upserts unique session report and terminal job status.
- Acceptance: worker crash/retry/provider invalid JSON/invalid evidence tested; transcript survives; one final report row; no synthetic sim artifacts enter real report.

### F02 — addressable report UI/history/legacy adapter

- [ ] Status: open. Depends: F01, S02, U01.
- `/reports/:sessionId`, pending/failure/retry/transcript-only/ready states; saved provenance/snapshot, one practice CTA; preserve legacy Markdown/rows; remove old component-mount save behavior.
- Acceptance: revisit/reload no duplicates, retry recoverable, old reports readable without guessed evidence/snapshot, own history stable across logout/login, no invented metric.

### F03 — print/share and evidence presentation

- [ ] Status: open. Depends: F02.
- Verified print colors/page breaks; textual graph equivalent; optional chart capture; authenticated/private share/download default; clear evaluated versus discussed/unassessed terminology.
- Acceptance: multipage print readable, no dark/white-text blank sections, transcripts quotes match stored turns, no public PII URL generated by default.

## Phase 7 — working vis-network

### G01 — one canonical graph builder/schema

- [ ] Status: open. Depends: R02, F02.
- Stable topic IDs/kinds/source text/evidence, validated edges, deliberate aliases/categories, distinct answer discussion counts; replace duplicate report/training graph builders.
- Acceptance: duplicate/long/case-mixed labels stable, no >100 percentage, unmentioned neutral, category nonactionable, legend/size encoding agrees with data.

### G02 — stable Network/DataSet lifecycle

- [ ] Status: open. Depends: G01.
- One instance/visible container, compatible lazy ESM/styles, caught init failures, incremental updates, callback refs, controlled resize/visibility, bounded stabilization/zoom, viewport persistence, exact cleanup.
- Acceptance: StrictMode lifecycle test, selection/callback rerender creates no instance, resized/tab-revealed graph visible, view stable after tutor reply, constructor/import errors yield usable list.

### G03 — accessible selection/detail/action routing

- [ ] Status: open. Depends: G02, S02.
- Click selects; explicit Explain/Quiz/Flashcards/Deep dive fire once with durable topic/action/report identity. Root/category expands. Search/filter/Fit/list, touch/keyboard panel, optional real right-click shortcut.
- Acceptance: no double callbacks/spend, no unsupported dead action, full text preserved, route+reload maintains action, keyboard list equivalent, selection never requires hover. Browser interaction evidence required.

## Phase 8 — training

### T01 — durable standalone context and scoped tutor

- [ ] Status: open. Depends: G03, D02.
- Fetch owned report or current resume on direct navigation; validated query params, full topic source/context updates, scoped tutor instance/checkpoints, cancellation guards.
- Acceptance: direct Training and report deep link/reload work; topic changes do not mix replies; logout resets conversations; graph uses current loaded context rather than optional state-only data.

### T02 — typed exercises and meaningful grading

- [ ] Status: open. Depends: T01, P01.
- Action-specific API schema/model budgets for quiz/flashcards/deep-dive; JSON validation, explicit exercise UI, deterministic MCQ score/reveal, persistence and retries.
- Acceptance: report Quiz generates intended topic quiz once; malformed/truncated quiz cannot be scored; flashcards reveal; deep-dive budget adequate; no answer-key TTS dump. Failed generation creates no successful attempt.

### T03 — minimal responsive practice workspace

- [ ] Status: open. Depends: T02, V01, U01.
- Conversation default, optional topic graph/list, exercises on demand; reuse voice controller; preserve draft/answer on failure, accessible mobile drawers.
- Acceptance: no permanent empty panel, all actions usable with text only, keyboard-safe composer, selected topic/full lesson evidence visible, repeated graph/exercise toggles leak no instances/media.

## Phase 9 — polish and performance

### L01 — landing/auth consistency and truthful content

- [ ] Status: open. Depends: U04, U02.
- Real responsive DOM hero/CTA, Spline lazy/stable fallback, shared typography, favicon/meta, verified testimonial/deployment claims, no slow artwork gating signup.
- Acceptance: desktop/mobile same core value/CTA, unavailable Spline still actionable, no paid AI key in browser bundle/network, public routes work without app-data configuration.

### L02 — performance/accessibility/visual matrix

- [ ] Status: open. Depends: U05, F03, G03, T03, L01.
- Lazy routes/Spline/Monaco/PDF/graph/chart; measure budgets, meaningful contrast/focus/reduced-motion, virtual keyboard/200% zoom, print.
- Acceptance: documented route bundle sizes and mobile metrics; core routes meet or justify plan budgets; screenshot+interaction matrix for loading/empty/error/populated/media states. No warning suppression as optimization.

### L03 — safe cleanup and docs alignment

- [ ] Status: open. Depends: L02, D03.
- Remove verified unused code/deps/adapters only after live replacement gates; update README/architecture/env/runbook; mark old `.planning` analyses obsolete or revise; preserve unrelated user files.
- Acceptance: import/route/assets scan clean, old bookmarks handled, Firestore cutover accounted for, docs describe real implemented stack and feature limits.

## Phase 10 — operations and release

### O01 — global quotas/telemetry/failure visibility

- [ ] Status: open. Depends: Q03, F01, V01.
- Account-wide tokens/audio/request concurrency and per-user budgets; production limiter failure policy; circuit breakers; correlation timings/cost/error/oldest-job metrics; central exception reporting/redaction.
- Acceptance: Redis/provider outage does not allow unlimited spend, legitimate voice sentence bursts not incorrectly blocked, operator alerts fire, telemetry includes no real content/secrets/frames.

### O02 — retention/export/delete and backup/rollback

- [ ] Status: open. Depends: D03, F02, T02, Q03.
- Scheduled PDF/job/sim cleanup with reference-safe resume retention; owned export/deletion with tombstone fencing; backup/restore and compatible migration/client/API/worker rollback.
- Acceptance: deletion race with active worker cannot recreate user rows; dangling objects cleaned; referenced report snapshot retained; test restore succeeds. Destructive production actions require separately authorized rollout.

### O03 — full staging device/provider/load run

- [ ] Status: open. Depends: all earlier relevant gates.
- Real target-account model/STT/TTS/vision/token smoke; actual interview/graph/training journey; real browser/media matrix; gradual 20/50/100 concurrent mixed traffic and bounded failure injection. Use sanitized fixtures for load.
- Acceptance: stage latency/cost/error budgets recorded, quotas respected, voice answers/report survive provider/worker disruption, no key in client network except intended short-lived cloud token/public Firebase config.

### O04 — pilot and release decision

- [ ] Status: open. Depends: O01, O02, O03.
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
