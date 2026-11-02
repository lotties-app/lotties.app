# Trying the Android app without a phone (debug APK and emulator)

The workflow `.github/workflows/android-compile-check.yml` builds a **debug APK** on every pull request that touches
`code/mobile/android/**` (or by hand) and keeps it for 7 days as the artifact `android-debug-apk`. It is signed with the
debug key, so it is for testing only: it cannot go to Google Play (docs/MOBILE-RELEASE.md builds the real AAB).

The APK is built with the repository variable `LOTTIES_OIDC_CLIENT_ID` when it is set (the same one the release uses), so
sign-in works. Without the variable the client id is `compile-check` and the app opens but cannot sign in.

## 1. Get the APK

```bash
gh run list --workflow android-compile-check.yml --limit 5      # pick a green run (or the PR's run)
gh run download <run-id> -n android-debug-apk -D android-apk    # creates android-apk/app-debug.apk
```

By hand: the run page on GitHub, section Artifacts, `android-debug-apk`.

## 2. Run it on an emulator (Windows)

1. Turn on a hypervisor: Windows features **Windows Hypervisor Platform** (WHPX) or Hyper-V, then reboot.
2. Install Android Studio. Device Manager > Create device > a Pixel with a recent system image (API 34 or 36, "Google
   Play" or "Google APIs" image; Google APIs is enough). Start it.
3. Install the APK (`adb` is in `%LOCALAPPDATA%\Android\Sdk\platform-tools`):

```bash
adb install -r android-apk/app-debug.apk
```

Dragging the APK onto the emulator window also installs it. A physical phone works the same way with USB debugging on.

## 3. What to check

- **Sign-in.** The app opens the system browser for Keycloak and comes back through `app.lotties.app://auth/callback`
  (and `app.lotties.app://auth/logout`). Both must be valid redirect URIs of the Keycloak client the build uses
  (docs/design/12-mobile-capacitor.md, docs/DEPLOY.md). The emulator needs Chrome and internet.
- **Widgets.** Long-press an empty spot of the home screen > **Widgets** > Lotties, drag one to the home screen. Open the
  app once and sign in first: the widget shows "Open Lotties" until the app has written its first snapshot
  (docs/design/37-widgets-siri.md 2.1). Log an event from a widget button, then open the app: it appears (the app drains
  the outbox on launch and resume).
- **Voice shortcuts.** Long-press the app icon for the shortcuts; Settings > Voice assistants in the app connects the
  Android voice client (docs/design/37-widgets-siri.md section 14, owner step in docs/MCP.md 3.5).
- **Offline.** Turn on airplane mode: the app and the widget buttons keep working; voice shortcuts say nothing was logged.

## 4. Optional: an emulator in a container (not tested)

Not tried on this project: the image `docker.io/budtmay/docker-android` runs an Android emulator and serves its screen
through noVNC in the browser. It needs hardware virtualization inside WSL2 (`/dev/kvm`, nested virtualization enabled in
`.wslconfig`) and, on this machine, Podman with `--network host` and only `br-*` container names (CLAUDE.md). Rough
shape, to be adjusted from the image's own README:

```bash
podman run -d --name br-android-emu --network host --device /dev/kvm \
  -e EMULATOR_DEVICE="Samsung Galaxy S10" -e WEB_VNC=true docker.io/budtmay/docker-android:emulator_14.0
# open the noVNC address from the image README, then
podman cp android-apk/app-debug.apk br-android-emu:/tmp/ && podman exec br-android-emu adb install -r /tmp/app-debug.apk
```

Emulators in containers are slow without KVM and often unusable without it; the Android Studio emulator above is the
route that is known to work. Remove the container when done (`podman rm -f br-android-emu`).
