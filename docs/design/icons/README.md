# App icon art

Concept B, "Day disc", is the app icon (decision and rationale: `../07-app-icon.md`). The other concepts (`*-a*`, `*-c*`, `*-d*`, `*-e*`) are kept as design history only; nothing ships them. All files are hand-built SVG, original work by the project contributors, AGPL-3.0-or-later. There is no generator: edit the SVGs.

## Files of concept B and where they are used

| File | Used for |
| --- | --- |
| `icon-b.svg` | Light tile, 1024 grid. Copied to `web/public/icon.svg`; PNGs `icon-192.png`, `icon-512.png`; the README logo. |
| `icon-b-dark.svg` | Dark tile. Reference for the dark colours in `web/src/ui/BrandMark.tsx`; not shipped on its own. |
| `icon-b-maskable.svg` | Full bleed, glyph scaled to 0.78 (inside the 66% safe zone). Rendered as `icon-maskable-512.png`; at 0.92 as the opaque `apple-touch-icon.png`. |
| `icon-b-mono.svg` | Silhouette (alpha only), thick shapes for 24 px. Rendered at 0.6 inside 512 px as `icon-monochrome-512.png` (manifest `purpose: monochrome`). |
| `favicon-b.svg` | Simplified 32 grid drawing (larger disc, whole-pixel ruler, flat colour, dark palette via `prefers-color-scheme`). Copied to `web/public/favicon.svg` and `keycloak-theme/src/login/art/favicon.svg`; rendered as `favicon.png` (32) and `favicon.ico` (16, 32, 48). |
| `lockup-b.svg` | Icon plus live Fraunces text (outline the text for final art). Reference only. |

The drawing in `web/src/ui/BrandMark.tsx` (app) and `keycloak-theme/src/login/art/BrandMark.tsx` (sign-in theme) repeats the shapes of `icon-b.svg` (above 32 px) and `favicon-b.svg` (32 px and under). Keep them in step when the art changes.

## Regenerate

```bash
cd web
node scripts/generate-icons.mjs            # PNGs, favicon.ico, copies of the SVGs (needs the sharp devDependency)
node scripts/generate-social-preview.mjs   # ../docs/design/social-preview.png (needs e2e/node_modules with Chromium)
```

`docs/design/social-preview.png` (1200x630) is the repository social preview; upload it in GitHub under Settings > General > Social preview.

Colours: `07-app-icon.md` section "Colours". The manifest `theme_color` and `background_color` stay `#1b1814` (the dark scheme background, `../TOKENS.md`): the light icon tile is shown on that splash colour with the maskable padding around it.
