# Prompt polish

Adds a **Polish** button beside the model selector in the composer tool row, with one-click undo.

- **Polish** sends the current draft to the Host, rewrites it with the model selected for the session, and replaces the draft.
- **Undo** restores the exact text captured before the polish, without another model call.
- **No silent overwrite**: if you keep typing while the request is in flight, or edit the draft afterwards, the result is not applied and undo refuses to run. Both cases surface an explicit notice.

## Install

Open **Settings → Plugins → Add plugin**, choose this directory (the one containing `package.json`), enable it, then reload the page. The button appears in the composer tool row.

## Behaviour

- Empty drafts disable the button.
- Drafts containing `@file` references disable the button: replacing the draft would drop the reference chips, so the plugin refuses instead of losing them.
- A failed polish leaves the draft untouched and shows the reason in a dismissible strip above the composer card, including the blank new-session composer.
- The polish route uses the session's selected model, then the profile default, then fails with a clear error.
- The same operation is exposed as the agent tool `polish_prompt`.

## Configuration

Override the `prompt-polish` row's `config` in the profile `cordis.patch.yml`: `maxInputChars`, `maxOutputTokens`, `timeoutMs`, `temperature`, optional `provider`/`model`, and optional `systemPrompt`.

## Limits

Requires the Host `llm` service and provider credentials. Each polish is one real model call. The result arrives in one piece, not streamed. Undo keeps only the most recent polish.

## Development

```sh
npm test
npm run preflight
```

MIT © 2026 Moonlit Pages
