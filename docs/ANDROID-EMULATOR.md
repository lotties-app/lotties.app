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

## 2. Run it on an emulator (Windows, no Android Studio needed)

Tried and working (2026-11-01, Windows 11, WHPX active; the APK opened on the sign-in screen). Only the command-line tools
are needed: a JDK 21 (Temurin zip), then in Git Bash:

```bash
# Command-line tools (zip from developer.android.com/studio#command-line-tools-only) unzipped to E:\Android\Sdk\cmdline-tools\latest
sdkmanager --sdk_root=E:\Android\Sdk --licenses
sdkmanager --sdk_root=E:\Android\Sdk "platform-tools" "emulator" "system-images;android-34;google_apis;x86_64"
export ANDROID_AVD_HOME=E:\Androidvd
avdmanager create avd -n lotties -k "system-images;android-34;google_apis;x86_64" -d pixel_7
emulator -accel-check          # must say WHPX is installed and usable (Windows feature "Windows Hypervisor Platform")
emulator -avd lotties          # starts it (a window opens)
adb install -r android-apk/app-debug.apk
adb shell monkey -p app.lotties.app -c android.intent.category.LAUNCHER 1
```

Pass `--sdk_root` in the same form every time and keep `cmdline-tools` inside that root, or `avdmanager` cannot find the
system image. With Android Studio instead: Device Manager > Create device, same image, then `adb install -r`. A physical
phone works the same way with USB debugging on. Dragging the APK onto the emulator window also installs it.

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

## 4. Emulator in a container (does not work as first written)

The image tag first suggested here, `docker.io/budtmay/docker-android:emulator_14.0`, does not exist ("requested access
to the resource is denied" on pull). An emulator in a container also needs `/dev/kvm` inside WSL2 (nested virtualization),
which this machine has not been checked for. Use section 2.
