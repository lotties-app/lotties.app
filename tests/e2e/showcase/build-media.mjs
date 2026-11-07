// Turns the raw captures (showcase/output) into the small files that are committed to
// code/web/public/showcase/: WebP screenshots (each under 250 KB), and per language the demo video
// as MP4 (H.264) and WebM (VP9) plus a poster. sharp comes from code/web (a project dependency);
// the video step needs ffmpeg on the PATH (skipped with a note when it is missing).
// Run from tests/e2e/: node showcase/build-media.mjs   (docs/showcase-media.md)
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..');
const require = createRequire(path.join(repoRoot, 'code/web/package.json'));
const sharp = require('sharp');

const RAW = path.join(here, 'output', 'raw');
const VIDEO = path.join(here, 'output', 'video');
const OUT = path.join(repoRoot, 'code/web/public/showcase');
const MAX_BYTES = 250 * 1024;
fs.mkdirSync(OUT, { recursive: true });

/** Smallest quality that fits MAX_BYTES (starts high, steps down). */
async function toWebp(input, output) {
  for (let quality = 82; quality >= 40; quality -= 6) {
    const buffer = await sharp(input).webp({ quality, effort: 6 }).toBuffer();
    if (buffer.length <= MAX_BYTES || quality <= 40) {
      fs.writeFileSync(output, buffer);
      return { quality, bytes: buffer.length };
    }
  }
}

const report = [];
if (fs.existsSync(RAW)) {
  for (const file of fs.readdirSync(RAW).filter((f) => f.endsWith('.png')).sort()) {
    const out = path.join(OUT, file.replace(/\.png$/, '.webp'));
    const { quality, bytes } = await toWebp(path.join(RAW, file), out);
    report.push(`${path.basename(out)}  q${quality}  ${(bytes / 1024).toFixed(0)} KB`);
  }
}

const hasFfmpeg = (() => {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();
if (fs.existsSync(VIDEO)) {
  for (const file of fs.readdirSync(VIDEO).filter((f) => /^demo-.+\.webm$/.test(f))) {
    const locale = file.slice('demo-'.length, -'.webm'.length);
    const input = path.join(VIDEO, file);
    if (!hasFfmpeg) {
      report.push(`${file}: ffmpeg not found, video not encoded`);
      continue;
    }
    const run = (args) => execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-ss', '0.8', '-i', input, ...args], { stdio: 'inherit' });
    const mp4 = path.join(OUT, `demo-${locale}.mp4`);
    const webm = path.join(OUT, `demo-${locale}.webm`);
    run(['-an', '-c:v', 'libx264', '-preset', 'slow', '-crf', '30', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', mp4]);
    run(['-an', '-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '38', '-row-mt', '1', webm]);
    // The poster is the Now screen (a video frame can be blank while the page loads).
    const frame = path.join(RAW, `now-light-${locale}.png`);
    const poster = path.join(OUT, `demo-${locale}-poster.webp`);
    const { bytes } = await toWebp(await sharp(frame).resize(390, 844).png().toBuffer(), poster);
    for (const f of [mp4, webm]) report.push(`${path.basename(f)}  ${(fs.statSync(f).size / 1024).toFixed(0)} KB`);
    report.push(`${path.basename(poster)}  ${(bytes / 1024).toFixed(0)} KB`);
  }
}
console.log(report.join('\n'));
