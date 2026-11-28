import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CONTEXT_TRUNCATION_MARKER,
  buildContextFromSurface,
  extractText,
  readRecentContext,
  truncateMessage,
} from '../lib/context.js';
import { OptimizeError } from '../lib/optimizer.js';

function textBlock(text) {
  return [{ type: 'text', text }];
}

const surface = {
  events: [
    { type: 'system/message', data: { role: 'system', content: textBlock('SYSTEM') } },
    { type: 'user/message', data: { role: 'user', source: { kind: 'user' }, content: textBlock('first question') } },
    { type: 'assistant/message', data: { role: 'assistant', source: { kind: 'model' }, content: textBlock('first answer') } },
    { type: 'user/message', data: { role: 'user', source: { kind: 'agent-inject' }, content: textBlock('INJECTED CONTEXT') } },
    { type: 'tool/result', data: { role: 'tool', content: textBlock('TOOL RESULT') } },
    { type: 'user/message', data: { role: 'user', source: { kind: 'user' }, content: textBlock('second question') } },
    { type: 'assistant/message', data: { role: 'assistant', source: { kind: 'model' }, content: textBlock('second answer') } },
  ],
};

test('buildContextFromSurface keeps recent human/assistant turns only', () => {
  const context = buildContextFromSurface(surface, 1, 1000, 500);
  assert.match(context.text, /second question/);
  assert.match(context.text, /second answer/);
  assert.doesNotMatch(context.text, /first question/);
  assert.doesNotMatch(context.text, /INJECTED/);
  assert.doesNotMatch(context.text, /TOOL RESULT/);
  assert.doesNotMatch(context.text, /SYSTEM/);
  assert.equal(context.turns, 1);
  assert.equal(context.truncated, false);
});

test('buildContextFromSurface keeps both turns when rounds allow', () => {
  const context = buildContextFromSurface(surface, 5, 1000, 500);
  assert.match(context.text, /first question/);
  assert.match(context.text, /second answer/);
  assert.equal(context.turns, 2);
});

test('buildContextFromSurface enforces the total character budget by dropping old turns', () => {
  const context = buildContextFromSurface(surface, 5, 30, 500);
  assert.ok(context.chars <= 30, `chars=${context.chars}`);
  assert.match(context.text, /second/);
  assert.equal(context.truncated, true);
});

test('truncateMessage keeps both ends and marks the cut', () => {
  const source = `HEAD${'x'.repeat(200)}TAIL`;
  const bounded = truncateMessage(source, 60);
  assert.equal(bounded.truncated, true);
  assert.ok(bounded.text.length <= 60, `length=${bounded.text.length}`);
  assert.match(bounded.text, /^HEAD/);
  assert.match(bounded.text, /TAIL$/);
  assert.ok(bounded.text.includes('...(truncated)...'));
  assert.equal(CONTEXT_TRUNCATION_MARKER, '...(truncated)...');
});

test('extractText ignores non-text blocks', () => {
  assert.equal(extractText([
    { type: 'text', text: 'hello' },
    { type: 'image', attachment: { attachmentId: 'a' } },
    { type: 'text', text: 'world' },
  ]), 'hello\nworld');
  assert.equal(extractText([{ type: 'image' }]), '');
  assert.equal(extractText('plain'), 'plain');
});

test('readRecentContext asks the host service for the current surface', async () => {
  const seen = [];
  const context = await readRecentContext({
    sessionQuery: {
      async readSurface(sessionId) {
        seen.push(sessionId);
        return surface;
      },
    },
    sessionId: 'session-1',
    rounds: 2,
    maxChars: 1000,
    maxMessageChars: 500,
  });

  assert.deepEqual(seen, ['session-1']);
  assert.equal(context.turns, 2);
  assert.ok(context.text.includes('second answer'));
});

test('readRecentContext reports a missing service or session', async () => {
  await assert.rejects(
    readRecentContext({
      sessionQuery: undefined,
      sessionId: 'session-1',
      rounds: 2,
      maxChars: 1000,
      maxMessageChars: 500,
    }),
    (error) => error instanceof OptimizeError && error.code === 'context-unavailable' && error.status === 503,
  );

  await assert.rejects(
    readRecentContext({
      sessionQuery: { readSurface: async () => surface },
      sessionId: '',
      rounds: 2,
      maxChars: 1000,
      maxMessageChars: 500,
    }),
    (error) => error instanceof OptimizeError && error.code === 'context-unavailable' && error.status === 400,
  );
});

test('readRecentContext maps surface read failures', async () => {
  await assert.rejects(
    readRecentContext({
      sessionQuery: { readSurface: async () => { throw new Error('db locked'); } },
      sessionId: 'session-1',
      rounds: 2,
      maxChars: 1000,
      maxMessageChars: 500,
    }),
    (error) => error instanceof OptimizeError && error.code === 'context-read-failed' && /db locked/.test(error.message),
  );
});
