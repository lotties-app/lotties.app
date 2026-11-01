import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/*
 * MediaPipe (and its 6.7 MB WASM) must never reach the main bundle: only the classifier worker imports it, and the
 * worker is a separate chunk started with `new Worker(new URL(...))`. This walks the static import graph from the
 * app entry (src/main.tsx) the way the bundler does (type-only imports and dynamic import() are not followed).
 */

const SRC = path.resolve(__dirname, '..');
const MEDIAPIPE = '@mediapipe/tasks-audio';

const STATIC_IMPORT = /^\s*(?:import|export)\s+(?!type\b)(?:[^'";]*?\sfrom\s+)?['"]([^'"]+)['"]/gm;

function resolveLocal(from: string, spec: string): string | null {
  const base = path.resolve(path.dirname(from), spec.split('?')[0]);
  for (const candidate of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    path.join(base, 'index.ts'),
    path.join(base, 'index.tsx'),
  ]) {
    try {
      if (statSync(candidate).isFile()) return candidate;
    } catch {
      // next candidate
    }
  }
  return null;
}

function staticGraph(entry: string): { files: Set<string>; packages: Set<string> } {
  const files = new Set<string>();
  const packages = new Set<string>();
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.pop() as string;
    if (files.has(file)) continue;
    files.add(file);
    if (!/\.(ts|tsx)$/.test(file)) continue;
    const text = readFileSync(file, 'utf8');
    for (const match of text.matchAll(STATIC_IMPORT)) {
      const spec = match[1];
      if (spec.includes('?worker') || spec.includes('?url')) continue; // a URL string, built separately
      if (spec.startsWith('.')) {
        const resolved = resolveLocal(file, spec);
        if (resolved) queue.push(resolved);
      } else {
        packages.add(spec);
      }
    }
  }
  return { files, packages };
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

describe('cry engine bundle boundary', () => {
  it('the graph walker sees imports (sanity)', () => {
    const { files, packages } = staticGraph(path.join(SRC, 'cry', 'engine.ts'));
    expect([...files].map((f) => path.basename(f))).toEqual(
      expect.arrayContaining(['engine.ts', 'trigger.ts', 'sensitivity.ts', 'errors.ts']),
    );
    expect(packages.size).toBe(0);
    const worker = staticGraph(path.join(SRC, 'cry', 'classifier.worker.ts'));
    expect(worker.packages).toContain(MEDIAPIPE);
  });

  it('the app entry never reaches @mediapipe/tasks-audio or the worklet statically', () => {
    const { files, packages } = staticGraph(path.join(SRC, 'main.tsx'));
    expect(files.size).toBeGreaterThan(50);
    expect([...packages]).not.toContain(MEDIAPIPE);
    const names = [...files].map((f) => path.relative(SRC, f).replace(/\\/g, '/'));
    expect(names).not.toContain('cry/classifier.worker.ts');
    expect(names).not.toContain('cry/captureWorklet.ts');
  });

  it('keeps the whole engine out of the main bundle and out of the monitor page chunk', () => {
    const rel = (files: Set<string>) =>
      [...files].map((f) => path.relative(SRC, f).replace(/\\/g, '/'));
    // The app entry reaches the monitor's small helpers (consent clean-up at sign-out) but no engine file.
    const app = rel(staticGraph(path.join(SRC, 'main.tsx')).files);
    expect(app.filter((name) => name.startsWith('cry/'))).toEqual([]);
    expect(app).not.toContain('cryMonitor/CryMonitorPage.tsx');
    // The page loads the engine with import() only when "Start monitoring" is pressed.
    const page = rel(staticGraph(path.join(SRC, 'cryMonitor', 'CryMonitorPage.tsx')).files);
    expect(page.length).toBeGreaterThan(5);
    expect(page.filter((name) => name.startsWith('cry/'))).toEqual([]);
    expect(page).not.toContain('cryMonitor/fakeCryEngine.ts');
  });

  it('only the classifier worker imports MediaPipe, and the public API loads capture and classifier lazily', () => {
    const importers = sourceFiles(SRC)
      .filter((file) => readFileSync(file, 'utf8').includes(`'${MEDIAPIPE}'`))
      .map((file) => path.relative(SRC, file).replace(/\\/g, '/'));
    expect(importers).toEqual(['cry/classifier.worker.ts']);

    const api = staticGraph(path.join(SRC, 'cry', 'index.ts'));
    const reached = [...api.files].map((f) => path.basename(f));
    expect(reached).not.toContain('capture.ts');
    expect(reached).not.toContain('classifier.ts');
    expect(reached).not.toContain('classifier.worker.ts');
  });
});
