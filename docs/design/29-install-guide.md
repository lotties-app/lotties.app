# Install guide and the way back to the public pages (design, 2026-10-23)

Owner requests: (1) clear instructions to install the PWA on iPhone, Android and a computer, visible before sign-in and inside the app, with an install button that installs automatically wherever the browser allows it; (2) a signed-in person must be able to reach the public pages (home page, /install, /credits) again, and the installed app (no browser chrome) must never be a dead end. Web only; no API change.

## 1. Decisions

- **One shared button, `install/InstallButton.tsx`**, used on the landing section, at the top of `/install` and `/hub/install`, and in Settings > Appearance (it replaces the old `pwa/InstallAppButton` and `useInstallPrompt`, removed). Its states:

  | Situation | Label | Click |
  | --- | --- | --- |
  | The browser fired `beforeinstallprompt` (Chrome, Edge, Samsung Internet; Android and desktop) | Install app | the browser's own install dialog (`prompt()`); `userChoice` accepted: "Installing Lotties. Open it from its new icon."; dismissed: "Not installed. You can install it later from here." (polite live region). The prompt is single-use, so the button then falls back to the steps |
  | iPhone or iPad (any browser) | Add to Home Screen | opens the steps dialog (`aria-haspopup="dialog"`) |
  | Any other browser without a prompt (Firefox, a Chromium browser that has not offered it yet or already used it) | How to install | opens the steps dialog for that browser |
  | Installed (display-mode standalone, `navigator.standalone`, or `appinstalled` fired) or inside the Capacitor shell (`isNativeApp()`) | nothing | |

- **Why iOS cannot be automated.** Safari and every other browser on iOS/iPadOS (all WebKit) implement no `beforeinstallprompt` and no install API: the only way is the person tapping Share, then Add to Home Screen, then Add. So the iOS button says "Add to Home Screen", never "Install", and the dialog says plainly that "Apple does not let a website install itself on iPhone and iPad, so this takes three taps in the browser". We never claim it installs automatically on iPhone.
- **The prompt is captured at start-up.** `beforeinstallprompt` fires once per page load and may fire before any React component mounts, so `pwa/installPrompt.ts` (module-level listener, `preventDefault()` to keep the mini-infobar away, `appinstalled` sets installed) is imported by `main.tsx` before the app renders. `install/useInstallState.ts` reads it with `useSyncExternalStore`.
- **Steps dialog (`InstallGuideSheet.tsx`).** An MUI `Dialog` (focus moves into it and is trapped; Escape and Close dismiss it; returns focus to the button), at the bottom of the screen on phones (near the browser toolbar), centred from 600 px. Contents: the honest iOS line, a drawing of the device with an arrow and the circled button, the numbered steps (`ol`), the "open lotties.app in Safari" tip for non-Safari iOS browsers, and "See the full instructions" (`/install`, not shown on `/install` and `/hub/install` themselves).
- **Where the arrow points** (`guides.ts`, `DeviceHint.tsx`): iPhone Safari: Share in the bottom toolbar (the text adds "on newer iOS versions it may be under the More button (•••)", because recent Safari layouts moved it); iPad Safari: top right, next to the address bar; iOS Chrome/Edge/Firefox: top right; in-app webviews (Instagram, Facebook, WhatsApp, Android WebView `; wv)`): the app's menu at the top right, with "Choose Open in browser" first; Android Chrome: menu (three dots) at the top right; Samsung Internet: menu (three lines) at the bottom right; desktop Chrome/Edge: install icon at the right end of the address bar; Safari on a Mac: File in the menu bar. The drawings are our own simple shapes (no screenshot of a browser, no vendor artwork), colours from theme tokens, `aria-hidden` (the numbered steps carry the meaning).
- **Detection is a hint, never a gate.** `install/installPlatform.ts` (pure, user agent + `maxTouchPoints`; reuses `isIosDevice` and the in-app list of `notifications/pushSupport.ts`) only chooses which section of `/install` comes first and opens, and which steps the dialog shows. `/install` always shows every platform.
- **Honest wording, consistent with design 09.** iOS notifications need iOS/iPadOS 16.4+ and only work in the Home Screen app, never in a tab (same wording as `notifications.json` `iosNeedsInstall`/`iosTooOld`). Safari may delete website data after about a week without visits; Home Screen apps are not subject to that (WebKit's storage policy). We do not say offline works only when installed: the service worker also serves a Safari tab offline. Store apps: one neutral line ("If Lotties apps are offered in your phone's app store, they are an alternative"), no dates.
- **No nagging.** No popup or banner appears by itself; the dismissible mobile banner was optional and is not built.

## 2. Platform matrix

| Platform | Browser | What we show | Notifications |
| --- | --- | --- | --- |
| iPhone (iOS 16.4+) | Safari | Add to Home Screen: Share (bottom toolbar or under •••) > Add to Home Screen > Add | Home Screen app only |
| iPhone | Chrome, Edge, Firefox | same three steps from their Share button (top right or menu); tip: Safari is the most reliable | Home Screen app only |
| iPad (iPadOS 16.4+, also "desktop site" Mac UA with touch) | Safari | Share at the top right > Add to Home Screen > Add | Home Screen app only |
| iOS/Android in-app browsers | Instagram, Facebook, WhatsApp, WebView | open in Safari/Chrome first | none |
| Android | Chrome, Edge (Chromium) | Install app button when the prompt fired; otherwise menu ⋮ > Install app (Add to Home screen) > Install | tab and installed |
| Android | Samsung Internet | menu ≡ > Add page to > Home screen (or the address bar install icon) | tab and installed |
| Android | Firefox | menu ⋮ > Add to Home screen (Install) | tab and installed |
| Windows, Linux, macOS | Chrome, Edge | Install app button when the prompt fired; otherwise the install icon in the address bar (or the menu: Chrome "Cast, save and share", Edge "Apps") | yes |
| macOS (Sonoma+) | Safari | File > Add to Dock > Add | yes |
| Desktop | Firefox, others | "This browser cannot install apps from a website"; use Chrome, Edge or Safari on a Mac | |

User agents of each row are in `install/installTestKit.ts` and the table test `installPlatform.test.ts`.

## 3. Surfaces and routes

| Where | What |
| --- | --- |
| Landing (`/`, signed out; and `/welcome`) | Section "Install on your phone" (`landing/InstallStrip.tsx`, h2, after "How it works"): one sentence naming iPhone and Android, the `InstallButton` and "Step-by-step guide" (`/install`). Installed: "You are already using the installed app." Native shell: no section. Footer link "Install the app" (hidden in the native shell) |
| `/install` (public) | `install/InstallPage.tsx`, lazy chunk declared above `LandingGate`/`RequireAuth` like `/credits`: `PublicTopBar`, h1 "Install Lotties", `InstallContent`. Precached like every chunk; the service worker's navigation fallback serves the app shell for any path (no route list to update), so it opens offline |
| `InstallContent` | intro, `InstallButton`, one accordion per platform (summary inside an h2; detected first and open, the others closed but present; several can be open), each with the drawing and `ol` steps; Android has a nested "Other browsers" accordion (h3, Samsung Internet and Firefox as h4); "Computer" has h3 Chrome and Edge / Safari on a Mac; the store-app line; "Troubleshooting" (h2, h3 per question: Add to Home Screen missing, install missing on Android, how to update (Hub > Check for updates), how to uninstall). Installed: the success line plus update and uninstall only. Native shell: one line "You are using the Lotties app. There is nothing to install." |
| Hub > App > Install the app | entry `install` (`/hub/install`, `HubInstallPage`, same `InstallContent` in the shell with "Back to Hub"); hidden when installed or in the native shell (`HubContext.installed`, `native`) |
| Hub > App > Home page | entry `welcome` (`/welcome`), every role, also native |
| Settings > Appearance | the `InstallButton` (as before with the old button) |
| README | "Install on your phone" with the same steps and https://lotties.app/install |

## 4. Getting back to the public pages

- **`/welcome`** (`landing/WelcomeRoute.tsx`, outside `LandingGate`): a signed-in person sees the landing page with "Back to the app" in the header and one "Open the app" button in the hero instead of Sign in / Create an account (no session notice). A signed-out visitor is redirected to `/`, which already is the landing page. `LandingGate` is unchanged: `/` signed in still opens the app, so deep links and the post-sign-in return are untouched.
- **`PublicTopBar`** (`landing/PublicTopBar.tsx`) on `/credits` and `/install`: Back (router history back when this tab has in-app history, `location.key !== 'default'`; otherwise to `/`), the brand (link to `/`, "Lotties home") and Home (`/`: the app when signed in, the landing page otherwise). Safe-area top padding for the standalone app. It replaces the credits page's own header and "Lotties home" button.
- **In-app pages** reached from the Hub (`/hub/credits`, `/hub/install`, `/hub/about`, ...) keep the existing "Back to Hub" button of `HubSubPage` and the shell navigation.
- **Android back button in the store app** (`platform/backButton.ts`, started by `startNativeShell`): `@capacitor/app` without a listener goes back in the WebView but does nothing on the first page (checked in `AppPlugin.java` of @capacitor/app 8.1.2), which feels stuck. With our `backButton` listener: `canGoBack` > `history.back()`, otherwise `App.exitApp()`. `NativeShell` gained `onBackButton` and `exitApp` (fake shell in `nativeTestKit.ts`).
- **Privacy policy page**: `/privacy` (2026-10-23, docs/design/33-privacy-audit.md) uses the same `PublicTopBar`, with Hub > App > Privacy policy (`/hub/privacy`) and `/doctor/privacy` inside the shells.

## 5. Wording sources (cited, no copied text)

- Apple Support, "Turn a website into an app in Safari on iPhone": https://support.apple.com/guide/iphone/open-as-web-app-iphe4a1b6c71/ios
- Apple Support, Safari on Mac "Add to Dock" (web apps): https://support.apple.com/en-us/104996
- Google Chrome Help, "Use progressive web apps": https://support.google.com/chrome/answer/9658361
- Microsoft Edge, "Install, manage, or uninstall apps in Microsoft Edge": https://support.microsoft.com/topic/0c156575-a94a-45e4-a54f-3a84846f6113
- WebKit blog, 7-day cap on script-writable storage and Home Screen web apps: https://webkit.org/blog/10218/full-third-party-cookie-blocking-and-more/
- WebKit blog, Web Push for Home Screen web apps on iOS/iPadOS 16.4: https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/
- MDN, `beforeinstallprompt`: https://developer.mozilla.org/docs/Web/API/Window/beforeinstallprompt_event

The Apple and Microsoft article ids above were written from memory without network access in this change: open each once and fix the link if it moved (the Chrome, WebKit and MDN links are stable). Menu labels change between browser versions; the steps use the names current in 2026 and add the common alternative ("Install app (Add to Home screen)").

## 6. Accessibility and layout

One h1 per page (the route's), h2 sections, h3/h4 inside; ordered lists for steps; accordion summaries are buttons with `aria-expanded` and `aria-controls`; buttons 44-48 px; the dialog is labelled by its title; status messages in a polite live region. One column at 320-430 px (`overflow-wrap: anywhere`; the bar uses a 3-column grid with a centred brand mark). Colours only from theme tokens (light, dark, night); reduced motion follows the global theme rule (no animation of our own).

## 7. Tests

`install/installPlatform.test.ts` (17-row user-agent table incl. iOS Safari/Chrome/Edge/Firefox, Instagram, iPad desktop mode, Android Chrome/Samsung/Firefox/WebView/Facebook, desktop Chrome/Edge/Firefox, Mac Safari/Chrome; guide views), `InstallButton.test.tsx` (mock `beforeinstallprompt`: suppressed infobar, accepted/dismissed, `appinstalled`; iPhone/iPad/iOS Chrome/in-app/Firefox dialogs, focus inside, Escape and Close; hidden standalone, `navigator.standalone`, native), `InstallRoutes.test.tsx` (public `/install` without sign-in, section order per platform, expanded state, prompt button, installed and native views, pt-BR, Hub entry and `/hub/install` with Back to Hub, Hub > Home page to `/welcome`, `/` still the app when signed in, `/welcome` signed out goes to the landing, PublicTopBar back/home, axe light/dark x en/pt-BR with every section and the dialog open), `landing/LandingPage.test.tsx` (install section, prompt, iPhone dialog, installed, native, `/welcome` variant), `hub/hubModel.test.ts` and `HubScreen.test.tsx` (entries and visibility), `platform/backButton.test.ts` and `nativeShell.test.ts` (history back, exit at the first page).

## 8. Not done

- No once-dismissible landing banner (optional in the brief; the visible section is enough and avoids nagging).
- No screenshots of the real browser UIs (copyright, and they change every release).
- Not verified on real devices in this change: the manual checklist of docs/design/09 section 15 should add "install from /install" on iPhone Safari, Android Chrome and desktop Chrome.
