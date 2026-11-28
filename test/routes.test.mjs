import test from 'node:test';
import assert from 'node:assert/strict';

import { createAuthorize, createRoutes, isLoopbackRequest } from '../lib/routes.js';
import { OptimizeError } from '../lib/optimizer.js';

const config = {
  maxInputChars: 20,
  maxOutputTokens: 100,
  timeoutMs: 5000,
  temperature: 0.3,
  provider: '',
  model: '',
  systemPrompt: '',
  contextDefault: false,
  contextRounds: 5,
  contextRoundsMax: 20,
  maxContextChars: 4000,
  maxContextMessageChars: 1200,
};

function makeReq({ method = 'POST', body, headers = {}, remoteAddress = '127.0.0.1', url = '/' } = {}) {
  const payload = body === undefined ? [] : [Buffer.from(typeof body === 'string' ? body : JSON.stringify(body))];
  return {
    method,
    url,
    headers: { host: 'localhost:3082', ...headers },
    socket: { remoteAddress },
    async *[Symbol.asyncIterator]() {
      for (const chunk of payload) yield chunk;
    },
  };
}

function makeRes() {
  return {
    statusCode: 0,
    headers: {},
    writableEnded: false,
    body: '',
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    end(chunk) {
      this.writableEnded = true;
      if (chunk !== undefined) this.body += chunk;
    },
    json() { return JSON.parse(this.body); },
  };
}

function build(overrides = {}) {
  return createRoutes({
    config,
    version: '0.3.0',
    authorize: () => undefined,
    optimize: async ({ text }) => ({ text: `polished:${text}`, provider: 'p', model: 'm' }),
    ...overrides,
  });
}

test('health reports the plugin, version, and limits', async () => {
  const res = makeRes();
  await build()[0].handler(makeReq({ method: 'GET' }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().value.plugin, 'dsh-prompt-polish');
  assert.equal(res.json().value.version, '0.3.0');
  assert.equal(res.json().value.limits.maxInputChars, 20);
  assert.deepEqual(res.json().value.styles, ['structured', 'concise', 'detailed']);
  assert.deepEqual(res.json().value.context, { default: false, rounds: 5, maxRounds: 20, maxChars: 4000 });
});

test('health refuses other methods', async () => {
  const res = makeRes();
  await build()[0].handler(makeReq({ method: 'POST' }), res);
  assert.equal(res.statusCode, 405);
  assert.equal(res.headers.allow, 'GET');
});

test('optimize returns the polished envelope and forwards the session', async () => {
  const seen = [];
  const routes = build({
    optimize: async (request) => {
      seen.push(request);
      return { text: 'better', provider: 'p', model: 'm' };
    },
  });
  const res = makeRes();
  await routes[1].handler(makeReq({ body: { text: 'draft', sessionId: 's1' } }), res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { ok: true, value: { text: 'better', provider: 'p', model: 'm' } });
  assert.equal(seen[0].text, 'draft');
  assert.equal(seen[0].sessionId, 's1');
  assert.equal(seen[0].style, 'structured');
  assert.equal(seen[0].includeContext, false);
  assert.equal(seen[0].contextRounds, undefined);
  assert.ok(seen[0].signal instanceof AbortSignal);
});

test('optimize forwards an explicit context window', async () => {
  const seen = [];
  const routes = build({
    optimize: async (request) => {
      seen.push(request);
      return { text: 'better' };
    },
  });
  const res = makeRes();
  await routes[1].handler(makeReq({
    body: { text: 'draft', sessionId: 's1', includeContext: true, contextRounds: 3 },
  }), res);

  assert.equal(res.statusCode, 200);
  assert.equal(seen[0].includeContext, true);
  assert.equal(seen[0].contextRounds, 3);
});

test('optimize omits a blank session id', async () => {
  const seen = [];
  const routes = build({
    optimize: async (request) => {
      seen.push(request);
      return { text: 'better' };
    },
  });
  await routes[1].handler(makeReq({ body: { text: 'draft', sessionId: '' } }), makeRes());
  assert.equal(seen[0].sessionId, undefined);
});

test('optimize rejects an unauthenticated request before reading the body', async () => {
  const res = makeRes();
  await build({ authorize: () => 401 })[1].handler(makeReq({ body: { text: 'draft' } }), res);
  assert.equal(res.statusCode, 401);
  assert.equal(res.body, '');
});

test('optimize validates method, body, text, and size', async () => {
  const routes = build();

  const method = makeRes();
  await routes[1].handler(makeReq({ method: 'GET' }), method);
  assert.equal(method.statusCode, 405);
  assert.equal(method.headers.allow, 'POST');

  const invalid = makeRes();
  await routes[1].handler(makeReq({ body: 'not json' }), invalid);
  assert.equal(invalid.statusCode, 400);
  assert.equal(invalid.json().error.code, 'invalid-body');

  const empty = makeRes();
  await routes[1].handler(makeReq({ body: {} }), empty);
  assert.equal(empty.statusCode, 400);
  assert.equal(empty.json().error.code, 'empty-input');

  const tooLong = makeRes();
  await routes[1].handler(makeReq({ body: { text: 'x'.repeat(21) } }), tooLong);
  assert.equal(tooLong.statusCode, 413);
  assert.equal(tooLong.json().error.code, 'too-long');

  const badStyle = makeRes();
  await routes[1].handler(makeReq({ body: { text: 'draft', style: 'wild' } }), badStyle);
  assert.equal(badStyle.statusCode, 400);
  assert.equal(badStyle.json().error.code, 'invalid-style');

  for (const contextRounds of [0, 1.5, 21]) {
    const badContext = makeRes();
    await routes[1].handler(makeReq({
      body: { text: 'draft', includeContext: true, contextRounds },
    }), badContext);
    assert.equal(badContext.statusCode, 400, `rounds=${contextRounds}`);
    assert.equal(badContext.json().error.code, 'invalid-context');
  }

  const ignoredRounds = makeRes();
  await routes[1].handler(makeReq({
    body: { text: 'draft', includeContext: false, contextRounds: 999 },
  }), ignoredRounds);
  assert.equal(ignoredRounds.statusCode, 200);
});

test('optimize maps core failures to status codes and never leaks a stack', async () => {
  const noModel = makeRes();
  await build({
    optimize: async () => { throw new OptimizeError('no-model', 'no model', 409); },
  })[1].handler(makeReq({ body: { text: 'draft' } }), noModel);
  assert.equal(noModel.statusCode, 409);
  assert.equal(noModel.json().error.code, 'no-model');

  const logged = [];
  const internal = makeRes();
  await build({
    logger: { error: (message) => logged.push(message) },
    optimize: async () => { throw new Error('secret internal detail'); },
  })[1].handler(makeReq({ body: { text: 'draft' } }), internal);
  assert.equal(internal.statusCode, 500);
  assert.equal(internal.json().error.code, 'internal');
  assert.ok(!JSON.stringify(internal.json()).includes('secret internal detail'));
  assert.equal(logged.length, 1);
});

test('optimize answers 504 when the core call exceeds the timeout', async () => {
  const routes = build({
    config: { ...config, timeoutMs: 40 },
    optimize: ({ signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    }),
  });
  const res = makeRes();
  await routes[1].handler(makeReq({ body: { text: 'draft' } }), res);
  assert.equal(res.statusCode, 504);
  assert.equal(res.json().error.code, 'timeout');
});

test('optimize maps an unavailable context service to 503', async () => {
  const res = makeRes();
  await build({
    optimize: async () => { throw new OptimizeError('context-unavailable', 'no session query', 503); },
  })[1].handler(makeReq({ body: { text: 'draft', includeContext: true } }), res);
  assert.equal(res.statusCode, 503);
  assert.equal(res.json().error.code, 'context-unavailable');
});

test('optimize answers 499 for a non-timeout abort', async () => {
  const routes = build({
    optimize: async () => { throw Object.assign(new Error('cancelled'), { name: 'AbortError' }); },
  });
  const res = makeRes();
  await routes[1].handler(makeReq({ body: { text: 'draft' } }), res);
  assert.equal(res.statusCode, 499);
  assert.equal(res.json().error.code, 'aborted');
});

test('createAuthorize prefers the connection fence and falls back to loopback', () => {
  assert.equal(createAuthorize(() => ({ requestRejection: () => undefined }))(makeReq()), undefined);
  assert.equal(createAuthorize(() => ({ requestRejection: () => 401 }))(makeReq()), 401);
  assert.equal(createAuthorize(() => ({ requestRejection: () => undefined }))(makeReq({
    remoteAddress: '203.0.113.9',
  })), undefined, 'an admitted remote request is allowed');
  assert.equal(createAuthorize(undefined)(makeReq()), undefined);
  assert.equal(createAuthorize(undefined)(makeReq({ remoteAddress: '203.0.113.9' })), 403);
  assert.equal(createAuthorize(undefined)(makeReq({ headers: { 'sec-fetch-site': 'cross-site' } })), 403);
  assert.equal(createAuthorize(() => { throw new Error('missing'); })(makeReq()), undefined);
});

test('isLoopbackRequest accepts only loopback host and socket', () => {
  assert.equal(isLoopbackRequest(makeReq()), true);
  assert.equal(isLoopbackRequest(makeReq({ headers: { host: 'evil.example:3082' } })), false);
  assert.equal(isLoopbackRequest(makeReq({ remoteAddress: '10.0.0.4' })), false);
});
