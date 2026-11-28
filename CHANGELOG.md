# Changelog

## 0.3.0 — 2026-11-28

- P0: added a slot-level React error boundary so a component crash cannot blank the composer.
- P0: loading strip now shows elapsed seconds and a **Cancel** action; cancelling restores the previous successful step.
- P0: `/optimize` returns `meta` (style, actual System Prompt, model, input length, retry count, context stats) and the ⓘ button opens a read-only request-details card.
- P0: every successful polish is recorded (up to 5 steps); **Undo** walks back one step and the main button becomes **Polish again** for iteration.
- P1-1: opt-in recent-session context (off by default) read through `ctx.sessionQuery.readSurface()`, filtered to human/assistant messages with head/tail truncation and total/per-message budgets. The UI exposes 0/3/5/10/20 rounds.
- Added `lib/context.js`, context config fields, `include_context`/`context_rounds` tool parameters, and 16 new tests (56 total).

## 0.2.0 — 2026-11-25

- Moved the entry to the left of the composer tool row and renamed it to **AI polish**.
- Added `structured` / `concise` / `detailed` styles, selectable in the composer and remembered in localStorage (style id only, never prompt text).
- Default input limit is now 12000 characters; the client reads the live limit from `/health` and disables the button with a localized reason before sending.
- Documented code-block/inline-code preservation and the no-logging posture of the button path.
- Added style instructions and regression tests (40 total).

## 0.1.1 — 2026-11-25

- Stronger rewrite policy: a vague one-line goal expands into a structured prompt with analysis dimensions, output shape, and acceptance criteria; a concrete request that already names files, constraints, and deliverables stays close to the original.
- Near-no-op guard: a reply that only adds 「请」/「麻烦」/「please」 is retried once with an explicit correction, then reported as `no-improvement` instead of replacing the draft with an identical prompt.
- Custom `systemPrompt` overrides keep full control and skip the automatic retry.

## 0.1.0 — 2026-11-25

- First release.
- Composer tool-row buttons: **Polish** (session model, configurable override) and **Undo** (restores the exact pre-polish draft).
- Explicit refusal instead of overwriting a changed draft.
- Dismissible error strip under the composer.
- `polish_prompt` agent tool sharing the same Host operation.
- `GET /api/dsh-prompt-polish/health` self-check route.
- zh / en UI dictionaries and display metadata.
