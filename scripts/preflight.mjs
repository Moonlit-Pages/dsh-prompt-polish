/**
 * Pre-install / pre-pack self-check.
 *
 * This does not replace the behavioural tests in `test/`; it answers one
 * question: will DSH load this package without breaking? Manifest wiring,
 * bundle patch, client self-registration, import boundaries, display locale
 * files, icon bytes, and theme-token usage.
 *
 * Run: node scripts/preflight.mjs
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const manifest = JSON.parse(read('package.json'));
const problems = [];

async function check(name, fn) {
  try {
    await fn();
    console.log(`  ok  ${name}`);
  } catch (error) {
    problems.push(`${name}: ${error?.message}`);
    console.error(`FAIL  ${name}\n      ${error?.message}`);
  }
}

await check('manifest essentials', () => {
  assert.match(manifest.name, /^[a-z0-9-]+$/, 'name must be a valid npm package name');
  assert.equal(manifest.type, 'module');
  assert.equal(manifest.exports['.'], './lib/index.js');
  assert.equal(manifest.exports['./client'], './lib/client.js');
  assert.equal(manifest.exports['./icon'], './icon.svg');
  assert.equal(manifest.dsh?.manifestVersion, 1);
  assert.equal(manifest.dsh?.bundle?.patch, './cordis.patch.yml');
  assert.equal(manifest.dsh?.client?.platform, 'web');
  assert.equal(manifest.dsh?.client?.immediately, true);
  assert.ok(Array.isArray(manifest.dsh?.client?.inject));
});

await check('every files entry exists', () => {
  for (const entry of manifest.files) {
    assert.ok(fs.existsSync(path.join(root, entry)), `missing: ${entry}`);
  }
});

await check('client bundle registers exactly once with the package name', () => {
  const source = read('lib/client.js');
  const ids = [...source.matchAll(/__ModuleLoader__\s*\.\s*load\(\s*\{[\s\S]{0,120}?id:\s*['"]([^'"]+)['"]/g)]
    .map((match) => match[1]);
  assert.deepEqual(ids, [manifest.name], 'bundle id must equal the package name');
  assert.ok(!/^\s*import\s/m.test(source), 'the browser bundle must not use ESM imports');
});

await check('client half requires only react', () => {
  const requires = [...read('lib/client.js').matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)]
    .map((match) => match[1]);
  assert.deepEqual([...new Set(requires)], ['react']);
});

await check('Host half imports only local modules and node: builtins', () => {
  for (const file of fs.readdirSync(path.join(root, 'lib'))) {
    if (!file.endsWith('.js') || file === 'client.js') continue;
    const source = read(path.join('lib', file));
    const specifiers = [...source.matchAll(/^\s*(?:import|export)[^\n]*?from\s+['"]([^'"]+)['"]/gm)]
      .map((match) => match[1]);
    const external = specifiers.filter((specifier) => !specifier.startsWith('.') && !specifier.startsWith('node:'));
    assert.deepEqual(external, [], `${file} imports external packages: ${external.join(', ')}`);
  }
});

await check('bundle patch inserts one row named after the package', () => {
  const source = read(manifest.dsh.bundle.patch);
  const rows = [...source.matchAll(/id:\s*(['"]?)([A-Za-z0-9_-]+)\1\s*\n\s*name:\s*(['"])([^'"]+)\3/g)];
  assert.equal(rows.length, 1, `expected exactly one insert row, found ${rows.length}`);
  assert.equal(rows[0][2], 'prompt-polish');
  assert.equal(rows[0][4], manifest.name);
  assert.match(source, /^\s*-\s*insert:/m);
});

await check('display locale files carry title, description, and an existing detail document', () => {
  const locales = ['locale/en.json', 'locale/zh.json'];
  const shapes = [];
  for (const file of locales) {
    const dict = JSON.parse(read(file));
    assert.equal(typeof dict.meta?.title, 'string');
    assert.ok(dict.meta.title.length > 0, `${file}: meta.title is empty`);
    assert.equal(typeof dict.meta?.description, 'string');
    assert.ok(dict.meta.description.length > 10, `${file}: meta.description is too short`);
    assert.equal(typeof dict.meta?.detail, 'string');
    assert.ok(fs.existsSync(path.join(root, dict.meta.detail)), `${file}: missing ${dict.meta.detail}`);
    shapes.push(Object.keys(dict.meta).sort().join(','));
  }
  assert.equal(new Set(shapes).size, 1, 'locale meta key sets must match');
});

await check('icon is a bounded SVG document', () => {
  const iconPath = path.join(root, manifest.icon);
  assert.ok(fs.existsSync(iconPath), `missing icon: ${manifest.icon}`);
  const bytes = fs.statSync(iconPath).size;
  assert.ok(bytes > 0 && bytes <= 256 * 1024, `icon is ${bytes} bytes`);
  const text = fs.readFileSync(iconPath, 'utf8');
  assert.match(text, /^\s*<svg[\s>]/, 'icon must start with an <svg> element');
  assert.match(text, /<\/svg>\s*$/, 'icon must close its <svg> element');
  assert.match(text, /viewBox=/, 'icon needs a viewBox');
});

await check('VERSION matches package.json', () => {
  const source = read('lib/index.js');
  const match = source.match(/export const VERSION = '([^']+)'/);
  assert.ok(match, 'lib/index.js must export VERSION');
  assert.equal(match[1], manifest.version);
});

await check('styles use only theme tokens known to the shell', () => {
  const whitelist = new Set(JSON.parse(read('test/theme-tokens.json')).tokens);
  const used = new Set([...read('lib/client.js').matchAll(/var\((--dsw-[A-Za-z0-9-]+)/g)].map((match) => match[1]));
  const missing = [...used].filter((token) => !whitelist.has(token));
  assert.deepEqual(missing, [], `unknown theme tokens: ${missing.join(', ')}`);
});

await check('every Host module and the entry load', async () => {
  const libUrl = (file) => pathToFileURL(path.join(root, 'lib', file)).href;
  for (const file of ['config.js', 'optimizer.js', 'routes.js', 'tool.js', 'index.js']) {
    await import(libUrl(file));
  }
  const entry = await import(libUrl('index.js'));
  assert.equal(typeof entry.apply, 'function');
});

if (problems.length > 0) {
  console.error(`\n${problems.length} preflight check(s) failed.`);
  process.exit(1);
}
console.log('\nAll preflight checks passed.');
