# Lotties Keycloak theme

A **login theme** for [Keycloak](https://www.keycloak.org/) that makes the sign-in, register, reset-password, verify-email, one-time-code and error pages look like the Lotties app. It is optional: the app works with any OpenID Connect provider and with Keycloak's own theme.

- Built with [Keycloakify](https://www.keycloakify.dev/) 11 (React, Vite). Theme name: `lotties`.
- Lean on purpose: plain CSS on CSS variables, no UI kit. Built size (login page, English): see [Bundle size](#bundle-size).
- Look: the "Linen and Ink" design tokens of the app (`code/web/src/theme/tokens.ts`), the Fraunces serif for the wordmark and titles, the app's own nap and bottle illustrations as hero art, filled 48 px inputs with the label above, a terracotta pill primary button, ink secondary buttons, status colours from the tokens, 2 px focus rings.
- Light and dark follow `prefers-color-scheme` (dark when the browser has no preference, like the app). `prefers-reduced-motion` is respected. Works from 320 px to desktop.
- Languages: English and Brazilian Portuguese (`pt-BR`), plus everything Keycloakify ships for the stock pages. Theme specific strings are in `src/login/i18n.ts`.
- Pages: every page of the login theme. The stock Keycloakify pages are rendered through our `Template.tsx` and a class map (`src/login/classes.ts`), so login, register, reset password, update password, verify email, page expired, error, info, logout confirm, select authenticator, OTP (login and setup), terms, username/password steps, update profile, recovery codes and the rest all share one look without a copy of each page.

## Install on your Keycloak

1. Get the jar (see [Build](#build-the-jar)): `dist_keycloak/keycloak-theme-for-kc-all-other-versions.jar`, or the artifact of the *Keycloak theme* GitHub workflow.
2. Copy it to Keycloak's `providers/` directory.
   - Container (Podman or Docker Compose):

     ```yaml
     services:
       keycloak:
         image: quay.io/keycloak/keycloak:26.8
         command: start
         volumes:
           - ./lotties-theme.jar:/opt/keycloak/providers/lotties-theme.jar:ro
     ```

   - Package install: `cp keycloak-theme-for-kc-all-other-versions.jar /opt/keycloak/providers/`.
3. Optimized (production) mode needs a rebuild of Keycloak's augmented image once: `bin/kc.sh build` (container: `FROM quay.io/keycloak/keycloak:26.8`, `COPY` the jar to `/opt/keycloak/providers/`, `RUN /opt/keycloak/bin/kc.sh build`). `start-dev` and a normal `start` after a restart pick the jar up without a separate build step.
4. In the admin console: **Realm settings > Themes > Login theme = `lotties`**, Save.
5. For the language switcher: **Realm settings > Localization**, turn *Internationalization* on and add *English* and *Portuguese (Brazil)* (`pt-BR`). The switcher is only shown when more than one language is enabled; the default language is the realm default or the browser language.
6. Optional: replace the placeholder terms text (message key `termsText`) under Localization if you use the *Terms and conditions* required action.

The theme changes no authentication flow, client or realm setting.

### Keycloak version targets

Keycloakify builds a jar per range of Keycloak versions because the theme resource layout changed in Keycloak 23/24/26. In Keycloakify 11 the two ranges are:

| Target | Keycloak | Jar |
| --- | --- | --- |
| `22-to-25` | 22, 23, 24, 25 | `keycloak-theme-for-kc-22-to-25.jar` |
| `all-other-versions` | 26 and newer (and anything not listed above) | `keycloak-theme-for-kc-all-other-versions.jar` |

`vite.config.ts` builds only `all-other-versions` by default (tested on Keycloak **26.8.1**). `KC_TARGETS=all npm run build-keycloak-theme` leaves the option out so Keycloakify builds every range it supports. Docs: <https://docs.keycloakify.dev/targeting-specific-keycloak-versions>. Only 26.8.1 was verified against a real server for this theme.

## Kubernetes / Helm (directory mode, no jar, no Keycloak rebuild)

For a Keycloak you cannot rebuild (for example the Bitnami chart with a read-only root filesystem) install the theme as a plain directory through an init container. Scripts, Helm values and the tested procedure are in [`deploy/`](deploy/) and `docs/DEPLOY.md` ("Installing the Keycloak theme on Kubernetes (Bitnami chart)"): `deploy/package-theme.sh`, `deploy/build-image.sh`, `deploy/values-theme-oci.yaml`, `deploy/values-theme-url.yaml`, `deploy/values-theme-multi-oci.yaml`, `deploy/configure-realm.sh`.

## Build the jar

The jar is a Maven artifact, so building needs a JDK and Maven (`npm run build-keycloak-theme` calls `mvn`). Without them on your machine:

```bash
# from code/keycloak-theme/ (Linux, macOS, WSL; set CONTAINER_CLI=docker to use Docker)
bash build-in-podman.sh
# Windows PowerShell (runs the script inside WSL, where podman lives)
powershell -File build-in-podman.ps1
```

`Containerfile` is `node:22` + `maven` + a headless JDK; the script builds the image, runs `npm ci` and `npm run build-keycloak-theme` in it and copies the jar into `dist_keycloak/` (gitignored). Add `KC_TARGETS=all` (or `-All` in PowerShell) for every Keycloak range.

With Java 17+ and Maven installed locally: `npm ci && npm run build-keycloak-theme`.

CI: `.github/workflows/keycloak-theme.yml` (manual, and on pushes that touch `code/keycloak-theme/**`) runs the tests, builds the jar with `setup-java` + Maven and uploads it as the `lotties-keycloak-theme` artifact.

### Bundle size

Production build, English login page (what the browser downloads; the other languages are separate lazy chunks that load only when needed):

| Asset | Raw | gzip | brotli |
| --- | --- | --- | --- |
| `index.js` (React 18 + runtime) | 135.4 kB | 43.8 kB | 38.4 kB |
| `KcPage.js` (Keycloakify core, our Template, English messages) | 107.6 kB | 34.5 kB | 30.0 kB |
| `Login.js` (the page chunk) | 8.0 kB | 2.5 kB | 2.2 kB |
| `KcPage.css` (all pages, tokens, art) | 18.0 kB | 5.1 kB | 4.4 kB |
| Fraunces latin (woff2, `font-display: swap`) | 36.6 kB | already compressed | |
| Fraunces latin-ext | 33.6 kB | fetched only if a glyph needs it | |

About 122 kB transferred with gzip for a first login page view (about 90 kB of it JavaScript). Register adds `UserProfileFormFields.js` (27.9 kB, 7.5 kB gzip); Brazilian Portuguese adds its message chunk (20.9 kB, 6.6 kB gzip).

Numbers are from `npm run build` (Vite) plus gzip/brotli of the emitted files. The jar is about 2.3 MB because it carries every Keycloakify language chunk and page chunk, but a login page loads only the parts above.

## Develop

```bash
npm ci
npm run dev          # Vite dev server on http://localhost:5190 with a mocked Keycloak context
```

Open `http://localhost:5190/?pageId=login.ftl` (or `register.ftl`, `login-reset-password.ftl`, `login-update-password.ftl`, `login-verify-email.ftl`, `error.ftl`, `info.ftl`, `logout-confirm.ftl`, `select-authenticator.ftl`, `login-otp.ftl`, `login-config-totp.ftl`, `terms.ftl`, `login-username.ftl`, `login-password.ftl`, `login-update-profile.ftl`, `login-recovery-authn-code-input.ftl`, ...). The mock contexts come from Keycloakify (`src/login/KcContextMock.ts`). The dev harness is the lean alternative to Storybook; if you want stories, `npx keycloakify add-story` and `npm i -D storybook @storybook/react-vite` work as in the Keycloakify docs.

Layout of `src/login/`:

| File | What |
| --- | --- |
| `KcPage.tsx` | Sends every page to Keycloakify's `DefaultPage` with our Template and class map. To customise one page's markup, `npx keycloakify eject-page` and add a `switch (kcContext.pageId)` here. |
| `Template.tsx` | Page frame: hero (wordmark, tagline, art), card, language switcher (pills, or a menu when more than three languages), alert with `role`/`aria-live`, attempted-username chip, skip link. |
| `classes.ts` | Maps every Keycloakify class key to a `br-*` class. |
| `styles/theme.css`, `fonts.css` | The whole stylesheet. |
| `styles/tokens.generated.css` | Design tokens as CSS variables. Generated, do not edit. |
| `art/HeroArt.tsx` | Nap and bottle illustrations (SVG) coloured by CSS variables. |
| `i18n.ts` | Theme messages (en, pt-BR) and tone-of-voice overrides of a few Keycloak messages. |

Notes on accessibility: labels sit above their inputs, errors are `aria-live`, the page has a skip link and a `main` landmark, the stock positive `tabindex` values are removed at runtime so the tab order follows the page, the password toggle is a labelled button, and contrast is checked by a test (below).

### Token sync

The tokens live in `code/web/src/theme/tokens.ts` (single source of truth). This theme mirrors them, plus the illustration tones that `code/web/src/ui/illustrations/palette.ts` derives from them, into `src/login/styles/tokens.generated.css`:

```bash
npm run sync-tokens    # tsx scripts/sync-tokens.ts
```

The generated file is committed, so the theme builds without the `code/web/` folder (for example in the container). Which token feeds which variable:

| CSS variable | Token |
| --- | --- |
| `--br-bg`, `--br-surface`, `--br-raised`, `--br-hairline` | `background`, `surface`, `surfaceRaised`, `hairline` |
| `--br-text`, `--br-muted` | `text`, `textMuted` |
| `--br-accent`, `--br-on-accent` | `accent`, `onAccent` (primary button, focus ring) |
| `--br-selection`, `--br-on-selection` | `selection`, `onSelection` (ink buttons, selected language) |
| `--br-ink2` | `ink2` (links) |
| `--br-success`, `--br-warning`, `--br-error`, `--br-info` and `-bg` | status colour, with the tint of its category (feeding, diaper, health, sleep) |
| `--br-radius-*` | `RADIUS` |
| `--il-*` | illustration tones (`cloud`, `moon`, `glass`, `teat`, `milk`) |

The dark scheme ("Ink") is `:root`; the light scheme ("Linen") overrides it under `@media (prefers-color-scheme: light)`. The night-feed scheme is not used on a login page.

### Tests

```bash
npm test
```

Vitest: (1) the committed CSS equals what `sync-tokens` generates from `code/web/` and the key colours match `tokens.ts` (skipped when `code/web/` is absent, so the container build is unaffected); (2) WCAG contrast of the pairs the theme draws (text on page, card and filled input, muted text, links, button labels, status alerts: 4.5:1; focus ring and invalid ring: 3:1), computed in light and dark; (3) `theme.css` uses no undefined variable.

## Try it on a real Keycloak (local, throwaway)

`dev/` holds a throwaway setup with Podman in WSL (adapt `podman` calls for Docker): it never touches any real server.

```bash
bash build-in-podman.sh          # the jar
bash dev/kc-up.sh                # br-kc-test (Keycloak 26.8.1, --network host, port 8085) + br-kc-smtp (mail sink, 2525)
node dev/flows/run-flows.mjs     # Playwright: every page, light/dark, en/pt-BR, 390x844 and 1280x800
bash dev/kc-down.sh              # removes only br-kc-test and br-kc-smtp
```

- `dev/realm-lotties-dev.json` is imported at start: realm `lotties-dev`, login theme `lotties`, en + pt-BR, registration, reset password, verify email, a public PKCE client `baby-routine-web` for `http://localhost:5190/*`. It contains no secrets and no users.
- `kc-up.sh` generates the admin and test-user passwords at run time into `dev/.runtime/secrets.env` (gitignored, never printed). The flows script creates its own users through the admin API and deletes them afterwards.
- Screenshots go to `docs/design/screenshots/keycloak-<page>-<locale>-<scheme>-<width>.png` (gitignored). `node dev/preview-mocks.mjs select-authenticator.ftl,...` captures the pages that the default realm cannot reach (select authenticator, recovery code input, username/password steps) from the dev server mocks.
- Not part of CI.

## Licence and notices

- Lotties and this theme: **AGPL-3.0-or-later** (repository `LICENSE`). The hero illustrations (`src/login/art/`) are original works of the Lotties contributors, see `docs/design/ILLUSTRATIONS.md`.
- `src/login/Template.tsx` is derived from the default login `Template.tsx` of [Keycloakify](https://github.com/keycloakify/keycloakify) (MIT, Copyright (c) Keycloakify contributors, Joseph Garrone); the stock pages we render come from the `keycloakify` package (MIT).
- Fraunces (Undercase Type) is distributed through `@fontsource-variable/fraunces` under the SIL Open Font License 1.1.
- Reference studied while designing the project structure: `keycloakify-andradev-theme` (MIT, based on the Keycloakify starter by garronej, `Copyright (c) 2024 Joseph Garrone`). No file of it was copied; if you copy one, keep its licence notice here:

  > MIT License. Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions: The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software. THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND.
