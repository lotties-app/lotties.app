# Illustrated category icons (style guide)

Wave 4c, SYNTHESIS.md section 5 item 1. Code: `web/src/ui/illustrations/`. Gallery: `/dev/illustrations` (development only). Screenshots: `cd e2e && npx playwright test -c design-review/illustrations.config.ts` (port 5175) writes `docs/design/screenshots/illustrations-*.png` (gitignored).

## Where they are used (wave 4c-2) and the size grid

| Size  | Where                                                                                         |
| ----- | --------------------------------------------------------------------------------------------- |
| 24    | Day ribbon legend                                                                             |
| 32    | Day rows (on the connecting line), toast stamp, forgotten-timer notice, type menu of the sheet |
| 40-48 | Log tiles and More sheet tiles (48), tray headers, nursing and timer cards (48)               |
| 64    | Event sheet header (soft glow in light and dark), first-run and "what is she doing" choices   |
| 96    | Now state card hero, first-run card, empty Day, estimated nap sheet                           |

`illustrationKeyFor(type, payload)` picks the drawing of an event (sleep kind, feeding method, type key); a custom type falls back to its outline icon in the category tile. The night scheme draws every one of them flat, without halo or glow. Tabler icons stay for chrome (navigation, buttons, chevrons, filters).

## Licence

These illustrations are **original works by the Baby Routine project contributors**, drawn by hand as SVG paths and gradients in code, and are licensed under the project licence (**AGPL-3.0-or-later**, see `LICENSE`). No external artwork, icon set, font glyph, traced image or generated raster was used. Competitor apps were only a source of general principles (soft depth, glow, illustrated categories); no shape, composition or colour scheme of theirs was copied, traced or imitated. Every source file carries the same statement in a header comment.

## What they are for

Hero places: the Now state card, log tiles, the More sheet, Day rows, the toast and the event sheet header. Tabler outline icons (`Icon`, `CategoryIcon`) stay for UI chrome (navigation, buttons, fields, status glyphs).

## The concepts

| Name           | Drawing                                                      | Tile category |
| -------------- | ------------------------------------------------------------ | ------------- |
| `nap`          | puffy cloud, small crescent moon peeking over it             | sleep         |
| `night`        | large crescent, a star in its hollow, a small star           | sleep         |
| `woke_up`      | sun with five rays rising behind two soft hills              | sleep         |
| `bedtime`      | dusk sun sinking between the hills, small cloud, first star  | sleep         |
| `fell_asleep`  | round dream bubble with a big "Z", small "z" drifting away   | sleep         |
| `night_waking` | round moon with one wide-open eye, craters, a spark          | nightWaking   |
| `bottle`       | tilted feeding bottle, milk inside, honey-coloured teat      | feeding       |
| `nursing`      | soft heart with a drop of milk (no anatomy)                  | feeding       |
| `pumping`      | short collection bottle with a wide flange tilted up-left    | feeding       |
| `solid_food`   | bowl heaped with purée, a spoon resting in it                | feeding       |
| `diaper`       | front view, curved leg openings, cream waistband, gold tabs  | diaper        |
| `medication`   | medicine bottle with a cross label, two-tone capsule         | health        |
| `temperature`  | tilted thermometer, pale glass tube, warm bulb and column    | health        |
| `bath`         | round tub on two feet, three bubbles                         | care          |
| `tummy_time`   | little smiling star on its tummy over a towel roll on a mat  | activity      |
| `belly_pain`   | baby bodysuit with a swirl on the tummy and a small plaster  | health        |
| `custom`       | four-point sparkle with a small sparkle and a dot            | custom        |

## Grid and sizes

- 96 x 96 view box. Objects live in about 8..88; the ground glow sits at y 85.
- Sizes 24 to 96 px. At 32 px and under the frame switches to a **compact optical size**: the view box hugs the drawing (`5 5 86 86`, about 12% larger) and the ground glow is left out.
- Silhouettes first: every concept must be identifiable from its outline at 24 px. Details smaller than 5 units (about 1.2 px at 24 px) are decoration only.
- No outlines around shapes. Strokes are used only for letters, a smile and the swirl.

## Light and depth (the gradient recipe)

Light comes from the **top-left** in every drawing. Each solid body is drawn twice with the same path (`Body` in `IllustrationFrame.tsx`):

1. **Fill**: a linear gradient (`objectBoundingBox`, from 0.2,0 to 0.8,1): `hi` at 0, `mid` at 0.5, `lo` at 1 (light scheme: halfway between `mid` and `lo`, so shade stays soft).
2. **Volume overlay**: a radial gradient centred at 30% / 24% (radius 0.95): white at 42% (light) or 36% (dark) opacity fading out by 0.38, then transparent until 0.7, then the `lo` tone at 42% (light) or 60% (dark) at the rim. This is the top-left highlight plus the subtle inner shadow, and because it is in bounding-box units each shape lights itself.
3. **Shine**: one small capsule or dot near the top-left of the main bodies (white, 62% light / 50% dark).
4. **Ground glow**: an ellipse under the object, the main colour (`mid` in dark, `lo` in light) at 42% / 30% fading to nothing.
5. **Halo** (`glow` prop, hero places only): a radial disc behind the object, the main colour at 50% fading to 0.

Gradient ids come from `useId`, so any number of copies can share a page.

## Colour

Colours are **derived from the design tokens** (`web/src/theme/tokens.ts`) at runtime by `palette.ts`; nothing is hardcoded per drawing except white highlights. Each material names a hue (a category, `accent` or `cream`) and gets a tone: `hi`, `mid`, `lo`, `deep`.

- **Dark** (Ink): `mid` is the category `fg` of the dark scheme; `hi` leans 55% to white; `lo` is halfway to the light scheme's ink of the same hue.
- **Light** (Linen): the category colours slightly deeper: 30% from the light ink towards the dark pastel, 25% more chroma; `hi` 68% towards the pastel; `lo` is the ink. Secondary parts can be `lift`ed towards the pastel (food, bubbles, gold accents) where they do not carry the silhouette.
- **Night** (Lamplight): one warm tone, lower chroma, blue channel at most `0x78`, **flat** (no gradient, volume, ground glow or halo; no motion). Materials keep their hierarchy by role: `main` `#9a6e3f`, `light` `#d49a5e` (night text), `dim` `#6b4c2d`, `cream` `#dca668`. Highlights are flat lighter shapes.

Main-shape colours (`hi` / `mid` / `lo`, contrast of `mid` on the category tint):

| Hue         | Light                                          | Dark                                           |
| ----------- | ---------------------------------------------- | ---------------------------------------------- |
| sleep       | `#8ba5cc` / `#4a6a9b` / `#2c4870` (4.4:1)      | `#d8e3f2` / `#a9c1e3` / `#6b85aa` (7.2:1)      |
| feeding     | `#8eb887` / `#548653` / `#375f39` (3.5:1)      | `#d8e9d4` / `#a9cf9f` / `#70976c` (7.6:1)      |
| diaper      | `#d1ab5e` / `#a07521` / `#6e4e0e` (3.3:1)      | `#f5e4c3` / `#e8c47a` / `#ab8944` (7.7:1)      |
| health      | `#e08377` / `#be463b` / `#962f28` (3.9:1)      | `#f8d4ce` / `#f0a093` / `#c3685e` (6.8:1)      |
| care        | `#73b8ae` / `#37867c` / `#1c5b54` (3.5:1)      | `#cdeae5` / `#8fd0c6` / `#56968d` (7.4:1)      |
| activity    | `#df9460` / `#bb5c25` / `#8f3f15` (3.5:1)      | `#f8dbc4` / `#f0ae7c` / `#c07749` (7.1:1)      |
| nightWaking | `#bd92cb` / `#8f519f` / `#6a3478` (4.3:1)      | `#ebdbf1` / `#d3b0e0` / `#9f72ac` (7.5:1)      |
| custom      | `#b3aa9a` / `#776f60` / `#4f483e` (4.0:1)      | `#e9e5de` / `#cfc6b6` / `#8f877a` (8.4:1)      |
| accent      | `#dc7c55` / `#ca552d` / `#a8482a`              | `#f3cdbb` / `#e58f68` / `#c76c49`              |

Night main `#9a6e3f` is 3.8:1 on the night tile `#231910`. `illustrations.test.tsx` checks that the main shape of every illustration is at least **3:1** on its category tint, the surface and the background in all three schemes (the main colour is exposed as `data-main`).

The tile tells the category; the drawing may borrow other hues for its objects (gold moons and suns, cream milk, a teal diaper on the diaper tile). The dominant body carries the contrast.

## API

```tsx
import { Illustration, illustrationFor, NapIllustration } from '../ui/illustrations';

<Illustration name="nap" size={64} glow title={t('...')} />   // by key, themed
const C = illustrationFor(preset.id); <C size={24} />          // component for a key
<NapIllustration scheme="night" />                             // a concept directly
```

Props: `size` (default 48), `scheme` (default: the scheme the app shows; `dark` outside the theme provider), `title` (accessible name; otherwise `aria-hidden`), `glow`, `still` (reserved: the drawings are static; any future motion must stop when set, in night and under `prefers-reduced-motion`), `className`.

`illustrationFor(key)` / `illustrationName(key)` accept built-in preset ids, built-in event type keys, sleep kinds (`nap`, `night`, `woke_up`, `bed_time`, `fell_asleep`, `night_waking`), feeding methods (`breast`, `bottle`, `solid`) and canonical names, through a `Map` (a stored key like `constructor` never resolves). Anything else gets `FallbackIllustration`: the Tabler icon in its category circle at the same size (`Illustration` takes `fallbackIcon` and `fallbackCategory`).

Bundle: all 17 drawings, the registry, palette and geometry are about 22.6 kB minified / 7.1 kB gzip (measured 2026-10-21, shared app modules external), under the 25 kB gzip budget, so they are not split into a lazy chunk. Since wave 4c-2 the Now, Day and sheet screens use them, so they ship in the main bundle (measured before that wave).

## Do and don't

- Do keep the light top-left and the recipe above; reuse `Body`, `Shine`, the geometry helpers (`circle`, `rect`, `capsule`, `crescent`, `cloud`, `star`, `sparkle`).
- Do design the 24 px silhouette first, then add volume and shine.
- Do keep 2 to 4 materials per drawing; one dominant body.
- Don't add outlines, drop shadows with offsets, filters (blur filters render unevenly across sizes), text, brand marks or anatomy.
- Don't hardcode colours: add a hue or a `lift`, and let the tokens drive it.
- Don't use gradients, halos or white in the night scheme (the frame enforces it; tests check blue at most `0x78`).
- Don't copy, trace or closely imitate another app's artwork.

## Adding an illustration

1. Draw it in the family file (`sleep.tsx`, `feeding.tsx`, `care.tsx`, `health.tsx`, `custom.tsx`) as a component wrapping `IllustrationFrame` with `name`, `main`, `materials` (hue, night role, optional lift) and `ground`.
2. Keep the licence header comment.
3. Register it in `registry.ts` (`ILLUSTRATIONS` with its tile category, plus any `ALIASES`) and export it from `index.ts`.
4. Run the tests (contrast, ids, night rules, registry) and the screenshot harness; look at 24 px on the tint and on the surface in all three schemes.
5. Add it to the table above.
