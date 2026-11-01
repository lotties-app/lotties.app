// Aggregates output/results.jsonl + timings.jsonl into output/summary.md (numbers for the report).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const out = path.join(path.dirname(fileURLToPath(import.meta.url)), 'output');
const read = (f) =>
  fs.existsSync(path.join(out, f))
    ? fs.readFileSync(path.join(out, f), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
    : [];

// Keep the last record per (screen, combo).
const byKey = new Map();
for (const r of read('results.jsonl')) byKey.set(`${r.screen}|${r.combo}`, r);
const results = [...byKey.values()];
const lines = [];
const p = (s = '') => lines.push(s);

p(`# Design review raw summary`);
p(`Screens captured (unique screen x combo): ${results.length}`);
p(`Unique screens: ${new Set(results.map((r) => r.screen)).size}`);
p();

// axe by rule
const rules = new Map();
for (const r of results) {
  for (const v of r.axe ?? []) {
    const e = rules.get(v.id) ?? { id: v.id, impact: v.impact, help: v.help, tags: v.tags, screens: new Set(), combos: new Set(), nodes: 0, samples: [] };
    e.screens.add(r.screen);
    e.combos.add(r.combo);
    e.nodes += v.nodes ?? 0;
    if (e.samples.length < 6) for (const s of v.samples ?? []) if (e.samples.length < 6) e.samples.push({ screen: r.screen, combo: r.combo, ...s });
    rules.set(v.id, e);
  }
}
const scanned = results.filter((r) => Array.isArray(r.axe) && r.note !== 'noAxe').length;
p(`## axe-core violations (${scanned} records)`);
for (const e of [...rules.values()].sort((a, b) => b.screens.size - a.screens.size)) {
  p(`### ${e.id} (${e.impact}) - ${e.help}`);
  p(`tags: ${(e.tags ?? []).join(', ')} | screens: ${e.screens.size} | combos: ${e.combos.size} | total nodes: ${e.nodes}`);
  p(`screens: ${[...e.screens].join(', ')}`);
  for (const s of e.samples) {
    const data = s.data && typeof s.data === 'object' ? JSON.stringify(s.data).slice(0, 220) : '';
    p(`- [${s.screen} ${s.combo}] \`${s.target}\` ${data}`);
    p(`  html: \`${(s.html ?? '').replace(/`/g, "'")}\``);
  }
  p();
}

// contrast details
p(`## color-contrast pairs`);
const pairs = new Map();
for (const r of results) for (const v of r.axe ?? []) if (v.id === 'color-contrast')
  for (const s of v.samples ?? []) if (s.data) {
    const k = `${s.data.fgColor} on ${s.data.bgColor} = ${s.data.contrastRatio} (${s.data.fontSize}, ${s.data.fontWeight}) need ${s.data.expectedContrastRatio}`;
    const e = pairs.get(k) ?? { k, where: new Set() };
    e.where.add(`${r.screen}/${r.combo}: ${(s.html ?? '').slice(0, 60)}`);
    pairs.set(k, e);
  }
for (const e of pairs.values()) p(`- ${e.k} :: ${[...e.where].slice(0, 4).join(' | ')}`);
p();

// target sizes
p(`## Targets under 44px (unique names per screen, mobile combos)`);
const small = new Map();
for (const r of results.filter((r) => r.combo.startsWith('mobile'))) for (const t of r.metrics?.small44 ?? []) {
  const k = `${t.name} (${t.tag}${t.role ? '/' + t.role : ''})`;
  const e = small.get(k) ?? { k, sizes: new Set(), screens: new Set() };
  e.sizes.add(`${t.w}x${t.h}`);
  e.screens.add(r.screen);
  small.set(k, e);
}
for (const e of [...small.values()].sort((a, b) => b.screens.size - a.screens.size).slice(0, 60))
  p(`- ${e.k}: ${[...e.sizes].slice(0, 3).join(', ')} on ${[...e.screens].slice(0, 6).join(', ')}`);
p();
p(`## Targets under 24px (WCAG 2.5.8 candidates)`);
const tiny = new Map();
for (const r of results) for (const t of r.metrics?.small24 ?? []) {
  const k = `${t.name} (${t.tag})`;
  const e = tiny.get(k) ?? { k, sizes: new Set(), screens: new Set() };
  e.sizes.add(`${t.w}x${t.h}`);
  e.screens.add(`${r.screen}/${r.combo}`);
  tiny.set(k, e);
}
for (const e of tiny.values()) p(`- ${e.k}: ${[...e.sizes].join(', ')} on ${[...e.screens].slice(0, 5).join(', ')}`);
p();

// clipped, overflow, raw codes, english
p(`## Clipped text`);
const clip = new Map();
for (const r of results) for (const c of r.metrics?.clipped ?? []) {
  const k = c.text;
  const e = clip.get(k) ?? { k, where: new Set() };
  e.where.add(`${r.screen}/${r.combo}`);
  clip.set(k, e);
}
for (const e of [...clip.values()].sort((a, b) => b.where.size - a.where.size).slice(0, 60))
  p(`- "${e.k}" x${e.where.size}: ${[...e.where].slice(0, 4).join(', ')}`);
p();
p(`## Horizontal overflow`);
for (const r of results) if (r.metrics?.hOverflow) p(`- ${r.screen}/${r.combo}: ${r.metrics.hOverflow}px`);
p();
p(`## Raw codes visible`);
const raw = new Map();
for (const r of results) for (const w of r.metrics?.rawCodes ?? []) {
  const e = raw.get(w) ?? new Set();
  e.add(`${r.screen}/${r.combo}`);
  raw.set(w, e);
}
for (const [w, where] of raw) p(`- ${w}: ${[...where].slice(0, 5).join(', ')} (${where.size})`);
p();
p(`## English strings on pt-BR screens`);
const en = new Map();
for (const r of results) for (const w of r.metrics?.english ?? []) {
  const e = en.get(w) ?? new Set();
  e.add(`${r.screen}/${r.combo}`);
  en.set(w, e);
}
for (const [w, where] of en) p(`- "${w}": ${[...where].slice(0, 5).join(', ')} (${where.size})`);
p();
p(`## Document titles / lang`);
const titles = new Set(results.map((r) => `${r.metrics?.title} | lang=${r.metrics?.lang} | ${r.combo.split('-').slice(2).join('-')}`));
for (const t of titles) p(`- ${t}`);
p();

// timings
p(`## Timings (ms; Vite dev server, local API)`);
const timings = new Map();
for (const t of read('timings.jsonl')) {
  const a = timings.get(t.name) ?? [];
  a.push(t.ms);
  timings.set(t.name, a);
}
for (const [name, a] of timings) {
  a.sort((x, y) => x - y);
  p(`- ${name}: n=${a.length} median=${a[Math.floor(a.length / 2)]} min=${a[0]} max=${a[a.length - 1]}`);
}
p();
p(`## Capture errors`);
for (const e of read('errors.jsonl')) p(`- ${e.combo} ${e.step}: ${e.error}`);

fs.writeFileSync(path.join(out, 'summary.md'), lines.join('\n'));
console.log(`wrote summary.md (${lines.length} lines)`);
