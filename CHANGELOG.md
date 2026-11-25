# Changelog

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
