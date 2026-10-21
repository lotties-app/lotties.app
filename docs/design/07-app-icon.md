# Design review 07: app icon and wordmark (concepts)

Date: 2026-10-21. Sources: `docs/design/icons/` (`icon-<id>.svg`, `-dark`, `-maskable`, `-mono`, `favicon-<id>.svg`, `lockup-<id>.svg`). Mockup with every size, home screens, Android masks, badge, tab, sign-in, top bar and computed contrast: `docs/design/mockups/07-app-icon.html`. The current blue bottle tile predates direction B.

## Concepts

**E · Mobile.** Sun and moon hang from an arm, a star between them, a terracotta "now" bead at the pivot.
- Says baby (crib), day and night, calm; the arm echoes the day ruler.
- Mobiles are nursery decor, not a common app mark.
- Risk: a scale reading, but it hangs from above and its ends differ.
- Thin lines need the favicon below 48 px.

**C · br monogram.** "b" and "r" drawn as paths in the spirit of Fraunces, with a terracotta star ending the r.
- Editorial and ownable, but says "brand", not "baby".
- Risk: Beats (b in a circle) and Booking.com ("B."), so there is no enclosing circle and no trailing dot.

**D · Moon bassinet.** A bassinet on a rocker with a crescent for a hood, a small head, a star.
- The most literal "baby asleep".
- Pram pictograms are common; the crescent hood is the difference.
- The bowl can read as a dish, and it is the busiest of the five.

**A · Cloud cradle.** An upside-down "hammock" cloud cradles a crescent.
- The closest to the illustration set.
- Moon plus cloud is the weather "cloudy night" symbol and common decal art. The first draft (moon behind a flat cloud) was exactly that and was dropped.

**B · Day disc.** Half terracotta day, half ink night, standing on the day ruler with "now" at dusk.
- The most on-brand, but abstract: it reads as an eclipse, the ruler as a media scrubber, and there is no baby cue.
- Drafts dropped: a red-over-blue split with a band (Poké Ball, Pepsi globe), and ruler ticks that looked like table legs.

**Avoided everywhere:** a star inside a crescent's hollow (a flag and religious symbol), pacifier, stork, bottle, footprints. No competitor icon (Napper, Huckleberry, Baby Tracker) was opened or traced. These notes come from general knowledge, so run an app-store and trademark search before adopting.

## At 16 px

Favicons are redrawn on a 32 grid: whole-pixel lines, flat colour, fewer parts.
- C ("b✦") is crisp, and E (arm, bead, sun, moon) reads.
- A is fair; D (a lidded bowl) and B (a ball on a line) lose meaning.

Below 32 px, use the favicon drawing in-app too.

## Ranking

1. **E Mobile**: strongest idea, most ownable, fits the illustration family. **Recommended**, with its own favicon.
2. **C br monogram**: best when small; choose it for a typographic brand.
3. **D Moon bassinet**: clear but busier and more generic.
4. **A Cloud cradle**: pleasant, common imagery.
5. **B Day disc**: a good emblem, a weak app icon.

## Colours (tokens.ts, ILLUSTRATIONS.md)

- **Tiles:** light `#fffcf6` → `#f5efe4` → `#ebe2d0`; dark `#332e27` → `#24201b` → `#1b1814`; radius 230/1024.
- **Light (hi/mid/lo):** terracotta `#dc7c55/#ca552d/#a8482a`, blue `#8ba5cc/#4a6a9b/#2c4870`, gold `#d1ab5e/#a07521/#6e4e0e`, ink `#5d554a/#3a332b/#2a251f`.
- **Dark:** terracotta `#f3cdbb/#e58f68/#c76c49`, blue `#d8e3f2/#a9c1e3/#6b85aa`, gold `#f5e4c3/#e8c47a/#ab8944`, cream `#f2eadc`.
- **Favicon:** `#f5efe4` tile; `#b04c29`, `#35558a`, `#2a251f`, `#b07e22` (3.1 to 13.3:1).
- **Contrast:** every main shape is at least 3:1 on its tile; the lowest are 3.6:1 (light gold) and 3.8:1 (light terracotta).
- **Wordmark:** Fraunces 600, ink `#2a251f` on light, `#f2eadc` on dark.

## Licence

Original work by the Baby Routine contributors, AGPL-3.0-or-later with the project. It is hand-built SVG: no raster, generated or traced art, and no embedded font. The lockups use live Fraunces text (SIL OFL 1.1), and outlining it for final art is allowed. The mockup embeds the woff2 the app already ships, with its notice. Blocking look-alike forks would need a trademark notice, not a licence change.

## Implementation checklist

- Copy the chosen art to `web/public/` as `icon.svg`, `icon-maskable.svg`, `icon-mono.svg` and `favicon.svg`.
- Change `generate-icons.mjs` to read the maskable file instead of string-replacing `#bg`/`#glyph`. It writes:
  - `icon-192/512.png` and `icon-maskable-512.png`;
  - `apple-touch-icon.png` (180) from the full-bleed art, since iOS masks it and turns transparent corners black;
  - `favicon.png` (32) from `favicon.svg`;
  - `icon-monochrome-512.png`, the mono scaled to about 0.7.

  sharp/librsvg renders these SVGs correctly (checked).
- `favicon.ico` is optional; sharp cannot write ICO.
- Manifest: add the `monochrome` icon and update `includeAssets`. `theme_color` stays `#1b1814`.
- `index.html`: SVG favicon link, PNG fallback, `apple-touch-icon`.
- The mono SVG is cropped tight, for a 24 px badge.
- Keycloak theme logo: the lockup with outlined text, or the icon plus Fraunces in the theme CSS.
- Social preview for the repository: 1200×630 PNG, linen background with the lockup.
- Header: the favicon drawing at 24-32 px plus `t('app.name')` in `fontFamilyDisplay` 600. `LoginPage`: the icon at 88 px above the name.
- The "Baby Routine" label may truncate on iOS; `short_name` is the owner's call.
