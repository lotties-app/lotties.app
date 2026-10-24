// Tests for scripts/board-import.mjs: `node --test scripts/board-import.test.mjs` (no dependencies).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { baseUrl, chunk, importSeed, itemsOf, validateItem, validateSeed } from './board-import.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const seed = JSON.parse(readFileSync(resolve(root, 'docs/board-seed.json'), 'utf8'));

const valid = () => ({
  type: 'task',
  topic: 'process-meta',
  title: 'A task',
  side: 'owner',
  externalKey: 'test:1',
});
const errorsOf = (patch, options) => validateItem({ ...valid(), ...patch }, 0, options);

test('the committed seed is valid, in the bulk body shape, with unique keys', () => {
  assert.ok(Array.isArray(seed.items), 'the file is {"items": [...]}');
  const { items, errors } = validateSeed(seed);
  assert.deepEqual(errors, []);
  assert.ok(items.length > 0);
  for (const item of items) assert.ok(item.source, `${item.externalKey} has a source`);
});

test('the seed has no secret-looking text', () => {
  const text = JSON.stringify(seed);
  assert.doesNotMatch(text, /lbk_[A-Za-z0-9_-]{43}/);
  assert.doesNotMatch(text, /PRIVATE KEY/);
  assert.doesNotMatch(text, /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/, 'no IP addresses');
  assert.doesNotMatch(text, /password\s*[:=]|secret\s*[:=]|token\s*[:=]|key=/i);
});

test('a minimal item is valid', () => {
  assert.deepEqual(errorsOf({}), []);
});

test('required fields and the externalKey', () => {
  assert.match(errorsOf({ title: undefined }).join(), /title: required/);
  assert.match(errorsOf({ title: '   ' }).join(), /title: must not be empty/);
  assert.match(errorsOf({ type: undefined }).join(), /type: required/);
  assert.match(errorsOf({ topic: undefined }).join(), /topic: required/);
  assert.match(errorsOf({ externalKey: undefined }).join(), /externalKey: required/);
  assert.deepEqual(errorsOf({ externalKey: undefined }, { requireExternalKey: false }), []);
});

test('enums and topic keys', () => {
  assert.match(errorsOf({ type: 'bug' }).join(), /type: "bug" is not one of/);
  assert.match(errorsOf({ status: 'closed' }).join(), /status/);
  assert.match(errorsOf({ side: 'claude' }).join(), /side/);
  assert.match(errorsOf({ priority: 'p1' }).join(), /priority/);
  assert.match(errorsOf({ topic: 'billing' }).join(), /not a seeded topic/);
  assert.match(errorsOf({ topic: 'Privacy' }).join(), /not a topic key/);
});

test('lengths', () => {
  assert.deepEqual(errorsOf({ title: 'x'.repeat(200) }), []);
  assert.match(errorsOf({ title: 'x'.repeat(201) }).join(), /title: longer than 200/);
  assert.match(errorsOf({ body: 'x'.repeat(20001) }).join(), /body: longer than 20000/);
  assert.match(errorsOf({ source: 'x'.repeat(201) }).join(), /source: longer than 200/);
  assert.match(errorsOf({ externalKey: 'x'.repeat(121) }).join(), /externalKey: longer than 120/);
  assert.match(errorsOf({ title: 'a\0b' }).join(), /NUL/);
});

test('unknown properties are refused', () => {
  assert.match(errorsOf({ topicKey: 'product' }).join(), /topicKey: unknown property/);
});

test('labels', () => {
  assert.deepEqual(errorsOf({ labels: ['privacy', 'lgpd', 'a.b:c/d-e_f'] }), []);
  assert.match(errorsOf({ labels: ['Privacy'] }).join(), /labels/);
  assert.match(errorsOf({ labels: ['-x'] }).join(), /labels/);
  assert.match(errorsOf({ labels: ['x'.repeat(41)] }).join(), /labels/);
  assert.match(errorsOf({ labels: Array.from({ length: 11 }, (_, i) => `l${i}`) }).join(), /more than 10/);
  assert.match(errorsOf({ labels: ['a', 'a'] }).join(), /given twice/);
});

test('links: absolute http/https only, at most 10', () => {
  const link = (url) => ({ links: [{ label: 'doc', url }] });
  assert.deepEqual(errorsOf(link('https://github.com/x/y/blob/main/docs/A.md')), []);
  assert.match(errorsOf(link('docs/A.md')).join(), /not an absolute URL/);
  assert.match(errorsOf(link('javascript:alert(1)')).join(), /only http and https/);
  assert.match(errorsOf(link('ftp://example.org/a')).join(), /only http and https/);
  assert.match(errorsOf(link('https://user:pw@example.org/')).join(), /credentials/);
  assert.match(errorsOf({ links: [{ label: '', url: 'https://example.org' }] }).join(), /label/);
  assert.match(errorsOf({ links: [{ label: 'a', url: 'https://example.org', title: 'x' }] }).join(), /unknown property/);
  const many = Array.from({ length: 11 }, (_, i) => ({ label: `l${i}`, url: 'https://example.org' }));
  assert.match(errorsOf({ links: many }).join(), /more than 10/);
});

test('pinned only for notes and memories; decision fields only for decisions', () => {
  assert.match(errorsOf({ pinned: true }).join(), /pinned: only notes and memories/);
  assert.deepEqual(errorsOf({ type: 'memory', pinned: true }), []);
  assert.match(errorsOf({ decisionSummary: 'x' }).join(), /decisionSummary: only decisions/);
  assert.match(errorsOf({ decidedAt: '2026-10-24T12:00:00Z' }).join(), /decidedAt: only decisions/);
  assert.deepEqual(
    errorsOf({ type: 'decision', decisionSummary: 'x', rationale: 'y', decidedAt: '2026-10-24T12:00:00Z' }),
    [],
  );
  assert.match(errorsOf({ type: 'decision', decidedAt: '2026-10-24' }).join(), /decidedAt: must be an ISO 8601 instant/);
});

test('dueDate must be a real date', () => {
  assert.deepEqual(errorsOf({ dueDate: '2026-11-10' }), []);
  assert.match(errorsOf({ dueDate: '2026-02-30' }).join(), /dueDate/);
  assert.match(errorsOf({ dueDate: '10/11/2026' }).join(), /dueDate/);
});

test('secret-looking values are refused', () => {
  const fakeKey = `lbk_${'A'.repeat(43)}`;
  assert.match(errorsOf({ body: `use ${fakeKey}` }).join(), /body: looks like a secret/);
  assert.match(errorsOf({ body: '-----BEGIN PRIVATE KEY-----' }).join(), /looks like a secret/);
  assert.deepEqual(errorsOf({ body: 'set LOTTIES_BOARD_KEY and AUTH_ADMIN_CLIENT_SECRET in the env' }), []);
});

test('duplicate externalKey and id across items', () => {
  const id = '6f1c7a52-3b1e-4c55-9a0e-0a3a7f3b1c11';
  const { errors } = validateSeed({ items: [{ ...valid(), id }, { ...valid(), id }] });
  assert.ok(errors.some((e) => /externalKey: "test:1" already used by items\[0\]/.test(e)));
  assert.ok(errors.some((e) => /items\[1\]\.id: already used/.test(e)));
});

test('seed shapes', () => {
  assert.equal(itemsOf([valid()]).length, 1);
  assert.equal(itemsOf({ items: [valid()] }).length, 1);
  assert.throws(() => itemsOf({ items: [], extra: 1 }), /unknown top-level/);
  assert.match(validateSeed({ nope: [] }).errors.join(), /must be/);
  assert.match(validateSeed({ items: [] }).errors.join(), /no items/);
});

test('chunks hold at most 100 items and stay under the byte cap', () => {
  const items = Array.from({ length: 250 }, (_, i) => ({ ...valid(), externalKey: `k:${i}` }));
  assert.deepEqual(chunk(items).map((part) => part.length), [100, 100, 50]);
  const big = Array.from({ length: 5 }, (_, i) => ({ ...valid(), externalKey: `b:${i}`, body: 'x'.repeat(1000) }));
  assert.ok(chunk(big, 100, 2500).every((part) => part.length <= 2));
});

test('base URL: https by default, http only for localhost', () => {
  assert.equal(baseUrl({}), 'https://lotties.app');
  assert.equal(baseUrl({ LOTTIES_BOARD_URL: 'https://lotties.app/' }), 'https://lotties.app');
  assert.equal(baseUrl({ LOTTIES_BOARD_URL: 'http://localhost:5290' }), 'http://localhost:5290');
  assert.throws(() => baseUrl({ LOTTIES_BOARD_URL: 'http://example.org' }), /https/);
  assert.throws(() => baseUrl({ LOTTIES_BOARD_URL: 'https://u:p@example.org' }), /credentials/);
});

test('importSeed posts each chunk with the key header and sums the outcomes', async () => {
  const items = Array.from({ length: 130 }, (_, i) => ({ ...valid(), externalKey: `k:${i}` }));
  const calls = [];
  const fakeFetch = async (url, init) => {
    calls.push({ url, init });
    const body = JSON.parse(init.body);
    const results = body.items.map((item, index) => ({
      index,
      id: '00000000-0000-0000-0000-000000000000',
      externalKey: item.externalKey,
      outcome: index === 0 ? 'unchanged' : 'created',
    }));
    return new Response(JSON.stringify({ results }), { status: 200 });
  };
  const key = `lbk_${'B'.repeat(43)}`;
  const logs = [];
  const totals = await importSeed(items, { url: 'https://board.test', key, fetchImpl: fakeFetch, log: (l) => logs.push(l) });
  assert.deepEqual(totals, { created: 128, unchanged: 2 });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, 'https://board.test/api/v1/board/items/bulk');
  assert.equal(calls[0].init.headers['X-Board-Key'], key);
  assert.ok(logs.every((line) => !line.includes(key)), 'the key is never logged');
});

test('importSeed stops on an HTTP error and reports the problem code', async () => {
  const fakeFetch = async () =>
    new Response(JSON.stringify({ code: 'validation_failed', field: 'items[3].title' }), { status: 400 });
  await assert.rejects(
    importSeed([valid()], { url: 'https://board.test', key: 'token', fetchImpl: fakeFetch, log: () => {} }),
    /chunk 1\/1 failed .*HTTP 400 validation_failed \(field items\[3\]\.title\)/,
  );
});
