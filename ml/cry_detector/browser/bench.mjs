// Runtime bench of the cry detector spike in headless Chromium (docs/design/31-cry-detector-spike.md).
//
//   node ml/cry_detector/browser/bench.mjs --scratch <dir with node_modules> --cache <cry cache> \
//        --playwright <path to a playwright package> [--out bench.json] [--port 18431] [--skip-ast]
//
// The scratch directory (outside the repository) holds `npm install @mediapipe/tasks-audio@1.1.1
// @huggingface/transformers@4.3.1`, the AST preprocessor_config.json under hf/, and the parity signals under
// signals/ (python -I -m cry_detector.parity write). Nothing is installed in the repository. A static server on
// 127.0.0.1 serves this folder, the scratch node_modules, the cached models and the signals, with COOP/COEP headers
// so onnxruntime-web may use threads. No microphone is opened.

import { createServer } from 'node:http';
import { readFile, writeFile, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => {
    if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true]);
    return acc;
  }, []),
);
const here = path.dirname(fileURLToPath(import.meta.url));
const scratch = path.resolve(args.scratch);
const cache = path.resolve(args.cache);
const port = Number(args.port ?? 18431);
const out = path.resolve(args.out ?? path.join(scratch, 'bench.json'));
const AST_ID = 'Xenova/ast-finetuned-audioset-10-10-0.4593';

const routes = [
  ['/bench/', here],
  ['/nm/', path.join(scratch, 'node_modules')],
  ['/signals/', path.join(scratch, 'signals')],
  [`/hf/${AST_ID}/onnx/model_quantized.onnx`, path.join(cache, 'downloads', 'ast_model_quantized.onnx')],
  [`/hf/${AST_ID}/config.json`, path.join(cache, 'downloads', 'ast_config.json')],
  [`/hf/${AST_ID}/preprocessor_config.json`, path.join(scratch, 'hf', 'preprocessor_config.json')],
  ['/models/yamnet.tflite', path.join(cache, 'downloads', 'yamnet.tflite')],
];
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.json': 'application/json' };

const server = createServer(async (req, res) => {
  const url = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  for (const [prefix, target] of routes) {
    if (url === prefix || (prefix.endsWith('/') && url.startsWith(prefix))) {
      const file = prefix.endsWith('/') ? path.join(target, url.slice(prefix.length)) : target;
      const root = prefix.endsWith('/') ? target : path.dirname(target);
      if (!path.resolve(file).startsWith(path.resolve(root))) break;
      try {
        const body = await readFile(file);
        res.writeHead(200, {
          'Content-Type': types[path.extname(file)] ?? 'application/octet-stream',
          'Cross-Origin-Opener-Policy': 'same-origin',
          'Cross-Origin-Embedder-Policy': 'require-corp',
          'Cross-Origin-Resource-Policy': 'same-origin',
        });
        res.end(body);
        return;
      } catch {
        break;
      }
    }
  }
  res.writeHead(404);
  res.end();
});
await new Promise((r) => server.listen(port, '127.0.0.1', r));

const require = createRequire(path.join(path.resolve(args.playwright), 'package.json'));
const { chromium } = require(path.resolve(args.playwright));

function memoryOf(pids) {
  // Working set and private bytes of the given Chromium processes (Windows), in MB.
  const list = pids.join(',');
  const ps = `Get-Process -Id ${list} | ForEach-Object { "$($_.Id) $($_.WorkingSet64) $($_.PrivateMemorySize64)" }`;
  const text = execFileSync('powershell.exe', ['-NoProfile', '-Command', ps], { encoding: 'utf8' });
  return text
    .trim()
    .split(/\r?\n/)
    .map((l) => l.trim().split(' ').map(Number))
    .map(([pid, ws, priv]) => ({ pid, workingSetMB: +(ws / 2 ** 20).toFixed(1), privateMB: +(priv / 2 ** 20).toFixed(1) }));
}

async function processInfo(browser) {
  const cdp = await browser.newBrowserCDPSession();
  const { processInfo } = await cdp.send('SystemInfo.getProcessInfo');
  await cdp.detach();
  return processInfo;
}

const rendererCpu = async (browser) => (await processInfo(browser)).filter((p) => p.type === 'renderer').reduce((s, p) => s + p.cpuTime, 0);

async function fresh(browser) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`http://127.0.0.1:${port}/bench/bench.html`);
  await page.waitForFunction(() => window.benchReady === true);
  const cdp = await context.newCDPSession(page);
  return { context, page, cdp };
}

const sizes = {};
for (const [name, file] of [
  ['yamnet.tflite', path.join(cache, 'downloads', 'yamnet.tflite')],
  ['audio_wasm_internal.wasm', path.join(scratch, 'node_modules/@mediapipe/tasks-audio/wasm/audio_wasm_internal.wasm')],
  ['audio_wasm_internal.js', path.join(scratch, 'node_modules/@mediapipe/tasks-audio/wasm/audio_wasm_internal.js')],
  ['audio_bundle.mjs', path.join(scratch, 'node_modules/@mediapipe/tasks-audio/audio_bundle.mjs')],
  ['ast_model_quantized.onnx', path.join(cache, 'downloads', 'ast_model_quantized.onnx')],
  ['ort-wasm-simd-threaded.wasm', path.join(scratch, 'node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm')],
  ['ort-wasm-simd-threaded.jsep.wasm', path.join(scratch, 'node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.jsep.wasm')],
  ['transformers.web.min.js', path.join(scratch, 'node_modules/@huggingface/transformers/dist/transformers.web.min.js')],
]) {
  try {
    sizes[name] = (await stat(file)).size;
  } catch {
    sizes[name] = null;
  }
}

const browser = await chromium.launch({ headless: true });
const result = { browser: browser.version(), node: process.version, cpus: (await import('node:os')).cpus()[0].model, sizes };

// YAMNet / MediaPipe Tasks Audio
{
  const { context, page, cdp } = await fresh(browser);
  const before = (await processInfo(browser)).filter((p) => p.type === 'renderer').map((p) => p.id);
  const memBefore = memoryOf(before);
  const cold = await page.evaluate(() => window.yamnetLoad());
  const infer16k = await page.evaluate(() => window.yamnetInfer({ reps: 300, sampleRate: 16000 }));
  const infer48k = await page.evaluate(() => window.yamnetInfer({ reps: 300, sampleRate: 48000 }));
  const throttled = {};
  for (const rate of [4, 6]) {
    await cdp.send('Emulation.setCPUThrottlingRate', { rate });
    throttled[`x${rate}`] = await page.evaluate(() => window.yamnetInfer({ reps: 60, sampleRate: 48000 }));
  }
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  const cpu0 = await rendererCpu(browser);
  const t0 = Date.now();
  const realtime = await page.evaluate(() => window.yamnetRealtime({ seconds: 30, sampleRate: 48000 }));
  const cpu1 = await rendererCpu(browser);
  const wall = (Date.now() - t0) / 1000;
  const memAfter = memoryOf(before);
  const heap = await page.evaluate(() => window.heap());
  const parity = await page.evaluate(() => window.yamnetParity());
  await context.close();
  const { page: page2, context: context2 } = await fresh(browser);
  const warm = await page2.evaluate(() => window.yamnetLoad());
  await context2.close();
  result.yamnet = {
    loadCold: cold,
    loadSecondContext: warm,
    infer16k,
    infer48k,
    throttled,
    realtime,
    rendererCpuShareOfOneCore: (cpu1 - cpu0) / wall,
    memoryBefore: memBefore,
    memoryAfter: memAfter,
    jsHeapBytes: heap,
    parity,
  };
  console.log('yamnet done', JSON.stringify({ cold, infer16k, infer48k, realtime: realtime.dutyCycle }));
}

// AST / Transformers.js (onnxruntime-web WASM)
if (!args['skip-ast']) {
  result.ast = {};
  for (const threads of [1, 4]) {
    const { context, page } = await fresh(browser);
    const pids = (await processInfo(browser)).filter((p) => p.type === 'renderer').map((p) => p.id);
    const memBefore = memoryOf(pids);
    const load = await page.evaluate((t) => window.astLoad({ threads: t }), threads);
    const infer = await page.evaluate(() => window.astInfer({ reps: 5 }));
    const memAfter = memoryOf(pids);
    const parity = threads === 1 ? await page.evaluate(() => window.astParity()) : undefined;
    result.ast[`threads${threads}`] = { load, infer, memoryBefore: memBefore, memoryAfter: memAfter };
    if (parity) result.ast.parity = parity;
    await context.close();
    console.log('ast done', threads, JSON.stringify({ load, infer }));
  }
}

await browser.close();
server.close();
await writeFile(out, JSON.stringify(result, null, 1));
console.log('wrote', out);
