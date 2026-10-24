import type { Inline } from './policyTypes';

/*
 * The two inline conventions of the policy text (policyTypes.ts): `[label](href)` links and `{name}`
 * values. Pure, so the content tests can check every link and value without rendering.
 */

/** Values that become React content (a link to write to, a name): filled in by the page. */
export const SLOT_NAMES = ['controller', 'contact', 'dpo', 'version', 'lastUpdated'] as const;
export type SlotName = (typeof SLOT_NAMES)[number];

/** Addresses a link may use as its href (`[issues]({issuesUrl})`). */
export const URL_TOKENS = ['issuesUrl', 'advisoryUrl', 'repoUrl'] as const;
export type UrlToken = (typeof URL_TOKENS)[number];

export type LinkTarget = 'anchor' | 'route' | 'external';

export type InlinePart =
  | { kind: 'text'; text: string }
  | { kind: 'link'; label: string; href: string; target: LinkTarget }
  | { kind: 'slot'; name: SlotName };

const PATTERN = /\[([^\]]+)\]\(([^)\s]+)\)|\{([A-Za-z]+)\}/g;

const isSlot = (name: string): name is SlotName => (SLOT_NAMES as readonly string[]).includes(name);
const isUrlToken = (name: string): name is UrlToken =>
  (URL_TOKENS as readonly string[]).includes(name);

/** What kind of link an href is; `null` for anything the page must not render as a link. */
export function linkTarget(href: string): LinkTarget | null {
  if (/^#[a-z0-9-]+$/.test(href)) return 'anchor';
  if (/^\/[A-Za-z0-9/_#-]*$/.test(href) && !href.startsWith('//')) return 'route';
  if (/^https:\/\/[^\s]+$/.test(href) || /^mailto:[^\s]+$/.test(href)) return 'external';
  return null;
}

/** Replaces `{issuesUrl}` and the other URL tokens of an href; unknown tokens are left as they are. */
function resolveHref(href: string, urls: Readonly<Record<UrlToken, string>>): string {
  return href.replace(/\{([A-Za-z]+)\}/g, (match, name: string) =>
    isUrlToken(name) ? urls[name] : match,
  );
}

/**
 * Splits inline text into text, links and slots. A malformed link or an unknown `{name}` stays plain
 * text (the content tests make sure none is left).
 */
export function parseInline(text: Inline, urls: Readonly<Record<UrlToken, string>>): InlinePart[] {
  const parts: InlinePart[] = [];
  let last = 0;
  const push = (value: string) => {
    if (!value) return;
    const previous = parts[parts.length - 1];
    if (previous?.kind === 'text') previous.text += value;
    else parts.push({ kind: 'text', text: value });
  };
  for (const match of text.matchAll(PATTERN)) {
    const index = match.index ?? 0;
    push(text.slice(last, index));
    last = index + match[0].length;
    const [whole, label, rawHref, slot] = match;
    if (slot !== undefined) {
      if (isSlot(slot)) parts.push({ kind: 'slot', name: slot });
      else push(whole);
      continue;
    }
    const href = resolveHref(rawHref, urls);
    const target = linkTarget(href);
    if (target) parts.push({ kind: 'link', label, href, target });
    else push(whole);
  }
  push(text.slice(last));
  return parts;
}
