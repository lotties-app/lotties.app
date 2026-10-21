/** Stable 32-bit FNV-1a hash of a string. */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Avatar background derived from the baby id. Lightness is fixed low so white initials keep AA
 * contrast (>= 7:1) on any hue, in both themes.
 */
export function babyColor(id: string): string {
  return `hsl(${hash(id) % 360}, 45%, 32%)`;
}

export function babyInitial(name: string): string {
  return Array.from(name.trim())[0]?.toUpperCase() ?? '?';
}
