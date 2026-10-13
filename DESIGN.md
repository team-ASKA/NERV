# NERV app UI: the quiet rehearsal room (dashboard + training)

Scope: everything past the landing hero. The hero is untouched. Stack: the
project's own React 18 + Vite + Tailwind system (existing-project rule).

## Brief

- Subject: NERV, a voice-first mock interview coach. Grounded questions,
  three rounds, evidence-based report, topic tutoring.
- Audience: candidates preparing for interviews, on desktop and phones.
- Job of these screens: one calm next step. Dashboard answers "what now" in
  under 3 seconds. Training answers "what are we working on" at a glance.
- Complaint: visual fatigue. Every panel is the same weight card, indigo
  everywhere, small gray text competing in grids. Fix by hierarchy, not chrome.
- Constraints: keep near-black/indigo tone, Inter/Montserrat, 1120px dashboard
  cap, all behavior and routes unchanged, AA contrast, reduced-motion paths.

## Concepts (three territories)

A. Material, the rehearsal room. The app is a quiet studio after hours: one
lit stage (the single next action) and dark wings (everything else, matte and
ruled). Signature: the stage settles once on load, a thin light hairline
carries status. Anchor: the product is literally interview rehearsal.
Scores (originality/fit/feasibility/portability): 4/5/5/2.

B. Process, the setlist. Prep as a gig setlist: tonight's set, played,
encore. Signature: rows that play through with a progress hairline. Anchor:
three rounds plus practice map naturally to a set. Scores: 3/4/4/3. Legible
but gig language fights a nervous candidate's calm.

C. Formal, one column one job. A strict single reading column; each block owns
exactly one typographic job. Signature: nothing moves except the stage light.
Anchor: none from the subject, pure system. Scores: 3/3/5/4. Portable to
anyone, so it fails the swap test.

Pick A. One line reason: only the rehearsal room comes from what the product
is, and it directly prescribes the fatigue fix (one lit thing, dark wings).

```
Idea:        the app is a quiet rehearsal room, one lit stage, dark wings
Metaphor:    a studio after hours, the stage lamp on, the house dim
Signature:   the stage panel settles once on load, a hairline carries status
Emotion:     first 3 seconds feel like walking into a calm empty studio
Motion verb: settle like a lamp warming up, quick and once, then still
Screenshot:  dashboard stage with the single CTA under a soft top light
```

Runner-up steal: none. The 404 keeps its useful form.

## System

Palette (roles, all AA on ground unless noted):
- ground `#080808` (page), stage `#121218` (the one lit surface, top light)
- ink `#F5F5F6`, muted `#A9ABB4` (body secondary, 7+:1 on ground)
- faint `#7E818B` (meta only, 4.6:1, 12px and up)
- line `rgba(255,255,255,0.09)` hairlines, signal `#F5F5F6` (the primary
  action and active states ONLY, never decoration), curtain `#050506`.
- No hue anywhere in chrome. Status keeps its own hues (green/amber/red);
  graph evidence keeps supported green and needs-practice amber, discussed
  is light gray. Visual language is carried by weight and spacing.

Type: Montserrat 700 display (greeting, stage title, topic), tight tracking
-0.02em, leading 1.04 to 1.08. Inter for everything else, 15-16px body, 1.55
leading, measure under 60ch. System mono (`font-mono`) speaks for the
machine: 12px uppercase eyebrows, ledger labels, status hairlines. Tabular
numerals for counts and timers. No new families: the tone stays the project's.

Type: Montserrat 600 display (greeting, stage title, topic), tight tracking
-0.02em, leading 1.05. Inter for everything else, 15-16px body, 1.55 leading,
measure under 60ch. Tabular numerals for counts and timers. No new families:
the tone stays the project's.

Grid and rhythm: dashboard max 960 centered (inside the 1120 cap), one column.
Stage full width. Wings as ruled rows, never a 2x2 card grid. Training max 860
single column, composer sticky at the bottom. Moods: stage airy (32px inside),
wings tight (12px rows), disclosures normal.

Shape: one radius rule, 14px surfaces, 10px controls. Hairline borders only,
no glow shadows except the stage top light (static gradient, not a shadow).

Motion: one ease `cubic-bezier(0.22, 0.61, 0.21, 1)`. Micro 180ms, panels
320ms, stagger 40ms. The stage settles once (opacity, translateY 6px). Nothing
else animates on load. Reduced motion: everything simply appears.

Composition plan (ASCII, one family per block):
- Dashboard: poster greeting (display line + one status sentence) / stage
  (spotlit panel, title left, CTA bottom-left, status hairline under) /
  ledger (ruled rows: resume, report, sessions, practice) / disclosure
  (skill map, mounts on demand) / small print (signed-in line).
- Training: marquee topic (large topic, mode tabs as quiet segmented row) /
  dialogue (user right-plain, tutor left-ruled, no cards) / quiz as the stage
  (single panel, radio rows ruled) / sticky composer (input + send, one row).

Genericness test: a generic model would ship a 2x2 SaaS card grid, indigo glow
on every panel, eyebrow labels and gradient washes. Changed: wings are ruled
ledger rows, the single signal is white and fires once per screen, surfaces
matte, section titles are plain sentences, no glow, no wash, no hue in chrome.
Machine-mono labels plus weight contrast (700 display vs 400 meta) carry the
futuristic interviewer voice instead of color.

Copy rules: sentence case, no em or en dashes in visible text, specific nouns,
numbers only when true. Placeholders: none added (all content is real app
state); demo fixtures remain clearly labelled dev-only.

## QA (two critic passes, production-feel harness)

Harness: `scripts/shots.mjs` (desktop 1440, phone 390, reduced-motion phone,
keyboard-focus frames) over 7 routes on a demo-mode build. Zero console
errors, zero overflow on every route after fixes. Checks: typecheck (3 trees),
lint 0 errors, 15 vitest green, vite build green.

Bugs the screenshots caught and fixed: History crash in demo (envelope not
unwrapped), mobile home overflow (toast viewport + reveal transforms),
topic chips gated on user (now fetch without identity), "there." orphan,
wrapping mode tab, hairline SetupNotice, dead training/history/404 states,
icon-only mobile menu.

Critic pass 1: 5.7 (hero collision, env dump, dead ends). Critic pass 2 after
the monochrome turn: 6.8, idea reads as "a calm, monochrome voice-first
coach". Hero findings declined: the hero is out of scope for this pass and
stays as the owner left it. Remaining lift sits with real user data (reports,
topics, imagery) and the hero, both outside this brief.
