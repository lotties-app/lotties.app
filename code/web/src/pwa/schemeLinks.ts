import type { SchemeName } from '../theme/tokens';

/** The two icon/manifest sets: the light tile and the dark tile (docs/design/icons/README.md). */
export const SCHEME_LINKS = {
  light: { manifest: '/manifest.webmanifest', appleTouchIcon: '/apple-touch-icon.png' },
  dark: { manifest: '/manifest-dark.webmanifest', appleTouchIcon: '/apple-touch-icon-dark.png' },
} as const;

/** The night-feed scheme counts as dark. */
export function linksFor(scheme: SchemeName) {
  return scheme === 'light' ? SCHEME_LINKS.light : SCHEME_LINKS.dark;
}

/**
 * Points `<link rel="manifest">` and `<link rel="apple-touch-icon">` at the set of the shown scheme
 * (the web manifest and iOS have no dark icon field or media query). public/theme-init.js does the
 * same before first paint; keep the two in step. Only writes when the href differs, so the browser
 * does not refetch the manifest on every render.
 */
export function applySchemeLinks(scheme: SchemeName, doc: Document = document) {
  const links = linksFor(scheme);
  const set = (rel: string, href: string) => {
    doc.querySelectorAll<HTMLLinkElement>(`link[rel="${rel}"]`).forEach((link) => {
      if (link.getAttribute('href') !== href) link.setAttribute('href', href);
    });
  };
  set('manifest', links.manifest);
  set('apple-touch-icon', links.appleTouchIcon);
}
