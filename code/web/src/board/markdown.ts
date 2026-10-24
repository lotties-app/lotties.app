/*
 * A small, safe Markdown subset for board item bodies (docs/design/36-project-board.md section 10):
 * headings, paragraphs, lists, block quotes, rules, fenced code, inline code, bold, italic and
 * http(s) links. The parser returns a tree that `MarkdownView` renders as React elements: no HTML
 * string is ever produced or injected, raw HTML stays literal text, images become their alt text,
 * and a link whose address is not absolute http or https becomes plain text.
 */

export type MdInline =
  | { kind: 'text'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'strong'; children: MdInline[] }
  | { kind: 'em'; children: MdInline[] }
  | { kind: 'link'; href: string; children: MdInline[] }
  | { kind: 'break' };

export type MdBlock =
  | { kind: 'heading'; level: 1 | 2 | 3 | 4 | 5 | 6; children: MdInline[] }
  | { kind: 'paragraph'; children: MdInline[] }
  | { kind: 'list'; ordered: boolean; start: number; items: MdInline[][] }
  | { kind: 'quote'; children: MdInline[] }
  | { kind: 'code'; text: string }
  | { kind: 'rule' };

/** Deeper emphasis than this is shown as text (no pathological recursion). */
const MAX_DEPTH = 4;

/** The address of a link when it is an absolute http(s) URL, else `null` (javascript:, data:, relative...). */
export function safeHref(raw: string): string | null {
  const value = raw.trim();
  if (!/^https?:\/\//i.test(value)) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

const isWordChar = (ch: string | undefined) => !!ch && /[\p{L}\p{N}]/u.test(ch);

/**
 * How far a closing `]` or emphasis delimiter is looked for: keeps a body full of unmatched
 * brackets or stars linear instead of quadratic.
 */
const SEARCH_WINDOW = 1_000;

/** Index of the `]` that closes the `[` at `open`, honouring nesting and escapes; -1 when none. */
function closingBracket(src: string, open: number): number {
  let depth = 0;
  const end = Math.min(src.length, open + SEARCH_WINDOW);
  for (let i = open; i < end; i++) {
    const ch = src[i];
    if (ch === '\\') i++;
    else if (ch === '[') depth++;
    else if (ch === ']' && --depth === 0) return i;
  }
  return -1;
}

/** `[text](url)` at `start` (the `[`): the label, the address and where it ends. */
function linkAt(src: string, start: number): { label: string; url: string; end: number } | null {
  const close = closingBracket(src, start);
  if (close < 0 || src[close + 1] !== '(') return null;
  const end = src.indexOf(')', close + 2);
  if (end < 0) return null;
  const url = src.slice(close + 2, end).trim();
  if (/\s/.test(url)) return null;
  return { label: src.slice(start + 1, close), url, end: end + 1 };
}

/** A bare http(s) address at `start`, without trailing punctuation. */
function autolinkAt(
  src: string,
  start: number,
): { href: string; text: string; end: number } | null {
  if (isWordChar(src[start - 1])) return null;
  const match = /^https?:\/\/[^\s<>()[\]"'`]+/i.exec(src.slice(start, start + 2_000));
  if (!match) return null;
  const text = match[0].replace(/[.,;:!?'"]+$/, '');
  const href = safeHref(text);
  return href ? { href, text, end: start + text.length } : null;
}

/** The closing delimiter of an emphasis opened at `start`, or -1. */
function closingDelimiter(src: string, start: number, delimiter: string): number {
  const from = start + delimiter.length;
  if (src[from] === undefined || /\s/.test(src[from])) return -1;
  const limit = from + SEARCH_WINDOW;
  let i = from;
  while (i < src.length && i < limit) {
    const at = src.indexOf(delimiter, i);
    if (at < 0 || at > limit) return -1;
    const before = src[at - 1];
    const after = src[at + delimiter.length];
    const intraword = delimiter.startsWith('_') && isWordChar(after);
    if (at > from && !/\s/.test(before) && before !== '\\' && !intraword) {
      // `**` inside `*...*`: skip a longer run so `*a **b** c*` closes on the last star.
      if (delimiter === '*' && after === '*') {
        i = at + 2;
        continue;
      }
      return at;
    }
    i = at + delimiter.length;
  }
  return -1;
}

/** Inline Markdown of one block: code, emphasis, links, autolinks, escapes and line breaks. */
export function parseInline(src: string, depth = 0): MdInline[] {
  const out: MdInline[] = [];
  let text = '';
  const flush = () => {
    if (text) out.push({ kind: 'text', text });
    text = '';
  };
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === '\\' && i + 1 < src.length && /[\\`*_[\]()#+\-.!>~|]/.test(src[i + 1])) {
      text += src[i + 1];
      i += 2;
      continue;
    }
    if (ch === '\n') {
      flush();
      out.push({ kind: 'break' });
      i++;
      continue;
    }
    if (ch === '`') {
      const close = src.indexOf('`', i + 1);
      if (close > i + 1) {
        flush();
        out.push({ kind: 'code', text: src.slice(i + 1, close) });
        i = close + 1;
        continue;
      }
    }
    if (ch === '!' && src[i + 1] === '[') {
      // Images are never loaded: their alt text stands in.
      const image = linkAt(src, i + 1);
      if (image) {
        text += image.label;
        i = image.end;
        continue;
      }
    }
    if (ch === '[') {
      const link = linkAt(src, i);
      if (link) {
        flush();
        const children = depth < MAX_DEPTH ? parseInline(link.label, depth + 1) : [];
        const href = safeHref(link.url);
        if (href) out.push({ kind: 'link', href, children });
        else
          out.push(...(children.length ? children : [{ kind: 'text' as const, text: link.label }]));
        i = link.end;
        continue;
      }
    }
    if ((ch === 'h' || ch === 'H') && /^https?:\/\//i.test(src.slice(i, i + 8))) {
      const auto = autolinkAt(src, i);
      if (auto) {
        flush();
        out.push({ kind: 'link', href: auto.href, children: [{ kind: 'text', text: auto.text }] });
        i = auto.end;
        continue;
      }
    }
    if ((ch === '*' || ch === '_') && depth < MAX_DEPTH) {
      const double = src[i + 1] === ch;
      const delimiter = double ? ch + ch : ch;
      const opensWord = ch === '*' || !isWordChar(src[i - 1]);
      const close = opensWord ? closingDelimiter(src, i, delimiter) : -1;
      if (close > 0) {
        flush();
        const children = parseInline(src.slice(i + delimiter.length, close), depth + 1);
        out.push(double ? { kind: 'strong', children } : { kind: 'em', children });
        i = close + delimiter.length;
        continue;
      }
    }
    text += ch;
    i++;
  }
  flush();
  return out;
}

const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const BULLET = /^\s{0,3}[-*+]\s+(.*)$/;
const ORDERED = /^\s{0,3}(\d{1,9})[.)]\s+(.*)$/;
const FENCE = /^\s{0,3}(```|~~~)/;
const RULE = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;
const QUOTE = /^\s{0,3}>\s?(.*)$/;

/** Splits a body into blocks. Unknown syntax stays paragraph text. */
export function parseMarkdown(source: string): MdBlock[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const blocks: MdBlock[] = [];
  let i = 0;
  const isBlank = (line: string | undefined) => line === undefined || line.trim() === '';
  const startsBlock = (line: string) =>
    HEADING.test(line) ||
    FENCE.test(line) ||
    RULE.test(line) ||
    QUOTE.test(line) ||
    BULLET.test(line) ||
    ORDERED.test(line);

  while (i < lines.length) {
    const line = lines[i];
    if (isBlank(line)) {
      i++;
      continue;
    }
    const fence = FENCE.exec(line);
    if (fence) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith(fence[1])) body.push(lines[i++]);
      i++; // the closing fence (or the end)
      blocks.push({ kind: 'code', text: body.join('\n') });
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      const level = heading[1].length as 1 | 2 | 3 | 4 | 5 | 6;
      blocks.push({ kind: 'heading', level, children: parseInline(heading[2]) });
      i++;
      continue;
    }
    if (RULE.test(line)) {
      blocks.push({ kind: 'rule' });
      i++;
      continue;
    }
    if (QUOTE.test(line)) {
      const quoted: string[] = [];
      while (i < lines.length && QUOTE.test(lines[i])) quoted.push(QUOTE.exec(lines[i++])![1]);
      blocks.push({ kind: 'quote', children: parseInline(quoted.join('\n')) });
      continue;
    }
    const ordered = ORDERED.exec(line);
    if (ordered || BULLET.test(line)) {
      const pattern = ordered ? ORDERED : BULLET;
      const items: string[] = [];
      while (i < lines.length && !isBlank(lines[i])) {
        const match = pattern.exec(lines[i]);
        if (match) items.push(ordered ? match[2] : match[1]);
        else if (startsBlock(lines[i])) break;
        else items[items.length - 1] += `\n${lines[i].trim()}`;
        i++;
      }
      blocks.push({
        kind: 'list',
        ordered: !!ordered,
        start: ordered ? Number(ordered[1]) : 1,
        items: items.map((item) => parseInline(item)),
      });
      continue;
    }
    const paragraph: string[] = [];
    while (
      i < lines.length &&
      !isBlank(lines[i]) &&
      (paragraph.length === 0 || !startsBlock(lines[i]))
    ) {
      paragraph.push(lines[i++]);
    }
    blocks.push({ kind: 'paragraph', children: parseInline(paragraph.join('\n')) });
  }
  return blocks;
}
