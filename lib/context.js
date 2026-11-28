/**
 * Recent-session context for one polish request.
 *
 * The Host reads the current model surface through `ctx.sessionQuery`; this
 * module turns that surface into a bounded, plainly labelled transcript. It
 * never persists or logs the transcript and it drops system/developer/tool
 * messages, so the caller sends only recent human/assistant turns.
 *
 * @module dsh-prompt-polish/context
 */

import { OptimizeError } from './optimizer.js';

/** Marker inserted where a message or the transcript was cut. */
export const CONTEXT_TRUNCATION_MARKER = '...(truncated)...';

/**
 * Truncate one message to a head/tail budget. Short text is returned as-is.
 *
 * @param {string} text - message text.
 * @param {number} maxChars - maximum kept characters.
 * @returns {{ text: string, truncated: boolean }} bounded text.
 */
export function truncateMessage(text, maxChars) {
  if (typeof text !== 'string') return { text: '', truncated: false };
  const limit = Math.max(16, Math.floor(maxChars));
  if (text.length <= limit) return { text, truncated: false };
  const head = Math.max(1, Math.floor((limit - CONTEXT_TRUNCATION_MARKER.length) * 0.55));
  const tail = Math.max(1, limit - head - CONTEXT_TRUNCATION_MARKER.length);
  return {
    text: `${text.slice(0, head)}${CONTEXT_TRUNCATION_MARKER}${text.slice(-tail)}`,
    truncated: true,
  };
}

/**
 * Extract plain text from a Session surface message content. Tool/image/file
 * blocks contribute no text.
 *
 * @param {unknown} content - message content (string or block array).
 * @returns {string} joined text.
 */
export function extractText(content) {
  if (typeof content === 'string') return content.trim();
  if (!Array.isArray(content)) return '';
  const parts = [];
  for (const block of content) {
    if (typeof block === 'string') {
      parts.push(block);
    } else if (block !== null && typeof block === 'object' && block.type === 'text' && typeof block.text === 'string') {
      parts.push(block.text);
    }
  }
  return parts.join('\n').trim();
}

/** A surface event is a direct human prompt when its source is the user. */
function isHumanPrompt(message) {
  const kind = message?.source?.kind;
  return kind === 'user' || kind === undefined;
}

/**
 * Build a bounded transcript from an already-read surface snapshot.
 *
 * @param {{ events?: readonly object[] }} snapshot - `sessionQuery.readSurface()` result.
 * @param {number} rounds - number of recent user/assistant turns to keep.
 * @param {number} maxChars - total transcript character budget.
 * @param {number} maxMessageChars - per-message character budget.
 * @returns {{ text: string, turns: number, chars: number, truncated: boolean }} context.
 */
export function buildContextFromSurface(snapshot, rounds, maxChars, maxMessageChars) {
  const events = Array.isArray(snapshot?.events) ? snapshot.events : [];
  const messages = [];
  for (const event of events) {
    if (event?.type !== 'user/message' && event?.type !== 'assistant/message') continue;
    const message = event.data;
    if (event.type === 'user/message' && !isHumanPrompt(message)) continue;
    const raw = extractText(message?.content);
    if (raw === '') continue;
    const bounded = truncateMessage(raw, maxMessageChars);
    messages.push({
      role: event.type === 'user/message' ? 'user' : 'assistant',
      text: bounded.text,
      truncated: bounded.truncated,
    });
  }

  // Keep the most recent `rounds` user/assistant messages (a round is one
  // user message plus its assistant reply, so a message window of 2*rounds).
  const window = messages.slice(-Math.max(2, rounds * 2));
  let selected = window;
  let total = selected.reduce((sum, message) => sum + message.text.length, 0);
  while (selected.length > 1 && total > maxChars) {
    total -= selected[0].text.length;
    selected = selected.slice(1);
  }

  let truncated = selected.some((message) => message.truncated);
  if (selected.length < window.length) truncated = true;
  if (selected.length > 0 && total > maxChars) {
    const bounded = truncateMessage(selected[selected.length - 1].text, maxChars);
    selected = [...selected.slice(0, -1), { ...selected[selected.length - 1], text: bounded.text, truncated: true }];
    truncated = true;
    total = selected.reduce((sum, message) => sum + message.text.length, 0);
  }

  const text = selected.map((message) => `[${message.role}] ${message.text}`).join('\n\n');
  return {
    text,
    turns: selected.filter((message) => message.role === 'user').length,
    chars: total,
    truncated,
  };
}

/**
 * Read recent human/assistant turns for one live session.
 *
 * @param {object} options - read options.
 * @param {{ readSurface?: Function } | undefined} options.sessionQuery - Host session query service.
 * @param {string | undefined} options.sessionId - session to read.
 * @param {number} options.rounds - requested recent rounds.
 * @param {number} options.maxChars - total context budget.
 * @param {number} options.maxMessageChars - per-message budget.
 * @returns {Promise<{ text: string, turns: number, chars: number, truncated: boolean }>} context.
 * @throws {OptimizeError} when context is requested but unavailable.
 */
export async function readRecentContext({ sessionQuery, sessionId, rounds, maxChars, maxMessageChars }) {
  if (typeof sessionQuery?.readSurface !== 'function') {
    throw new OptimizeError(
      'context-unavailable',
      'Recent-session context was requested, but the Host session query service is unavailable.',
      503,
    );
  }
  if (typeof sessionId !== 'string' || sessionId === '') {
    throw new OptimizeError(
      'context-unavailable',
      'Recent-session context was requested without a session id.',
      400,
    );
  }

  let snapshot;
  try {
    snapshot = await sessionQuery.readSurface(sessionId);
  } catch (error) {
    throw new OptimizeError(
      'context-read-failed',
      `Could not read the recent session context: ${String(error?.message ?? error)}`,
      502,
    );
  }

  return buildContextFromSurface(snapshot, rounds, maxChars, maxMessageChars);
}
