# Showcase media (screenshots and demo video)

The public landing page ("See it in action", `code/web/src/landing/ShowcaseStrip.tsx`) and the GitHub README show phone
screenshots and a short silent demo video. They are generated from the app itself, so they can be refreshed after any
UI change instead of going stale.

## Rules

- **Synthetic data only.** Everything comes from the developer-only `/dev/*` previews (`code/web/src/dev`): a made-up
  baby ("Lia") with made-up events in a throw-away local database. No sign-in, no API, no stored session, no `.env`, so
  no real family, baby or account can end up in a picture. Never replace this with screenshots of a real account.
- **Self-hosted files only.** Images and videos live in `code/web/public/showcase/` and are served by the web app. No
  YouTube or other video host, no tracker, no new data flow (the privacy policy and `legal/dataFlows.ts` are unchanged).
- **Not in the offline cache.** The service worker precaches only js, css, html, svg, png, webmanifest and woff2
  (`code/web/vite.config.ts`); WebP, MP4 and WebM are fetched on demand. Images are `loading="lazy"`; the video has
  `preload="none"`, controls and no autoplay, so reduced-motion settings and data savers are respected.
- **Sizes.** Each WebP is under 250 KB (the build script lowers the quality until it fits; a test fails above 300 KB),
  each video under 3 MB.

## Refresh

Needs Node (the web `node_modules`, which provides `sharp`), Playwright Chromium (`docs/E2E.md`) and, for the video,
`ffmpeg` on the PATH. From the repository root:

```bash
cd tests/e2e
npx playwright test -c showcase/capture.config.ts capture      # screenshots (about 1 minute)
npx playwright test -c showcase/capture.config.ts demo-video   # the tour, English and Portuguese (about 3 minutes)
node showcase/build-media.mjs                                   # WebP, MP4, WebM, posters into code/web/public/showcase
```

The first command starts its own Vite dev server on port 5431 (`SHOWCASE_PORT` changes it; reuse of a running one is
allowed). Narrow a run with `SHOWCASE_ONLY=now,insights SHOWCASE_LOCALES=en SHOWCASE_SCHEMES=light`. Raw captures go to
`tests/e2e/showcase/output/` (gitignored); only `code/web/public/showcase/` is committed. Look at the result before
committing: open the new files, or the landing page at `/welcome` in a dev server.

## What is captured

| File stem | Preview route | Shows |
| --- | --- | --- |
| `now` (light and dark) | `/dev/now?state=awake` | the Now screen: awake time, next nap window, bedtime, quick log |
| `bottle-followup` | `/dev/now?state=bottlesleep` | the follow-up card after she fell asleep during the bottle |
| `log-feed`, `log-sleep`, `log-diaper` | `/dev/sheet?state=bottle|sleep|diaper` | the event sheets |
| `insights` | `/dev/insights?state=rich` | 14 days of charts |
| `vaccines` | `/dev/vaccines?state=timeline` | the vaccine timeline |
| `sharing` | `/dev/roles` | members, roles and the invite form |
| `doctor` | `/dev/doctor-dashboard?state=summary` | the pediatrician's summary of what was shared |

Files are named `<stem>-<light|dark>-<en|pt-BR>.webp`, 780x1688 (a 390x844 phone at 2x). The video is
`demo-<en|pt-BR>.mp4` and `.webm` (390x844, about 50 s) with `demo-<lang>-poster.webp`, and `demo-<lang>-anim.webp` (240 px, 8 fps, about 2 MB), an animated WebP that the README shows inline because GitHub cannot play a repo video in a README (a native player would need an upload through github.com's editor). The tour in
`demo-video.review.ts`: Now, a diaper in one tap, the bottle follow-up answered, Insights, vaccines, sharing, the doctor's
view.

## Keeping it current

Every new or changed screen or feature that a visitor would see updates the media in the same change (rule in
`CLAUDE.md`, checkbox in the pull request template):

1. A screen needs a `/dev/*` preview scenario with synthetic data (add one next to the existing previews if missing).
2. Add it to `SCREENS` in `tests/e2e/showcase/capture.review.ts`, and a step to the tour in `demo-video.review.ts`
   when it is a main flow.
3. Add it to `SHOWCASE_SCREENS` in `code/web/src/landing/features.ts` and its caption and alt text (English and
   Portuguese) under `showcase.screens.<id>` in `locales/landing.{en,pt-BR}.json`; add it to the README table.
4. Regenerate (above). The test in `landing/LandingPage.test.tsx` fails when a file the page points at is missing or
   too big.

After the UI around baby creation, sharing or the doctor view changes (for example the privacy-first onboarding),
regenerate: the scripts need no edits unless a preview route or its labels changed.

## Known limits

- The pictures are light mode (the Now screen also in dark); other screens in dark are not captured.
- The video has no sound and no captions; it is a visual tour.
- The static files are also bundled into the native (Capacitor) builds because they live in `public/`; they are about
  3.5 MB.
