#!/usr/bin/env node
// Downloads the cry monitor model (YAMNet float32, MediaPipe's yamnet.tflite, Apache-2.0) into
// code/web/public/models/cry/yamnet.tflite and verifies its pinned SHA-256 (docs/design/35-cry-engine.md section 4).
// The file is never committed (gitignored). Without it the app still builds and runs; only monitor mode fails with
// `model_missing`. The web Dockerfile runs this script before `npm run build` and a failure stops the image build.
//
//   node scripts/fetch-cry-model.mjs           # download if missing or different; exit 1 on any failure
//   node scripts/fetch-cry-model.mjs --check   # verify only (exit 1 when missing or not the pinned file)
//
// The URL and checksum are the ones the spike pinned and evaluated (ml/cry_detector/cry_detector/sources.py,
// docs/design/31-cry-detector-spike.md section 1); src/cry/modelAssets.ts carries the same values (a test checks).

import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/audio_classifier/yamnet/float32/1/yamnet.tflite';
const MODEL_SHA256 = '4d8b4a53282dc83ef04e3e7dbc4fbc98082e34e44ed798e16c3a0cdd4c584faf';
const MODEL_BYTES = 4126810;

const here = path.dirname(fileURLToPath(import.meta.url));
const target = path.resolve(here, '..', 'public', 'models', 'cry', 'yamnet.tflite');
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

async function current() {
  try {
    const bytes = await readFile(target);
    return sha256(bytes) === MODEL_SHA256 ? 'ok' : 'different';
  } catch {
    return 'missing';
  }
}

function fail(message) {
  console.error(`fetch-cry-model: ${message}`);
  console.error('The cry monitor needs this file; see docs/design/35-cry-engine.md section 4.');
  process.exit(1);
}

const state = await current();
if (state === 'ok') {
  console.log(`fetch-cry-model: ${path.relative(process.cwd(), target)} is the pinned model`);
  process.exit(0);
}
if (process.argv.includes('--check')) fail(`${target} is ${state}`);

let bytes;
try {
  const response = await fetch(MODEL_URL, { redirect: 'follow' });
  if (!response.ok) fail(`download failed: HTTP ${response.status} from ${MODEL_URL}`);
  bytes = Buffer.from(await response.arrayBuffer());
} catch (error) {
  fail(
    `download failed (${error instanceof Error ? error.message : String(error)}) from ${MODEL_URL}`,
  );
}
const digest = sha256(bytes);
if (bytes.length !== MODEL_BYTES || digest !== MODEL_SHA256) {
  fail(
    `checksum mismatch: got ${bytes.length} bytes, sha256 ${digest}; expected ${MODEL_BYTES} bytes, ${MODEL_SHA256}`,
  );
}
await mkdir(path.dirname(target), { recursive: true });
const partial = `${target}.partial`;
try {
  await writeFile(partial, bytes);
  await rename(partial, target);
} catch (error) {
  await rm(partial, { force: true });
  fail(`could not write ${target}: ${error instanceof Error ? error.message : String(error)}`);
}
console.log(
  `fetch-cry-model: wrote ${path.relative(process.cwd(), target)} (${bytes.length} bytes, sha256 verified)`,
);
