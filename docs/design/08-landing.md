# Public home page replaces /login (decided 2026-10-21)

Owner request: drop the SPA `/login` page (Keycloak's themed page is the sign-in screen) and show a public home page that explains what the app is; users should not have to go to `/login`.

## Behaviour
- `/` when signed out: the public landing page. `/` when signed in (or when a stored session exists, see below): the Now screen. Only the landing is public; everything else is protected.
- `/login` is removed (a redirect to `/` for old bookmarks). The primary 'Sign in' button on the landing starts the OIDC authorization redirect immediately (`login(returnTo)`), straight to Keycloak. A secondary 'Create an account' starts the same redirect with Keycloak's registration entry point (verify what Keycloak 26.0.5 supports: `prompt=create` per OIDC Prompt Create, else `kc_action=register`; otherwise link to the realm's registration URL); both pass `ui_locales` with the app's language so Keycloak opens in the same language.
- Deep links (`/day`, `/invite#...`, `/insights`, `/settings`) while signed out: redirect to Keycloak immediately (no intermediate page), preserving the return path (the invite token handling already survives the round trip); show only a calm full-screen 'Taking you to sign in' placeholder (skeleton, no flash of the landing). Guard against redirect loops: after an OIDC error return (`error` in the callback) show the landing with a clear error card and a retry button.
- Stored session (cold start, offline or expired access token): keep the existing behaviour from the offline-safe session work: the app opens from local data; never sends an offline user to sign in. A forced re-login (refresh definitively failed) shows the landing with a prominent card 'Your session ended. N changes are waiting to sync. Sign in to sync them' (the information the old login page showed); local data is kept.
- `/auth/callback` unchanged.

## Landing content (calm, honest, no marketing fluff; en + pt-BR via i18n; only claim what exists)
Hero: brand mark + 'Lotties'; headline 'Track your baby's day, together'; sub 'Sleep, feeds, diapers and medicines in one calm place. Works offline, shares with your co-parent.'; primary 'Sign in', secondary 'Create an account'; hero art from the illustration set (nap cloud + moon, bottle), a soft glow in light/dark, flat in night.
Sections (cards with illustrations, scroll):
1. Log in two taps: one-tap tiles, timers, undo. 2. Works offline: installs like an app, syncs when the connection is back. 3. Share with your co-parent: invite by link, see who logged what. 4. Gentle predictions: next nap window with a plain explanation; 'Estimates from your logged history, not medical advice'. 5. Bring your history: import from Napper, custom events, medications with safe intervals (the doctor's prescription is the source). 6. Your data, your rules: free and open source (AGPL-3.0), can be self-hosted, no ads, no tracking (verify no analytics exist before claiming).
Footer: language switch (System/English/Português), theme toggle (System/Light/Dark), link to the source repository (config `VITE_REPO_URL`, hidden when unset), licence, 'Not a medical device', install hint (reuse the PWA install button; iOS hint).
Design: direction B tokens, serif display, max width 960, sticky minimal header (brand + Sign in), skip link, headings structure h1/h2, focus rings, 320px to desktop, reduced motion, axe in light/dark/night; fast: lazy-load, no auth library work before the click beyond what is needed to detect a stored session; set `<title>`, meta description, Open Graph/Twitter tags in index.html with /social-preview.png (copy to web/public).

## Acceptance
Unit tests for routing (signed out `/`, deep links redirect, loop guard, stored-session cold start unaffected, `/login` redirect), i18n parity, axe, pt-BR render; screenshots reviewed in light/dark/night, en/pt-BR at 390 and 1280; e2e specs updated in the e2e-repair wave (login-redirect, logout, baby specs).
