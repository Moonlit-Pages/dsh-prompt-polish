import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveConfig } from '../lib/config.js';
import {
  DEFAULT_SYSTEM_PROMPT,
  OptimizeError,
  cleanOutput,
  isNearNoOp,
  normalizeForComparison,
  optimizePrompt,
} from '../lib/optimizer.js';

const config = resolveConfig({});

/**
 * @param {object[]} chunks - chunks the fake adapter yields.
 * @param {object} sink - captures prepare/stream arguments.
 */
function fakeLlm(chunks, sink) {
  return {
    async prepareCall(callConfig) {
      sink.prepare = callConfig;
      return {
        config: { ...callConfig },
        async *stream(options) {
          sink.stream = options;
          for (const chunk of chunks) yield chunk;
        },
      };
    },
  };
}

test('optimizePrompt sends the draft unchanged and returns the streamed reply', async () => {
  const sink = {};
  const llm = fakeLlm([
    { type: 'text-delta', index: 0, text: '把登录页' },
    { type: 'text-delta', index: 0, text: '改成深色主题。' },
    { type: 'finish', reason: { kind: 'stop' } },
  ], sink);

  const result = await optimizePrompt({
    llm,
    route: { provider: 'deepseek-official', model: 'deepseek-flash' },
    text: '把登录页改成深色的',
    config,
  });

  assert.deepEqual(result, {
    text: '把登录页改成深色主题。',
    provider: 'deepseek-official',
    model: 'deepseek-flash',
  });
  assert.equal(sink.prepare.provider, 'deepseek-official');
  assert.equal(sink.prepare.model, 'deepseek-flash');
  assert.equal(sink.prepare.maxTokens, config.maxOutputTokens);
  assert.equal(sink.prepare.temperature, config.temperature);
  assert.equal(sink.stream.system, DEFAULT_SYSTEM_PROMPT);
  assert.deepEqual(sink.stream.messages, [{ role: 'user', content: [{ type: 'text', text: '把登录页改成深色的' }] }]);
});

test('optimizePrompt falls back to whole text blocks when a provider sends no deltas', async () => {
  const sink = {};
  const llm = fakeLlm([
    { type: 'block-end', index: 0, block: { type: 'text', text: 'Use pnpm.\nRun the tests.' } },
    { type: 'finish', reason: { kind: 'stop' } },
  ], sink);

  const result = await optimizePrompt({ llm, route: { provider: 'p', model: 'm' }, text: 'use pnpm and test', config });
  assert.equal(result.text, 'Use pnpm.\nRun the tests.');
});

test('optimizePrompt honours a configured system prompt override', async () => {
  const sink = {};
  const llm = fakeLlm([
    { type: 'text-delta', index: 0, text: 'rewritten' },
    { type: 'finish', reason: { kind: 'stop' } },
  ], sink);
  await optimizePrompt({
    llm,
    route: { provider: 'p', model: 'm' },
    text: 'hello',
    config: resolveConfig({ systemPrompt: 'CUSTOM INSTRUCTION' }),
  });
  assert.equal(sink.stream.system, 'CUSTOM INSTRUCTION');
});

test('optimizePrompt rejects empty, non-string, and oversized drafts before the model call', async () => {
  const llm = fakeLlm([], {});
  await assert.rejects(
    optimizePrompt({ llm, route: { provider: 'p', model: 'm' }, text: '   ', config }),
    (error) => error instanceof OptimizeError && error.code === 'empty-input' && error.status === 400,
  );
  await assert.rejects(
    optimizePrompt({ llm, route: { provider: 'p', model: 'm' }, text: 42, config }),
    (error) => error instanceof OptimizeError && error.code === 'invalid-input',
  );
  await assert.rejects(
    optimizePrompt({
      llm,
      route: { provider: 'p', model: 'm' },
      text: 'x'.repeat(65),
      config: resolveConfig({ maxInputChars: 64 }),
    }),
    (error) => error instanceof OptimizeError && error.code === 'too-long' && error.status === 413,
  );
});

test('optimizePrompt maps a failed or aborted finish to OptimizeError', async () => {
  const failed = fakeLlm([
    { type: 'finish', reason: { kind: 'error', failure: { code: 'RATE_LIMIT', message: 'slow down' } } },
  ], {});
  await assert.rejects(
    optimizePrompt({ llm: failed, route: { provider: 'p', model: 'm' }, text: 'hello', config }),
    (error) => error instanceof OptimizeError && error.code === 'model-error' && /slow down/.test(error.message),
  );

  const aborted = fakeLlm([{ type: 'finish', reason: { kind: 'aborted', failure: { code: 'X', message: 'stopped' } } }], {});
  await assert.rejects(
    optimizePrompt({ llm: aborted, route: { provider: 'p', model: 'm' }, text: 'hello', config }),
    (error) => error instanceof OptimizeError && error.code === 'aborted',
  );
});

test('optimizePrompt rejects an untruncated stream and an empty reply', async () => {
  const unterminated = fakeLlm([{ type: 'text-delta', index: 0, text: 'partial' }], {});
  await assert.rejects(
    optimizePrompt({ llm: unterminated, route: { provider: 'p', model: 'm' }, text: 'hello', config }),
    (error) => error instanceof OptimizeError && error.code === 'model-error',
  );

  const empty = fakeLlm([{ type: 'text-delta', index: 0, text: '   ' }, { type: 'finish', reason: { kind: 'stop' } }], {});
  await assert.rejects(
    optimizePrompt({ llm: empty, route: { provider: 'p', model: 'm' }, text: 'hello', config }),
    (error) => error instanceof OptimizeError && error.code === 'empty-output',
  );
});

test('optimizePrompt maps route preparation failures with the requested identity', async () => {
  const llm = {
    async prepareCall() {
      throw new Error('no credential for provider');
    },
  };
  await assert.rejects(
    optimizePrompt({ llm, route: { provider: 'p', model: 'm' }, text: 'hello', config }),
    (error) => error instanceof OptimizeError
      && error.code === 'model-unavailable'
      && /p\/m/.test(error.message)
      && /no credential/.test(error.message),
  );
});

test('optimizePrompt propagates caller cancellation', async () => {
  const controller = new AbortController();
  const llm = {
    async prepareCall(_config, signal) {
      controller.abort();
      signal.throwIfAborted();
      return { config: {}, stream: async function* () {} };
    },
  };
  await assert.rejects(
    optimizePrompt({ llm, route: { provider: 'p', model: 'm' }, text: 'hello', config, signal: controller.signal }),
    (error) => error instanceof OptimizeError && error.code === 'aborted',
  );
});

test('cleanOutput strips only a wrapping fence and an explicit label', () => {
  assert.equal(cleanOutput('```\nFix the bug.\n```'), 'Fix the bug.');
  assert.equal(cleanOutput('```markdown\nFix the bug.\n```'), 'Fix the bug.');
  assert.equal(cleanOutput('Improved prompt: Fix the bug.'), 'Fix the bug.');
  assert.equal(cleanOutput('优化后的提示词：修复这个 bug。'), '修复这个 bug。');
  assert.equal(cleanOutput('Fix the bug.'), 'Fix the bug.');
  assert.equal(cleanOutput('  keep\n  indentation  '), 'keep\n  indentation');
});

test('isNearNoOp catches politeness-only rewrites and punctuation changes', () => {
  assert.equal(isNearNoOp('深入分析美国中期选举的影响。', '请深入分析美国中期选举的影响。'), true);
  assert.equal(isNearNoOp('Analyze the impact.', 'Please analyze the impact.'), true);
  assert.equal(isNearNoOp('  done  ', 'Done!'), true);
  assert.equal(
    isNearNoOp('深入分析美国中期选举的影响。', '深入分析美国中期选举的影响，要求：\n1. 说明对立法议程的影响。'),
    false,
  );
  assert.equal(normalizeForComparison('请帮我 Analyze this!', ), 'analyzethis');
});

test('optimizePrompt retries once when the reply is a no-op', async () => {
  const replies = [
    '请深入分析美国中期选举的影响。',
    '深入分析美国中期选举的影响，要求：\n1. 说明对国会立法议程、总统施政空间的影响。',
  ];
  const calls = [];
  const llm = {
    async prepareCall(callConfig) {
      const index = calls.length;
      calls.push(callConfig);
      return {
        config: { ...callConfig },
        async *stream() {
          yield { type: 'text-delta', index: 0, text: replies[index] };
          yield { type: 'finish', reason: { kind: 'stop' } };
        },
      };
    },
  };

  const result = await optimizePrompt({
    llm,
    route: { provider: 'p', model: 'm' },
    text: '深入分析美国中期选举的影响。',
    config,
  });

  assert.equal(calls.length, 2);
  assert.match(result.text, /要求/);
});

test('optimizePrompt reports no-improvement when the retry is also a no-op', async () => {
  let calls = 0;
  const llm = {
    async prepareCall(callConfig) {
      calls += 1;
      return {
        config: { ...callConfig },
        async *stream() {
          yield { type: 'text-delta', index: 0, text: '请深入分析美国中期选举的影响。' };
          yield { type: 'finish', reason: { kind: 'stop' } };
        },
      };
    },
  };

  await assert.rejects(
    optimizePrompt({
      llm,
      route: { provider: 'p', model: 'm' },
      text: '深入分析美国中期选举的影响。',
      config,
    }),
    (error) => error instanceof OptimizeError && error.code === 'no-improvement' && error.status === 422,
  );
  assert.equal(calls, 2);
});
