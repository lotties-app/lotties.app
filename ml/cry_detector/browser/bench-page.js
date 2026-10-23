// In-page part of the runtime bench (loaded by bench.html, driven by bench.mjs through Playwright).
// No microphone: every input is a synthetic buffer or a parity signal served from the scratch directory.

const now = () => performance.now();

function noise(n, seed = 1) {
  // Deterministic white noise at about -26 dBFS (LCG), so runs are comparable.
  const x = new Float32Array(n);
  let s = seed >>> 0;
  for (let i = 0; i < n; i++) {
    s = (1664525 * s + 1013904223) >>> 0;
    x[i] = (s / 4294967296 - 0.5) * 0.17;
  }
  return x;
}

function stats(ms) {
  const a = [...ms].sort((p, q) => p - q);
  const q = (f) => a[Math.min(a.length - 1, Math.floor(f * a.length))];
  return { n: a.length, mean: a.reduce((s, v) => s + v, 0) / a.length, p50: q(0.5), p95: q(0.95), max: a[a.length - 1] };
}

async function signals() {
  const list = await (await fetch('/signals/expected.json')).json();
  const out = {};
  for (const name of list.signals) {
    const buf = await (await fetch(`/signals/${name}.f32`)).arrayBuffer();
    out[name] = new Float32Array(buf);
  }
  return out;
}

let classifier = null;

window.yamnetLoad = async () => {
  const t0 = now();
  const { FilesetResolver, AudioClassifier } = await import('/nm/@mediapipe/tasks-audio/audio_bundle.mjs');
  const t1 = now();
  const fileset = await FilesetResolver.forAudioTasks('/nm/@mediapipe/tasks-audio/wasm');
  const t2 = now();
  classifier = await AudioClassifier.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: '/models/yamnet.tflite' },
    maxResults: -1,
  });
  const t3 = now();
  return { importMs: t1 - t0, filesetMs: t2 - t1, createMs: t3 - t2, totalMs: t3 - t0 };
};

window.yamnetInfer = async ({ reps = 200, sampleRate = 16000, seconds = 0.975 } = {}) => {
  const x = noise(Math.round(sampleRate * seconds), 3);
  for (let i = 0; i < 5; i++) classifier.classify(x, sampleRate);
  const ms = [];
  for (let i = 0; i < reps; i++) {
    const t = now();
    classifier.classify(x, sampleRate);
    ms.push(now() - t);
  }
  return stats(ms);
};

// Real-time loop: one classify per 0.975 s of "audio" (as a microphone feed would deliver), for `seconds`.
window.yamnetRealtime = async ({ seconds = 30, sampleRate = 48000 } = {}) => {
  const x = noise(Math.round(sampleRate * 0.975), 5);
  const busy = [];
  const t0 = now();
  while (now() - t0 < seconds * 1000) {
    const t = now();
    classifier.classify(x, sampleRate);
    busy.push(now() - t);
    const next = t0 + busy.length * 975;
    await new Promise((r) => setTimeout(r, Math.max(0, next - now())));
  }
  const wall = now() - t0;
  return { wallMs: wall, busyMs: busy.reduce((s, v) => s + v, 0), dutyCycle: busy.reduce((s, v) => s + v, 0) / wall, ...stats(busy) };
};

window.yamnetParity = async () => {
  const sig = await signals();
  const out = {};
  for (const [name, x] of Object.entries(sig)) {
    const res = classifier.classify(x, 16000);
    out[name] = res.map((r) => {
      const c = r.classifications[0].categories.find((k) => k.index === 20);
      return c ? c.score : 0;
    });
  }
  return out;
};

window.heap = () => (performance.memory ? performance.memory.usedJSHeapSize : null);

let ast = null;

window.astLoad = async ({ threads = 1 } = {}) => {
  const t0 = now();
  const tr = await import('/nm/@huggingface/transformers/dist/transformers.web.min.js');
  tr.env.allowRemoteModels = false;
  tr.env.allowLocalModels = true;
  tr.env.localModelPath = '/hf/';
  tr.env.useBrowserCache = false;
  tr.env.backends.onnx.wasm.wasmPaths = '/nm/onnxruntime-web/dist/';
  tr.env.backends.onnx.wasm.numThreads = threads;
  const id = 'Xenova/ast-finetuned-audioset-10-10-0.4593';
  const processor = await tr.AutoProcessor.from_pretrained(id);
  const model = await tr.AutoModelForAudioClassification.from_pretrained(id, { dtype: 'q8', device: 'wasm' });
  ast = { tr, processor, model };
  return { totalMs: now() - t0, crossOriginIsolated: self.crossOriginIsolated, threads };
};

async function astLogits(x) {
  const inputs = await ast.processor(x);
  const { logits } = await ast.model(inputs);
  return logits.data;
}

window.astInfer = async ({ reps = 5 } = {}) => {
  const x = noise(160000, 9);
  await astLogits(x);
  const ms = [];
  for (let i = 0; i < reps; i++) {
    const t = now();
    await astLogits(x);
    ms.push(now() - t);
  }
  return stats(ms);
};

window.astParity = async () => {
  const sig = await signals();
  const out = {};
  for (const [name, x] of Object.entries(sig)) out[name] = (await astLogits(x.subarray(0, 163840)))[23];
  return out;
};

window.benchReady = true;
