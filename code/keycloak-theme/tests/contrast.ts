/** WCAG 2.x contrast helpers and a reader for the generated token CSS (no dependencies). */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const TOKENS_CSS = fileURLToPath(new URL('../src/login/styles/tokens.generated.css', import.meta.url));
export const THEME_CSS = fileURLToPath(new URL('../src/login/styles/theme.css', import.meta.url));

const channel = (hex: string, i: number) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

export function luminance(hex: string): number {
  return 0.2126 * lin(channel(hex, 0)) + 0.7152 * lin(channel(hex, 1)) + 0.0722 * lin(channel(hex, 2));
}

export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

export type Vars = Record<string, string>;

/** Custom properties of the dark default (`:root`) and of the light override (`prefers-color-scheme: light`). */
export function readSchemes(css = readFileSync(TOKENS_CSS, 'utf8')): { dark: Vars; light: Vars } {
  const lightStart = css.indexOf('@media (prefers-color-scheme: light)');
  const parse = (block: string): Vars => {
    const out: Vars = {};
    for (const m of block.matchAll(/(--[\w-]+):\s*([^;]+);/g)) out[m[1]] = m[2].trim();
    return out;
  };
  return { dark: parse(css.slice(0, lightStart)), light: parse(css.slice(lightStart)) };
}
