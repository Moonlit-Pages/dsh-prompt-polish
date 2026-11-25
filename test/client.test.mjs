import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const source = fs.readFileSync(path.join(root, 'lib', 'client.js'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

/** Load the browser bundle exactly as the page's module loader would. */
function loadBundle() {
  let entry;
  const documentStub = {
    head: { appendChild() {} },
    getElementById() { return null; },
    createElement() { return { id: '', textContent: '', remove() {} }; },
  };
  const sandbox = {
    window: { __ModuleLoader__: { load(plugin) { entry = plugin; } } },
    document: documentStub,
    console,
    setTimeout,
    clearTimeout,
    AbortController,
    fetch: () => { throw new Error('fetch not stubbed'); },
  };
  vm.runInNewContext(source, sandbox, { filename: 'lib/client.js' });
  assert.ok(entry, 'the bundle must self-register');
  const plugin = entry.factory((id) => {
    if (id === 'react') return { createElement: () => null };
    throw new Error(`unexpected require: ${id}`);
  });
  return { entry, plugin };
}

const { entry, plugin } = loadBundle();
const { createStore, createController, canOptimize, canUndo } = plugin.__test;

function jsonResponse(payload, { ok = true, status = 200 } = {}) {
  return { ok, status, json: async () => payload };
}

test('the bundle id equals the package name and exposes its two services', () => {
  assert.equal(entry.id, manifest.name);
  assert.deepEqual([...plugin.inject], ['slots', 'locale']);
  assert.equal(typeof plugin.apply, 'function');
});

test('apply registers the toolbar buttons and the status strip', () => {
  const registrations = [];
  let effects = 0;
  const ctx = {
    effect(fn) {
      effects += 1;
      fn();
      return () => {};
    },
    locale: {
      register() { return () => {}; },
      bind() { return (key) => key; },
    },
    slots: {
      inject(_key, callback) { callback(); return () => {}; },
      register(options, component) {
        registrations.push({ options, component });
        return () => {};
      },
    },
  };

  plugin.apply(ctx);

  assert.equal(effects, 3);
  assert.equal(registrations.length, 2);
  assert.deepEqual(registrations.map((r) => r.options.name), [
    'conversation.input.right',
    'conversation.composer.dock',
  ]);
  assert.deepEqual(registrations.map((r) => r.options.id), ['prompt-polish', 'prompt-polish-status']);
  for (const registration of registrations) {
    assert.equal(typeof registration.component, 'function');
  }
});

test('optimize replaces the draft and undo restores it exactly', async () => {
  const store = createStore();
  const calls = [];
  const controller = createController(store, {
    api: '/api/dsh-prompt-polish/optimize',
    fetch: async (url, init) => {
      calls.push({ url, init });
      return jsonResponse({ ok: true, value: { text: 'POLISHED' } });
    },
  });

  let draft = '  original draft  ';
  const setDraft = (value) => { draft = value; };
  const result = await controller.optimize({
    text: draft,
    sessionId: 'session-1',
    setDraft,
    getDraft: () => draft,
  });

  assert.equal(result.ok, true);
  assert.equal(draft, 'POLISHED');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers['content-type'], 'application/json');
  assert.equal(calls[0].init.credentials, 'same-origin');
  assert.deepEqual(JSON.parse(calls[0].init.body), { text: '  original draft  ', sessionId: 'session-1' });
  assert.equal(store.get().status, 'done');
  assert.equal(store.get().before, '  original draft  ');
  assert.equal(store.get().after, 'POLISHED');

  assert.equal(canUndo(store.get(), draft).enabled, true);
  const undone = controller.undo({ setDraft, getDraft: () => draft });
  assert.equal(undone.ok, true);
  assert.equal(draft, '  original draft  ');
  assert.equal(store.get().status, 'idle');
});

test('undo refuses to overwrite a draft the user changed', async () => {
  const store = createStore();
  const controller = createController(store, {
    fetch: async () => jsonResponse({ ok: true, value: { text: 'POLISHED' } }),
  });
  let draft = 'original';
  const setDraft = (value) => { draft = value; };
  await controller.optimize({ text: draft, setDraft, getDraft: () => draft });

  draft = 'edited by hand';
  const decision = canUndo(store.get(), draft);
  assert.equal(decision.visible, true);
  assert.equal(decision.enabled, false);

  const result = controller.undo({ setDraft, getDraft: () => draft });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'draft-changed');
  assert.equal(draft, 'edited by hand');
  assert.equal(store.get().status, 'error');
  assert.equal(store.get().error.code, 'draft-changed');
});

test('a draft changed in flight is never clobbered', async () => {
  const store = createStore();
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const controller = createController(store, {
    fetch: async () => {
      await gate;
      return jsonResponse({ ok: true, value: { text: 'POLISHED' } });
    },
  });

  let draft = 'original';
  const setDraft = (value) => { draft = value; };
  const pending = controller.optimize({ text: draft, setDraft, getDraft: () => draft });
  draft = 'typed while waiting';
  release();

  const result = await pending;
  assert.equal(result.code, 'draft-changed');
  assert.equal(draft, 'typed while waiting');
  assert.equal(store.get().status, 'error');
});

test('a newer request supersedes an older one', async () => {
  const store = createStore();
  const releases = [];
  const controller = createController(store, {
    fetch: async () => {
      const gate = new Promise((resolve) => releases.push(resolve));
      await gate;
      return jsonResponse({ ok: true, value: { text: 'POLISHED' } });
    },
  });

  let draft = 'first';
  const setDraft = (value) => { draft = value; };
  const first = controller.optimize({ text: 'first', setDraft, getDraft: () => draft });
  draft = 'second';
  const second = controller.optimize({ text: 'second', setDraft, getDraft: () => draft });

  releases[0]();
  releases[1]();
  const firstResult = await first;
  const secondResult = await second;

  assert.equal(firstResult.code, 'superseded');
  assert.equal(secondResult.ok, true);
  assert.equal(draft, 'POLISHED');
});

test('server failures, network failures, and empty replies surface as errors', async () => {
  const store = createStore();
  const controller = createController(store, {
    fetch: async () => jsonResponse({ ok: false, error: { code: 'no-model', message: 'no model' } }, { ok: false, status: 409 }),
  });
  let draft = 'original';
  const failed = await controller.optimize({ text: draft, setDraft: (v) => { draft = v; }, getDraft: () => draft });
  assert.equal(failed.code, 'no-model');
  assert.equal(store.get().status, 'error');
  assert.equal(store.get().error.code, 'no-model');

  const networkStore = createStore();
  const network = createController(networkStore, {
    fetch: async () => { throw new TypeError('Failed to fetch'); },
  });
  const networkResult = await network.optimize({ text: draft, setDraft: (v) => { draft = v; }, getDraft: () => draft });
  assert.equal(networkResult.code, 'network');

  const emptyStore = createStore();
  const empty = createController(emptyStore, {
    fetch: async () => jsonResponse({ ok: true, value: { text: '   ' } }),
  });
  const emptyResult = await empty.optimize({ text: draft, setDraft: (v) => { draft = v; }, getDraft: () => draft });
  assert.equal(emptyResult.code, 'empty-output');
});

test('the gating helpers cover every disabled reason', () => {
  const base = { phase: 'plain', text: 'hello', occurrenceCount: 0, status: 'idle' };
  assert.equal(canOptimize(base).enabled, true);
  assert.equal(canOptimize(base).reason, 'ready');
  assert.equal(canOptimize({ ...base, status: 'loading' }).reason, 'loading');
  assert.equal(canOptimize({ ...base, phase: 'sending' }).reason, 'locked');
  assert.equal(canOptimize({ ...base, text: '  ' }).reason, 'empty');
  assert.equal(canOptimize({ ...base, occurrenceCount: 1 }).reason, 'references');

  const idle = canUndo({ status: 'idle', after: '' }, 'hello');
  assert.equal(idle.visible, false);
  assert.equal(idle.enabled, false);
  assert.equal(idle.reason, 'idle');
  const ready = canUndo({ status: 'done', after: 'x' }, 'x');
  assert.equal(ready.visible, true);
  assert.equal(ready.enabled, true);
  assert.equal(ready.reason, 'ready');
  const changed = canUndo({ status: 'done', after: 'x' }, 'y');
  assert.equal(changed.visible, true);
  assert.equal(changed.enabled, false);
  assert.equal(changed.reason, 'changed');
});

test('an empty draft makes no request', async () => {
  const store = createStore();
  let called = 0;
  const controller = createController(store, {
    fetch: async () => { called += 1; return jsonResponse({ ok: true, value: { text: 'x' } }); },
  });
  const result = await controller.optimize({ text: '   ', setDraft: () => {}, getDraft: () => '' });
  assert.equal(result.code, 'empty-input');
  assert.equal(called, 0);
});
