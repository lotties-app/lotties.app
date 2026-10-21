# Design tokens (direction B "Linen and Ink")

Single source of truth: `web/src/theme/tokens.ts` (plain data, contrast-tested in `tokens.test.ts`). `web/src/theme/theme.ts` maps it onto MUI palettes; components read `theme.vars.palette.*` (CSS variables `--mui-palette-*`) and never hardcode colours. Values come from `docs/design/02-visual-identity.md` section 8 and 6.

## Schemes

| Scheme  | Name                   | Selected by              | Notes                                                                                                                                 |
| ------- | ---------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| `light` | Linen                  | `data-light` on `<html>` | warm paper, terracotta accent                                                                                                         |
| `dark`  | Ink                    | `data-dark`              | default when the OS gives no preference                                                                                               |
| `night` | Lamplight (night feed) | `data-night`             | dark palette mode; near-black, one warm tone, blue channel <= 0x78, text about 45% of dark, one category pair, no shadow/grain/motion |

Mode (Settings > Appearance): System / Light / Dark (`baby-routine.theme`). Night feed: Off / Ask / Auto (`baby-routine.nightFeed`, default Ask) decided by `nightFeed.ts` (local 22:00-05:00); the explicit choice and "Not now" live in `baby-routine.nightFeed.state` and expire at the next window boundary. `public/theme-init.js` mirrors these rules before first paint (keep both in sync); it also points the manifest and apple-touch-icon links at the light or dark icon set (night counts as dark, `src/pwa/schemeLinks.ts`).

## Roles (MUI path in brackets)

| Role                                 | light                              | dark                  | night                 |
| ------------------------------------ | ---------------------------------- | --------------------- | --------------------- |
| background [`background.default`]    | `#f5efe4`                          | `#1b1814`             | `#0d0906`             |
| surface [`background.paper`]         | `#fffcf6`                          | `#24201b`             | `#150f0a`             |
| surfaceRaised                        | `#eee6d6`                          | `#2e2a23`             | `#1d150d`             |
| hairline [`divider`]                 | `#e2d8c5`                          | `#3b362d`             | `#2a1f13`             |
| text [`text.primary`]                | `#2a251f`                          | `#f2eadc`             | `#d49a5e`             |
| textMuted [`text.secondary`]         | `#6a6054`                          | `#b5aa99`             | `#a87a4a`             |
| accent [`primary.main`] / onAccent   | `#a8482a` / `#fffcf6`              | `#e58f68` / `#23140c` | `#e0913f` / `#1a0f05` |
| selection / onSelection              | `#2a251f` / `#fffcf6`              | `#f2eadc` / `#1b1814` | `#c98f52` / `#1a0f05` |
| ink2 [`secondary.main`, `info.main`] | `#2c4870`                          | `#9fb6d6`             | `#c98f52`             |
| success / warning / error / info     | feeding / diaper / health fg, ink2 | same                  | warm tones only       |
| themeColor (meta, manifest)          | `#f5efe4`                          | `#1b1814`             | `#0d0906`             |

Category pairs `category.<name>.{bg,fg}` (sleep, feeding, diaper, health, care, activity, nightWaking, custom) and chart colours `chart.{night,nap,feed,diaper,medication,neutral}` are in `tokens.ts` (night: every category `#231910/#c98f52`). Status chips and alerts use the category pair of their status (success=feeding, warning=diaper, error=health, info=sleep). Also tokens: `cardShadow`, `fabShadow`, `scrim`, `grainOpacity`.

Deviation: chart `nap` light is `#9084ec` (the review's `#9a8ef0` is 2.7:1 on the surface, below the 3:1 floor).

Shape `RADIUS`: card 20, tile 16, stamp 12, button 16, input 14, pill 999, sheetTop 24. Type: sans system stack for body (15px), serif `Fraunces Variable` (latin + latin-ext, weight axis only, `fonts.css`) for `hero` 48, `amount` 64, `h4`, `h5`; tabular lining figures on `body`; nothing under 12px.

## Adding a scheme

1. Add a `SchemeTokens` const in `tokens.ts`, register it in `SCHEMES`, `THEME_COLOR` and `SchemeName`/`SCHEME_NAMES`.
2. In `theme.ts` add `colorSchemes.<name>: createColorScheme({ palette: paletteFor('dark' | 'light', TOKENS) })` (non-default custom schemes must go through `createColorScheme`) and the `ColorSchemeOverrides` augmentation.
3. Decide how it is selected: `AppThemeProvider` maps a scheme to MUI's mode slot (`setMode` + `setColorScheme({ dark: ... })`) and updates the theme-color meta; mirror it in `public/theme-init.js` and the `html[data-...]` background in `index.html`.
4. `tokens.test.ts` checks every scheme automatically (AA text, icons on tints, status, charts); add scheme-specific rules there.
