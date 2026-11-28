# Prompt polish

Adds an **AI polish** button on the left of the composer tool row, a three-way style selector, an optional recent-session context window, request details, and multi-step undo.

- **AI polish** sends the current draft to the Host, rewrites it with the model selected for the session, and writes the result back without sending.
- Styles: structured (numbered requirements and output shape), concise (shortest unambiguous version), and detailed (scope, constraints, edge cases, acceptance criteria). The choice is remembered; only the style id is stored.
- **Undo** steps back one successful polish at a time (up to five), without another model call. The same button becomes **Polish again** after a success, so you can keep refining the current result.
- **Cancel** is available while a request runs, with the elapsed time shown.
- **Details** (ⓘ) show the model, style, input length, context statistics, and the actual System Prompt sent for that request; this stays in browser memory.
- **No silent overwrite**: if you keep typing while the request is in flight, or edit the draft afterwards, the result is not applied and undo refuses to run. Both cases surface an explicit notice.

## Install

Open **Settings → Plugins → Add plugin**, choose this directory (the one containing `package.json`), enable it, then reload the page. The button appears in the composer tool row.

## Behaviour

- Vague one-line goals expand into a structured prompt; concrete requests that already name files, constraints, and deliverables stay close to the original.
- A reply that only adds 「请」/「please」 is retried once, then reported as `no-improvement` instead of replacing the draft.
- Empty drafts, drafts with references, and drafts over the configured 12000-character limit disable the button with a visible reason.
- Context is opt-in and off by default. When enabled, only recent human/assistant turns are read; system, tool, and project content are excluded, and the transcript is truncated to the configured budget. It is never logged or persisted.
- Drafts containing `@file` references disable the button: replacing the draft would drop the reference chips, so the plugin refuses instead of losing them.
- A failed polish leaves the draft untouched and shows the reason in a dismissible strip above the composer card, including the blank new-session composer.
- The polish route uses the session's selected model, then the profile default, then fails with a clear error.
- The same operation is exposed as the agent tool `polish_prompt`.

## Configuration

Override the `prompt-polish` row's `config` in the profile `cordis.patch.yml`: `maxInputChars`, `maxOutputTokens`, `timeoutMs`, `temperature`, optional `provider`/`model`, optional `systemPrompt`, and context fields (`contextDefault`, `contextRounds`, `contextRoundsMax`, `maxContextChars`, `maxContextMessageChars`).

## Limits

Requires the Host `llm` service and provider credentials. A polish normally makes one real model call, and a near-no-op first reply triggers one retry. The button path never logs or stores the prompt text or context; they are sent only to the selected provider for that request. The result arrives in one piece, not streamed. Undo keeps up to five steps; older steps are dropped.

## Development

```sh
npm test
npm run preflight
```

MIT © 2026 Moonlit Pages
