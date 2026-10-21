# Design review 02: visual identity and UI craft

Lens: art direction, brand and UI craft. Date: 2026-10-21. Mockups (self-contained, open in a browser): `docs/design/mockups/02-direction-{a,b,c}.html`. Each shows Home, the event sheet (Feeding, bottle) and a Timeline row group in dark and light, plus a night-feed Home. The header of each file lists every swatch with its computed contrast. All artwork is original inline SVG/CSS. Contrast is WCAG 2.x, computed with a script.

## 1. Where the current look falls short

- **No single icon voice.** `iconRegistry.ts` uses filled Material icons and the nav uses Rounded ones. Icons are drawn bare, in raw server colours (`safeColor(type.color)`), never in the category tokens.
- **MUI defaults leak through.** Outlined cards, a square red `error` Stop button, green `success` "Running" chips, blue `info` alerts: none of these belong to the palette.
- **Indigo night sky is the category default, not an identity.** It is calm but not ownable.
- **No hierarchy, no illustration.** Everything is 14px system text, the hero is 28px, and empty and loading states are a line of text or `null`.

## 2. Rules shared by every direction

- **Contrast floor:** text and muted text at least 4.5:1 on bg, surface and raised; icons on tints at least 4.5:1; rings and focus at least 3:1. All three directions pass.
- **Night feed mode** is a third scheme for 22:00-06:00, one hand and adapted eyes:
  - Near-black background with one warm ink. Blue channel at or below `0x78`; text luminance about 45% of normal dark text (B: 0.38 vs 0.83).
  - Categories collapse to one tone, so meaning moves to icon shape and label.
  - No gradients, grain, shadows or glow; motion is opacity only.
  - Large timer (60-72px), four big actions (Bottle, Nursing, Diaper, Fell asleep).
  - A lamp toggle in the header. It is offered automatically when the app opens in the dark scheme between 21:00 and 06:00 and turns off at the first daytime open.
  - A web app cannot dim the screen, so show a one-time "lower your brightness" hint.
- **Licensing:** the icon sets are MIT, ISC or Apache-2.0 and the fonts are SIL OFL 1.1, all shippable in AGPL-3.0. Keep the licence texts in `THIRD_PARTY_NOTICES`; Apache-2.0 also needs its NOTICE kept.

## 3. Direction A: Dusk

**Idea:** the quiet hour after sunset. A blue-violet sky warmed by a low apricot horizon, round like the moon, and the next thing to do glows softly. It evolves the current look and is the low-risk option.

| Role | Dark "Dusk" (default) | Light "Dawn" | Night feed "Moonset" |
|---|---|---|---|
| background | `#11132b` | `#f4f3fb` | `#0b0607` |
| surface / raised | `#1a1d3b` / `#242850` | `#ffffff` / `#ecebf8` | `#150c0b` / `#1f110e` |
| hairline | `#30345f` | `#dfddef` | `#2b1813` |
| text | `#eef0ff` (14.5 surface, 12.4 raised) | `#191a33` (17.0 / 14.4) | `#e39b72` (8.4 / 8.0) |
| text muted | `#a6aad3` (7.3 / 6.2) | `#5a5c7d` (6.4 / 5.5) | `#b06f52` (4.8 / 4.6) |
| accent (primary action) | `#ffb38a` (9.4), on `#2b160b` (9.9) | `#b54a22` (5.3), on `#ffffff` (5.3) | `#e8875a` (7.4), on `#1a0a05` (7.4) |
| selection | `#b4adff` (8.1), on `#16153a` (8.6) | `#4c43c4` (7.2), on `#ffffff` (7.2) | `#c9764f` (5.7) |

- **Type:** system UI stack only, so no font cost. Weights 600-650, tabular numerals. Sizes: hero 34, title 20, section 15, body 15, caption 12-13.
- **Icons:** Material Symbols Rounded (Apache-2.0), outlined at weight 400. The selected state uses the filled variant (the FILL axis).
  - Sizes: 24px in 44px circles, 20px in 40px, 16px in 28px.
  - Use per-icon SVG imports wrapped in `SvgIcon`, never the variable icon font (several MB).
  - `@mui/icons-material` Rounded is the zero-dependency fallback, with fewer baby glyphs.
- **Shape and motion:** 28px hero and sheet, 20px cards, pill chips and a floating nav bar.
  - Dark uses tone layers plus a 5% top highlight; light uses soft indigo shadows.
  - The dusk gradient (lavender to apricot) appears only on the prediction ring and the avatar ring.
  - 200ms ease-out; the ring fills once; a running pill breathes in opacity.
- **Illustration:** moon phases, star dots and horizon arcs, at most 3 shapes per scene.
- **Warmth and trust:** the apricot glow always marks the primary action, and the rest stays restrained.
- **Day/night:** Dusk by default, Dawn by system setting, Moonset for night feeds.
- **Risk:** it stays close to the category's generic night-sky look.

## 4. Direction B: Linen & Ink

**Idea:** a calm notebook on the nightstand. Warm paper, quiet ink and one terracotta pencil; each day reads like a page you are glad you kept. It starts from the light scheme, but its dark side is warm ink, not blue night, so it is gentler at 3 a.m. by construction. Palette and contrast are in section 8.

- **Type:** a serif for what matters (baby name, hero value, amounts, times, day titles) and system sans for the rest.
  - Ship **Fraunces** (SIL OFL 1.1; settings SOFT 50, WONK 0) or **Newsreader** (OFL): two weights, Latin subset (covers pt-BR), self-hosted via `@fontsource`, about 50-70 KB (estimate).
  - Fallback: Iowan Old Style, Palatino, Georgia. Android lacks a good serif, which is why it should be bundled.
  - Timers need tabular lining figures; fall back to sans if the face lacks `tnum`.
  - Labels: 12px uppercase, +0.1em tracking.
- **Icons:** Tabler Icons (MIT, `@tabler/icons-react`, 5,000+ icons) at a 1.5px stroke, like pen drawings.
  - They sit in 12px-radius "stamps" (44/40/36/28px), not circles.
  - About 0.5 KB per tree-shaken icon (estimate).
  - Missing glyphs (diaper, tummy time) are drawn in-house on the same grid. Lucide (ISC) is the backup.
- **Shape and motion:** 20px cards with a 1px paper edge in light and tone steps in dark. Timeline rows are separated by hairlines (journal, not cards), and section labels end in a rule.
  - Selection is solid ink and inverts in dark; paper grain is 5-7%.
  - 180ms standard easing, fade plus an 8px rise, no bounce.
- **Signature, the day ruler:** the awake window is an ink line, the predicted nap window a soft band, and "now" a terracotta mark. It is calmer than a ring and unlike any competitor's dial.
- **Illustration:** cut-paper sun, hills, leaf and cloud in category tints, at most 3 shapes.
- **Warmth and trust:** paper, terracotta and a human serif bring warmth. Editorial clarity, gentle comparisons ("+20 min vs avg") and no alarm colours build trust.
- **Day/night:** Linen by day and Ink in the dark scheme, so "dark unless the OS says light" still holds. Lamplight for night feeds.

## 5. Direction C: Nursery Blocks

**Idea:** soft toy blocks and a small companion. Bold colour and chunky rounded shapes make logging feel like play, with ink text on bright blocks for legibility.

| Role | Light "Playroom" | Dark "Nursery night" | Night feed "Nightlight" |
|---|---|---|---|
| background | `#fff7ee` | `#1b1733` | `#0c0606` |
| surface / raised | `#ffffff` / `#fff0df` | `#262043` / `#312a55` | `#170b0a` / `#22100d` |
| hairline | `#f2e3cf` | `#3d3566` | `#311810` |
| text | `#26203d` (15.5 / 13.9) | `#fff7ef` (14.5 / 12.4) | `#eb9f78` (9.0 / 8.5) |
| text muted | `#625a7a` (6.4 / 5.8) | `#bdb4da` (7.8 / 6.7) | `#b26e51` (4.8 / 4.6) |
| accent fill | `#ff7f57`, ink label (6.2) | `#ff8f6b` (6.9), on `#1b1733` (7.7) | `#e47a52` (6.6) |
| accent as text / ring | `#b8401f` (5.5) | `#ff8f6b` (6.9) | `#e47a52` (6.6) |
| selection | `#26203d`, on `#fff7ee` (14.6) | `#fff7ef`, on `#1b1733` (16.3) | `#cf7650` (5.8) |
| hero block | `#a597ff`, ink (6.2) | `#4b3fb5`, cream (7.4) | outline only |

- **Type:** rounded sans at 700-800. Ship **Nunito** (SIL OFL 1.1), two weights, Latin subset, about 40-60 KB (estimate). Fallback: `ui-rounded`.
- **Icons:** Phosphor Icons (MIT), duotone weight: a 2px stroke plus a 28% fill, in ink on solid blocks. React modules carry all six weights (about 1.5-2.5 KB each, estimate), so import the single-weight SVGs from `@phosphor-icons/core` instead.
- **Shape and motion:** 20-28px radii and solid 3-5px "toy block" shadows with no blur; a press moves the block down 2px. 220ms with a slight overshoot, on press only.
- **Companion "Pip"** (placeholder name, check trademarks): a pebble with a two-leaf sprout ("growing every day"), about six SVG primitives.
  - States: asleep, awake, hungry, proud. Used for empty states and milestones.
  - Pip stays out of data screens and never judges the parent.
- **Warmth and trust:** warmth is the highest of the three. Trust depends on ink-on-colour legibility.
- **Day/night:** Playroom by day, Nursery night in the dark scheme. In Nightlight the blocks become outlines and Pip a dim line drawing.
- **Risk:** the most generic "baby app" of the three. Saturated blocks tire the eye at night and get hard to keep elegant as features grow.

## 6. Category colours (tint / icon, contrast of icon on tint)

| Category | A dark | A light | B light | B dark | C light (block, ink `#26203d`) | C dark (block, ink `#1b1733`) |
|---|---|---|---|---|---|---|
| sleep | `#2b2a5e/#c4beff` 7.6 | `#e6e4ff/#3b33a6` 7.7 | `#e2e7f0/#2c4870` 7.5 | `#26303f/#a9c1e3` 7.2 | `#a597ff` 6.2 | `#8e80ef` 5.3 |
| feeding | `#153f3b/#8ae8c6` 8.0 | `#d7f3e9/#0e5a49` 6.9 | `#e1eadb/#375f39` 6.0 | `#263425/#a9cf9f` 7.6 | `#5fd8a8` 8.8 | `#4cc796` 8.2 |
| diaper | `#45361a/#ffd38c` 8.3 | `#fdecc8/#7a5000` 6.1 | `#f2e5c6/#6e4e0e` 6.1 | `#3a3120/#e8c47a` 7.7 | `#ffd24a` 10.7 | `#f2c23c` 10.3 |
| health | `#4a2436/#ffa6bd` 7.2 | `#ffe0e8/#a0234a` 6.0 | `#f4dcd6/#962f28` 5.9 | `#3d2622/#f0a093` 6.8 | `#ff8a80` 6.8 | `#f57e74` 6.7 |
| care | `#163a53/#96d8ff` 7.7 | `#d9eefb/#0c5579` 6.8 | `#d9eae6/#1c5b54` 6.3 | `#1f3533/#8fd0c6` 7.4 | `#6cc7ff` 8.3 | `#58b6ef` 7.7 |
| activity | `#4b2b1e/#ffb796` 7.5 | `#ffe5d8/#9a3f17` 5.6 | `#f6e0cf/#8f3f15` 5.7 | `#3d2a1d/#f0ae7c` 7.1 | `#ffad5c` 8.4 | `#f29c4e` 7.9 |
| nightWaking | `#3d2a58/#dcbaff` 7.5 | `#efe1fb/#6d2c97` 6.9 | `#ece0ef/#6a3478` 6.9 | `#34253a/#d3b0e0` 7.5 | `#f3a6e3` 8.4 | `#e295d3` 7.8 |
| custom | `#282b48/#c9cce8` 8.7 | `#ecedf5/#474a66` 7.4 | `#ebe6dc/#4f483e` 7.3 | `#2d2a25/#cfc6b6` 8.4 | `#d5d8ea` 10.9 | `#b9bdd3` 9.3 |

Night feed uses one pair for all categories: A `#26130e/#df8f63` 7.0, B `#231910/#c98f52` 6.2, C `#2a130d/#e88b61` 6.9.

## 7. Recommendation: B, Linen & Ink

1. **Own identity:** paper, ink, a serif and a day ruler are not the visual language of baby or sleep apps, and nothing resembles a competitor's dial, mascot or palette.
2. **Elegant and refined:** one accent, editorial hierarchy and hairline structure age well as Insights and Growth arrive (charts in ink blue).
3. **Best at night:** the warm Ink dark has almost no blue, and Lamplight is a natural extension of it.
4. **"Better every day":** a daily page with gentle comparisons frames the data as progress, not surveillance.
5. **Cheap:** one OFL font, one MIT icon set, tokens that fit `SchemeTokens`, and no mascot to maintain.

Fallback: A, if the owner wants continuity with today's dark-first look.

## 8. Tokens for B, ready to implement

The new fields extend `SchemeTokens` (`code/web/src/theme/tokens.ts`) and add a `nightFeed` scheme. MUI `cssVariables` emits them as `--mui-palette-*`.

| Token | MUI palette path | Linen (light) | Ink (dark) | Lamplight (night) |
|---|---|---|---|---|
| background | `background.default` | `#f5efe4` | `#1b1814` | `#0d0906` |
| surface | `background.paper` | `#fffcf6` | `#24201b` | `#150f0a` |
| surfaceRaised | `surfaceRaised` | `#eee6d6` | `#2e2a23` | `#1d150d` |
| hairline | `divider`, `hairline` | `#e2d8c5` | `#3b362d` | `#2a1f13` |
| text | `text.primary` | `#2a251f` (14.8 surface, 12.2 raised) | `#f2eadc` (13.6 / 11.9) | `#d49a5e` (7.8 / 7.4) |
| textMuted | `text.secondary` | `#6a6054` (6.0 / 5.0) | `#b5aa99` (7.1 / 6.2) | `#a87a4a` (5.0 / 4.8) |
| accent | `primary.main` | `#a8482a` (5.7) | `#e58f68` (6.5) | `#e0913f` (7.5) |
| onAccent | `primary.contrastText` | `#fffcf6` (5.7) | `#23140c` (7.2) | `#1a0f05` (7.4) |
| selection (new) | `selection` | `#2a251f` | `#f2eadc` | `#c98f52` |
| onSelection (new) | `onSelection` | `#fffcf6` (14.8) | `#1b1814` (14.8) | `#1a0f05` (6.8) |
| ink2 (new: links, charts) | `secondary.main`, `info.main` | `#2c4870` (9.0) | `#9fb6d6` (7.8) | `#c98f52` |
| category.* | `category.*` | section 6, B light | section 6, B dark | `#231910/#c98f52` |
| grainOpacity (new) | CSS var | 0.07 | 0.05 | 0 |
| themeColor | meta, manifest | `#f5efe4` | `#1b1814` | `#0d0906` |

- **Status colours:** `error` = health fg, `warning` = diaper fg, `success` = feeding fg, `info` = ink2. This retires MUI's default blues and greens.
- **Type:** `fontFamilyDisplay` = `"Fraunces", "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif`.
  - Display face (tabular where numeric): `hero` 48/400, `amount` (new) 64/400, `h4` (day title) 32/400, `h5` 22/600.
  - Sans: `subtitle1` 15/600, `body1` 15/400, `body2` 14/400, `caption` 12/400, `overline` 12/650 with +0.1em tracking.
- **Shape:** `RADIUS = { card: 20, tile: 16, stamp: 12, button: 16, input: 14, pill: 999, sheetTop: 24 }`.
- **Elevation:**
  - Light card: `inset 0 0 0 1px hairline, 0 1px 0 rgba(42,37,31,.04), 0 6px 18px rgba(90,60,30,.06)`.
  - Dark: none.
  - FAB: `0 0 0 5px background, 0 6px 16px rgba(90,40,20,.22)`.
- **Motion:** 180/200/280ms, easing `cubic-bezier(.2,0,0,1)`, no overshoot; reduced motion keeps opacity changes only.
- **Icons:** 24px with a 1.5px stroke, inside stamps of 44/40/36px. Active states change colour or weight, never fill.
- **Night feed:** use MUI's custom colour scheme support if it fits. Otherwise set `data-night-feed` on `<html>` and override the variables there.

## 9. Improvements for the current screens (any direction)

1. **One icon family and style.** Map the stored icon keys in `iconRegistry.ts` to the chosen set. Add glyphs for bottle, breast, diaper, nap cloud, wake sun, night-waking eye and tummy time.
2. **Category tokens, not server colours,** in `QuickActions`, `TimelineRow`, `RunningTimers` and `PredictionCard` (they use `safeColor(type.color)` today).
3. **QuickActions:** replace the coloured borders, bare 36px icons and the `opacity .5` running state with a tinted icon container, a status line and a running ring with live time. Don't disable the tile.
4. **RunningTimers:** replace the outlined card and square red "error" Stop with a raised card, start time, tabular live time and a neutral Stop pill.
5. **PredictionCard:** drop the outlined card, the success/info confidence chips and the "Overdue" chip (DESIGN.md bans that wording). Use the hero, a 3-step confidence meter and a Why sheet.
6. **TimelineRow:** replace the plain list row and green "Running" chip with a time column, tinted icon, duration pill and a hollow "not synced" dot.
7. **EventSheet:** use the radius token instead of the hardcoded 16px, a category header instead of "Add event", and labels above inputs (DESIGN.md section 10).
8. **TrackSheet** is still a placeholder; build it first in the new style.
9. **BottomNav:** add an active indicator and a distinctive FAB, and replace the bar-chart Growth icon with a sprout.
10. **Theme:** body text is 14px (DESIGN.md says 15) and `body` disables tabular numerals. Add display and amount variants, and define `error`, `warning`, `success` and `info` from tokens.
11. **States:** show skeletons where `BabyHome` returns `null` today. Use quiet token banners instead of MUI `Alert` for the viewer notice and errors.
12. **Empty states:** composed SVG scenes with one sentence and one action, for no baby, no types, an empty day and no predictions yet.
13. **Copy layout:** split the hero into lead, value and caption from one i18n key (`Trans` slots). Allow two-line tile labels for pt-BR ("Despertar noturno").
14. **Avatar:** take the baby's colour from the category tints, not a free hue.
15. **Night feed:** add the scheme and lamp toggle; optionally hold a Wake Lock while a timer runs.

## 10. Open questions for the owner

- Keep "follow the system, dark when unset", or switch B between Linen and Ink by local time?
- Is a self-hosted serif (about 50-70 KB) acceptable in the offline bundle?
- Should night feed turn on automatically, or only be offered?
