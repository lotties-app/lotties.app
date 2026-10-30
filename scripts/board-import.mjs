#!/usr/bin/env node
// Imports the project board seed (docs/board-seed.json) through POST /api/v1/board/items/bulk.
// Contract: docs/design/36-project-board.md sections 2, 3.1 and 3.4; owner steps: docs/KEYCLOAK-BOARD.md "Seeding the board".
//
//   node scripts/board-import.mjs --dry-run            validate the file locally, send nothing
//   node scripts/board-import.mjs                      validate, then post the chunks (100 items each)
//   node scripts/board-import.mjs --file other.json    another seed file
//
// Environment only (never arguments, never printed):
//   LOTTIES_BOARD_URL  base URL, default https://lotties.app
//   LOTTIES_BOARD_KEY  a board write key (lbk_...), sent as X-Board-Key; any other value is sent as a bearer token
//
// No dependencies (Node 18+: global fetch). Exits non-zero on any error.

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const TOPICS = Object.freeze([
  'product',
  'doctor-access',
  'assistants-alexa-mcp',
  'privacy-legal',
  'mobile-stores',
  'infrastructure-deploy',
  'data-catalog',
  'predictions-ml',
  'design-ux',
  'process-meta',
]);
export const TYPES = Object.freeze(['task', 'gap', 'decision', 'question', 'risk', 'note', 'memory']);
export const STATUSES = Object.freeze(['open', 'in_progress', 'blocked', 'waiting', 'done', 'dropped']);
export const SIDES = Object.freeze(['owner', 'assistant', 'both', 'external']);
export const PRIORITIES = Object.freeze(['low', 'normal', 'high', 'urgent']);
export const FIELDS = Object.freeze([
  'id', 'type', 'topic', 'title', 'body', 'status', 'side', 'priority', 'labels', 'dueDate', 'links', 'pinned',
  'decisionSummary', 'rationale', 'decidedAt', 'source', 'externalKey',
]);
export const LIMITS = Object.freeze({
  title: 200, body: 20000, decisionSummary: 1000, rationale: 4000, source: 200, externalKey: 120,
  labels: 10, label: 40, links: 10, linkLabel: 100, url: 2000, chunk: 100, chunkBytes: 4 * 1024 * 1024,
});

const LABEL = /^[a-z0-9][a-z0-9._:/-]*$/;
const TOPIC_KEY = /^[a-z][a-z0-9-]{1,39}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,7})?)?(Z|[+-]\d{2}:\d{2})$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Things that must never be in a seed: a board key, a private key block, a bearer token, a JWT.
const SECRET_PATTERNS = [
  /lbk_[A-Za-z0-9_-]{43}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\bBearer\s+(?!lbk_\.\.\.|<|\$\{|\$[A-Z_])[A-Za-z0-9._-]{20,}/,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/,
];

/** The items of a seed: `{items: [...]}` (the bulk body) or a bare array. */
export function itemsOf(seed) {
  if (Array.isArray(seed)) return seed;
  if (seed && typeof seed === 'object' && Array.isArray(seed.items)) {
    const extra = Object.keys(seed).filter((key) => key !== 'items');
    if (extra.length > 0) throw new Error(`unknown top-level properties: ${extra.join(', ')}`);
    return seed.items;
  }
  throw new Error('the seed must be {"items": [...]} or an array of items');
}

const isText = (value) => typeof value === 'string';

function checkText(errors, field, value, max, required) {
  if (value === undefined || value === null) {
    if (required) errors.push(`${field}: required`);
    return;
  }
  if (!isText(value)) return errors.push(`${field}: must be a string`);
  const trimmed = value.trim();
  if (trimmed.length === 0) return errors.push(`${field}: must not be empty`);
  if (trimmed.length > max) errors.push(`${field}: longer than ${max} characters (${trimmed.length})`);
  if (value.includes('\0')) errors.push(`${field}: contains NUL`);
}

function checkEnum(errors, field, value, allowed, required) {
  if (value === undefined || value === null) {
    if (required) errors.push(`${field}: required`);
    return;
  }
  if (!allowed.includes(value)) errors.push(`${field}: "${value}" is not one of ${allowed.join(', ')}`);
}

function isRealDate(text) {
  if (!DATE.test(text)) return false;
  const parsed = new Date(`${text}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === text;
}

/** Validates one item against the bulk contract; returns error strings prefixed with `items[i].`. */
export function validateItem(item, index, { topics = TOPICS, requireExternalKey = true } = {}) {
  const errors = [];
  if (!item || typeof item !== 'object' || Array.isArray(item)) return [`items[${index}]: must be an object`];

  for (const key of Object.keys(item)) {
    if (!FIELDS.includes(key)) errors.push(`${key}: unknown property`);
  }
  if (item.id !== undefined && (!isText(item.id) || !UUID.test(item.id))) errors.push('id: must be a UUID');
  checkEnum(errors, 'type', item.type, TYPES, true);
  if (item.topic === undefined || item.topic === null) errors.push('topic: required');
  else if (!isText(item.topic) || !TOPIC_KEY.test(item.topic)) errors.push('topic: not a topic key');
  else if (!topics.includes(item.topic)) errors.push(`topic: "${item.topic}" is not a seeded topic`);
  checkText(errors, 'title', item.title, LIMITS.title, true);
  checkText(errors, 'body', item.body, LIMITS.body, false);
  checkEnum(errors, 'status', item.status, STATUSES, false);
  checkEnum(errors, 'side', item.side, SIDES, false);
  checkEnum(errors, 'priority', item.priority, PRIORITIES, false);

  if (item.labels !== undefined && item.labels !== null) {
    if (!Array.isArray(item.labels)) errors.push('labels: must be an array');
    else {
      if (item.labels.length > LIMITS.labels) errors.push(`labels: more than ${LIMITS.labels}`);
      const seen = new Set();
      for (const label of item.labels) {
        if (!isText(label) || label.length === 0 || label.length > LIMITS.label || !LABEL.test(label)) {
          errors.push(`labels: "${label}" must be 1-${LIMITS.label} characters of a-z 0-9 . _ : / - (lower case)`);
        } else if (seen.has(label)) errors.push(`labels: "${label}" given twice`);
        seen.add(label);
      }
    }
  }

  if (item.dueDate !== undefined && item.dueDate !== null && !(isText(item.dueDate) && isRealDate(item.dueDate))) {
    errors.push('dueDate: must be a yyyy-MM-dd date');
  }

  if (item.links !== undefined && item.links !== null) {
    if (!Array.isArray(item.links)) errors.push('links: must be an array');
    else {
      if (item.links.length > LIMITS.links) errors.push(`links: more than ${LIMITS.links}`);
      item.links.forEach((link, i) => {
        if (!link || typeof link !== 'object') return errors.push(`links[${i}]: must be {label, url}`);
        const extra = Object.keys(link).filter((key) => key !== 'label' && key !== 'url');
        if (extra.length > 0) errors.push(`links[${i}]: unknown property ${extra.join(', ')}`);
        checkText(errors, `links[${i}].label`, link.label, LIMITS.linkLabel, true);
        if (!isText(link.url) || link.url.length > LIMITS.url) {
          return errors.push(`links[${i}].url: required, at most ${LIMITS.url} characters`);
        }
        let parsed;
        try {
          parsed = new URL(link.url);
        } catch {
          return errors.push(`links[${i}].url: not an absolute URL`);
        }
        if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
          errors.push(`links[${i}].url: only http and https are allowed`);
        }
        if (parsed.username || parsed.password) errors.push(`links[${i}].url: must not carry credentials`);
      });
    }
  }

  if (item.pinned !== undefined && item.pinned !== null) {
    if (typeof item.pinned !== 'boolean') errors.push('pinned: must be a boolean');
    else if (item.pinned && item.type !== 'note' && item.type !== 'memory') errors.push('pinned: only notes and memories');
  }

  checkText(errors, 'decisionSummary', item.decisionSummary, LIMITS.decisionSummary, false);
  checkText(errors, 'rationale', item.rationale, LIMITS.rationale, false);
  if (item.decidedAt !== undefined && item.decidedAt !== null) {
    if (!isText(item.decidedAt) || !INSTANT.test(item.decidedAt) || Number.isNaN(Date.parse(item.decidedAt))) {
      errors.push('decidedAt: must be an ISO 8601 instant with an offset (e.g. 2026-10-24T12:00:00Z)');
    }
  }
  if (item.type !== 'decision') {
    for (const field of ['decisionSummary', 'rationale', 'decidedAt']) {
      if (item[field] !== undefined && item[field] !== null) errors.push(`${field}: only decisions have it`);
    }
  }

  checkText(errors, 'source', item.source, LIMITS.source, false);
  checkText(errors, 'externalKey', item.externalKey, LIMITS.externalKey, requireExternalKey);

  for (const [field, value] of Object.entries(item)) {
    const text = JSON.stringify(value);
    if (SECRET_PATTERNS.some((pattern) => pattern.test(text))) errors.push(`${field}: looks like a secret`);
  }

  return errors.map((error) => `items[${index}].${error}`);
}

/** Validates a whole seed: every item, unique externalKey and id. Returns {items, errors}. */
export function validateSeed(seed, options = {}) {
  let items;
  try {
    items = itemsOf(seed);
  } catch (error) {
    return { items: [], errors: [error.message] };
  }
  const errors = [];
  if (items.length === 0) errors.push('the seed has no items');
  const keys = new Map();
  const ids = new Map();
  items.forEach((item, index) => {
    errors.push(...validateItem(item, index, options));
    if (item && isText(item.externalKey)) {
      const key = item.externalKey.trim();
      if (keys.has(key)) errors.push(`items[${index}].externalKey: "${key}" already used by items[${keys.get(key)}]`);
      else keys.set(key, index);
    }
    if (item && isText(item.id)) {
      const id = item.id.toLowerCase();
      if (ids.has(id)) errors.push(`items[${index}].id: already used by items[${ids.get(id)}]`);
      else ids.set(id, index);
    }
  });
  return { items, errors };
}

/** Splits items into bulk bodies of at most `size` items and `maxBytes` bytes each. */
export function chunk(items, size = LIMITS.chunk, maxBytes = LIMITS.chunkBytes) {
  const chunks = [];
  let current = [];
  const bytes = (list) => Buffer.byteLength(JSON.stringify({ items: list }), 'utf8');
  for (const item of items) {
    if (current.length > 0 && (current.length >= size || bytes([...current, item]) > maxBytes)) {
      chunks.push(current);
      current = [];
    }
    current.push(item);
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

/** Counts per field value, e.g. countBy(items, 'type'). */
export function countBy(items, field) {
  const counts = {};
  for (const item of items) {
    const value = item[field] ?? '(default)';
    counts[value] = (counts[value] ?? 0) + 1;
  }
  return counts;
}

/** The base URL from the environment: https, or http only for a local host. */
export function baseUrl(env) {
  const raw = (env.LOTTIES_BOARD_URL ?? '').trim() || 'https://lotties.app';
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error('LOTTIES_BOARD_URL is not an absolute URL');
  }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname);
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && local)) {
    throw new Error('LOTTIES_BOARD_URL must be https (http only for localhost)');
  }
  if (parsed.username || parsed.password) throw new Error('LOTTIES_BOARD_URL must not carry credentials');
  return parsed.origin + parsed.pathname.replace(/\/+$/, '');
}

function authHeaders(key) {
  return key.startsWith('lbk_') ? { 'X-Board-Key': key } : { Authorization: `Bearer ${key}` };
}

async function post(url, key, items, fetchImpl) {
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...authHeaders(key) },
    body: JSON.stringify({ items }),
  });
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!response.ok) {
    const code = json?.code ? ` ${json.code}` : '';
    const field = json?.field ? ` (field ${json.field})` : '';
    const detail = json?.detail ? `: ${json.detail}` : '';
    throw new Error(`HTTP ${response.status}${code}${field}${detail}`);
  }
  if (!json || !Array.isArray(json.results)) throw new Error('unexpected answer: no results array');
  return json.results;
}

/** Posts every chunk; returns the outcome counts. Stops at the first failed chunk. */
export async function importSeed(items, { url, key, fetchImpl = fetch, log = console.log } = {}) {
  const totals = {};
  const chunks = chunk(items);
  for (const [i, part] of chunks.entries()) {
    let results;
    try {
      results = await post(`${url}/api/v1/board/items/bulk`, key, part, fetchImpl);
    } catch (error) {
      throw new Error(`chunk ${i + 1}/${chunks.length} failed (nothing of this chunk was saved): ${error.message}`);
    }
    const counts = countBy(results, 'outcome');
    for (const [outcome, n] of Object.entries(counts)) totals[outcome] = (totals[outcome] ?? 0) + n;
    log(`chunk ${i + 1}/${chunks.length}: ${part.length} items, ${format(counts)}`);
  }
  return totals;
}

const format = (counts) =>
  Object.entries(counts)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, n]) => `${name} ${n}`)
    .join(', ');

function parseArgs(argv) {
  const options = { dryRun: false, file: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--file') options.file = argv[++i];
    else if (arg.startsWith('--file=')) options.file = arg.slice('--file='.length);
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`unknown argument "${arg}" (the key is read from LOTTIES_BOARD_KEY only)`);
  }
  if (options.file === undefined || options.file === '') throw new Error('--file needs a path');
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log('usage: node scripts/board-import.mjs [--dry-run] [--file docs/board-seed.json]');
    console.log('env: LOTTIES_BOARD_URL (default https://lotties.app), LOTTIES_BOARD_KEY (required unless --dry-run)');
    return 0;
  }
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const file = options.file ? resolve(options.file) : resolve(root, 'docs/board-seed.json');
  const seed = JSON.parse(readFileSync(file, 'utf8'));
  const { items, errors } = validateSeed(seed);
  if (errors.length > 0) {
    console.error(`${errors.length} validation error(s) in ${file}:`);
    for (const error of errors) console.error(`  ${error}`);
    return 1;
  }
  const chunks = chunk(items);
  console.log(`${items.length} items valid, ${chunks.length} chunk(s)`);
  console.log(`  by type: ${format(countBy(items, 'type'))}`);
  console.log(`  by topic: ${format(countBy(items, 'topic'))}`);
  console.log(`  by side: ${format(countBy(items, 'side'))}`);
  console.log(`  by status: ${format(countBy(items, 'status'))}`);
  if (options.dryRun) {
    console.log('dry run: nothing sent');
    return 0;
  }
  const key = (process.env.LOTTIES_BOARD_KEY ?? '').trim();
  if (!key) {
    console.error('LOTTIES_BOARD_KEY is not set (a board write key); nothing sent');
    return 1;
  }
  const url = baseUrl(process.env);
  console.log(`posting to ${url}/api/v1/board/items/bulk`);
  const totals = await importSeed(items, { url, key });
  console.log(`done: ${format(totals)}`);
  console.log(
    `created ${totals.created ?? 0}, updated ${totals.updated ?? 0}, unchanged ${totals.unchanged ?? 0}` +
      `, kept (edited on the board) ${totals.kept ?? 0}, deleted on the board ${totals.deleted ?? 0}`,
  );
  return 0;
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main().then(
    (code) => process.exit(code),
    (error) => {
      console.error(`error: ${error.message}`);
      process.exit(1);
    },
  );
}
