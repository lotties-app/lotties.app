# Mobile release (Android and iOS builds from CI)

How the Capacitor apps in `code/mobile` are built, signed and sent to Google Play (internal testing) and TestFlight
without a local Android SDK or a Mac. Design of the apps: docs/design/12-mobile-capacitor.md. Store forms and policy
drafts: docs/design/20-store-readiness.md. The workflow is `.github/workflows/mobile-release.yml`.

**Status: written, never run.** It was validated only as YAML (the parser caught one real error) and by reading it
against the Gradle and Xcode projects. Expect a few fixes on the first runs, which are cheap (a manual run builds in
about 15 minutes on Android and 20 on iOS, and runs only when started).

## 1. GitHub Actions or Azure DevOps

| | GitHub Actions | Azure Pipelines |
| --- | --- | --- |
| Cost for this public repository | Free. Standard hosted runners are free for public repositories, the arm64 macOS runner `macos-26` included (the `-large` and `-xlarge` ones are paid) | Free tier for public projects is generous, but a new organisation must ask Microsoft for the free parallel jobs and approval can take days. Hosted macOS agents exist |
| macOS and Xcode | `macos-26` image carries Xcode 26.0.1 to 26.6 side by side (runner-images readme); we pin 26.5 | `macOS-26`/`macOS-15` images with several Xcode versions, switched with `xcode-select`; image lag is similar |
| Where it lives | Next to the code and the pull requests, secrets in the repository settings, no second system | A second system (organisation, project, service connections, variable groups) |
| Android | `ubuntu-latest`, Temurin JDK 21, Gradle cache action | Same |
| Store upload | Play: `r0adkll/upload-google-play` (pinned by commit); TestFlight: Xcode itself uploads (`exportOptions destination=upload`), no extra tool | Microsoft's own Google Play and App Store tasks exist; they need extensions or service connections |
| Fit with the project | CI and E2E workflows are already there | Nothing yet |

**Recommendation: GitHub Actions.** Same place as the code, free for a public repository, no extra account, and the
macOS image has what is needed. Azure DevOps only pays off if the owner already runs everything there.

## 2. What the workflow does

Triggers: **manual** (Actions > Mobile release > Run workflow) or a **tag `mobile-v*`**. Never on push or pull request.

1. `version`: `mobile-v1.2.3` gives `1.2.3`; a manual run uses the `version` input, else `code/mobile/package.json`
   (`0.1.0`). The **build number** is the workflow run number (monotonic: Play needs a higher `versionCode` on every
   upload, App Store Connect a new build number per version). Android reads them as `LOTTIES_VERSION_NAME` and
   `LOTTIES_VERSION_CODE` (app/build.gradle); iOS passes `MARKETING_VERSION` and `CURRENT_PROJECT_VERSION` to
   `xcodebuild`. The same version reaches the web bundle as `APP_VERSION` (job env, read by `build:web`,
   `code/mobile/scripts/build-web.mjs`), so Hub > About shows `v1.2.3` instead of `dev`. Nothing to hand-edit.
2. `android` (ubuntu): Node 22, JDK 21, `npm ci` in `code/web` and `code/mobile`, `build:web` (Vite mode `native`, with
   the repository variable `LOTTIES_OIDC_CLIENT_ID`), `cap sync android`, the upload keystore decoded from a secret,
   `./gradlew bundleRelease assembleRelease` (signed AAB for Play, signed APK for direct download), artifacts kept 30
   days, optional upload to the Play **internal** track. The keystore file is deleted at the end.
3. `ios` (`macos-26`): Xcode 26.5, `npm ci`, `build:web`, `cap sync ios`, `xcodebuild archive`, `xcodebuild
   -exportArchive` for the `app-store-connect` method. **Signing is automatic and cloud-managed**: Xcode talks to
   Apple with the App Store Connect API key (`-allowProvisioningUpdates` plus the key flags) and creates or reuses the
   distribution certificate and the provisioning profile. With `destination=upload` the same export step sends the
   build to TestFlight; otherwise the `.ipa` is kept as an artifact (an App Store `.ipa` cannot be installed by hand; it
   is for inspection).
4. `github-release` (tags only): attaches the APK to a pre-release of the tag, for people who install outside the
   store. Only this job has `contents: write`.

Hardening: `permissions: contents: read` by default; third-party actions pinned by commit SHA (with the tag in a
comment); `persist-credentials: false`; secrets only in the `env` of the step that needs them, never echoed; a
concurrency group per ref that never cancels a release half way; secrets are not available to pull requests from forks
(the workflow does not run on pull requests anyway).

Why not fastlane (it is installed on the runner): `xcodebuild` alone signs, exports and uploads, so there is no Gemfile,
no `match` repository and no second place holding certificates. Switch to `match` only if several people or machines
ever need the same certificates.

Why not a p12 and a hand-made profile: both expire yearly, need a Mac or an openssl dance to create, and sit in the
secrets store. Cloud signing needs three secrets and renews itself. The fallback is in section 6.

## 3. Secrets and variables (names; the owner creates them)

Settings > Secrets and variables > Actions. Nothing here is ever committed, printed or put in `.env`.

| Name | Kind | What and how | Who |
| --- | --- | --- | --- |
| `LOTTIES_OIDC_CLIENT_ID` | Variable (public) | the public client id of the realm `lotties.app` (the same as the web build's `VITE_OIDC_CLIENT_ID`) | owner |
| `ANDROID_KEYSTORE_BASE64` | Secret | the **upload keystore**, base64 on one line: `keytool -genkeypair -v -keystore upload.keystore -alias upload -keyalg RSA -keysize 4096 -validity 10000` then `base64 -w0 upload.keystore` (Git Bash). Keep the original file and passwords in a password manager: if lost, Google can reset the upload key, but it takes days | owner |
| `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD` | Secrets | the passwords and alias chosen above (`upload` if you copied the command) | owner |
| `PLAY_SERVICE_ACCOUNT_JSON` | Secret | the whole JSON key of a Google Cloud service account that Play Console lets publish: Play Console > Setup > API access (or Users and permissions > Invite, using the service account e-mail) with release permissions for this app only. Needed only for the optional Play upload | owner |
| `ASC_KEY_ID`, `ASC_ISSUER_ID` | Secrets | App Store Connect > Users and Access > Integrations > App Store Connect API > Team Keys > Generate. Access **Admin** (cloud signing creates certificates; App Manager is not enough). The key id and the Issuer ID are shown on that page | owner |
| `ASC_KEY_P8` | Secret | the contents of the downloaded `AuthKey_<id>.p8` (the whole text, including the BEGIN and END lines). Apple lets you download it **once** | owner |
| `APPLE_TEAM_ID` | Secret | the 10-character Team ID: developer.apple.com > Account > Membership details | owner |

Optional hardening: create a GitHub **Environment** (`mobile-release`) with a required reviewer, move the secrets
there and add `environment: mobile-release` to the `android` and `ios` jobs, so a store upload needs a second click.

## 4. First-time setup

### 4.1 Google Play (Android)

Google requires the **first** AAB of an app to be uploaded by hand in the console; after that the API can publish.

1. Play Console > Create app: name Lotties, default language, App (not game), Free, declarations. Package name will be
   `app.lotties.app` (fixed by the first AAB).
2. Run the workflow by hand (android only, no upload) and download the artifact `android-X.Y.Z-N` (the AAB and the
   APK).
3. Testing > Internal testing > Create new release > accept **Play App Signing** (Google keeps the app signing key;
   the keystore from section 3 is only the upload key) > upload the AAB > save and roll out to internal testing.
4. Fill the mandatory forms so the track is allowed to roll out: App content (privacy policy URL
   `https://lotties.app/privacy`, published; set the owner's values first, docs/PRIVACY-OWNER-CHECKLIST.md; ads: none, app access
   with the demo login, target audience adults, Data safety, health apps declaration, government/news/financial: no),
   store listing (short and full description, icon 512, feature graphic 1024x500, at least two phone screenshots; put
   the credits URL https://lotties.app/credits in the full description next to the privacy policy URL, and the same
   in the App Store description or support text: it names the open-source software and data behind the app,
   docs/design/25-credits.md).
   Answers and drafts: docs/design/20-store-readiness.md sections 3 to 8.
5. Add testers (an e-mail list) and open the opt-in link on a device.
6. Only then set `PLAY_SERVICE_ACCOUNT_JSON` and use the `upload_play` input or a tag. The service account needs the
   app's release permissions; the API can only upload to a track that exists.
7. **Closed testing rule.** A **personal** developer account created after November 2023 cannot publish to
   production until a **closed test** has run with at least **12 testers opted in for 14 days in a row**. An
   organisation account (with a D-U-N-S number) is exempt. Plan it: invite 12 people (family and friends need a Google
   account each), keep them opted in 14 days, then apply for production access in the console. Internal testing is
   not counted. Confirm the current rule in the console before counting on the date.

### 4.2 App Store Connect (iOS)

1. developer.apple.com > Certificates, Identifiers & Profiles > Identifiers > **+** > App IDs > App: description
   Lotties, **Bundle ID (explicit) `app.lotties.app`**. Capabilities: none now. When native push is built
   (docs/design/19-native-push.md) add Push Notifications here.
2. appstoreconnect.apple.com > Apps > **+** New App: platform iOS, name Lotties (must be unique store-wide; have a
   fallback), primary language, bundle ID `app.lotties.app`, SKU `lotties-ios`, full access.
3. App Information: category (Health & Fitness or Lifestyle, see doc 20 section 7), content rights, age rating
   questionnaire, privacy policy URL `https://lotties.app/privacy`; App Privacy answers (doc 20 section 3, checked
   against docs/design/33-privacy-audit.md); Pricing: free.
4. TestFlight: the first build arrives from the workflow (below). Apple processes it for about 10 to 30 minutes and
   may ask for export compliance (the Info.plist already declares `ITSAppUsesNonExemptEncryption=false`).
   Internal testers (up to 100 App Store Connect users) get the build at once with no review; external testers need
   a short Beta App Review for the first build of each version.
5. Create the API key (section 3) and set the four secrets. Run the workflow (ios only, `upload_testflight`).

**Without a Mac** (the intended path): everything above is web consoles plus the workflow; Xcode on the runner creates
the signing assets. **With the MacBook**, the same workflow works; the Mac is useful once to check things Windows
cannot: open `code/mobile/ios/App/App.xcodeproj`, choose the team under Signing & Capabilities, run on a simulator or
an iPhone, and read the Xcode logs when the CI archive fails. It is not needed to create certificates.

## 5. Day to day

- Release: tag `git tag mobile-v0.2.0 && git push origin mobile-v0.2.0` (or run the workflow by hand with the inputs).
  A tag builds both apps, uploads to Play internal and TestFlight, and attaches the APK to a GitHub pre-release.
- Builds numbered by run: do not rerun an old run to "retry" an upload; start a new run (the number must increase).
- Install: Android testers follow the Play opt-in link (or sideload the APK; an APK signed with the upload key cannot
  update a Play-installed copy and the reverse, pick one channel per device). iPhone testers install TestFlight and
  accept the invitation.
- The apps are bundled web builds: every web change that should reach the apps needs a new mobile build.
- Server side before testers sign in: Keycloak redirect URIs and web origins, API `CORS_ALLOWED_ORIGINS`
  (docs/design/12-mobile-capacitor.md sections 4 and 5).

## 6. Maintenance and fallbacks

- **Xcode and runner.** Apple requires App Store uploads to be built with the SDK of the current Xcode generation, and
  raises the minimum every spring. `XCODE_PATH` and `runs-on` at the top of the workflow pin 26.5 on `macos-26`; check
  actions/runner-images before each spring and when the build says the path is missing (the step lists what is there).
- **Android.** JDK 21 and Gradle 8.14 are what the Capacitor 8 project asks for; `compileSdk`/`targetSdk` are in
  `code/mobile/android/variables.gradle`; Google raises the required target every August.
- **Action pins.** Update the SHAs deliberately (Dependabot can do it for `github-actions`).
- **Manual signing fallback** (if cloud signing is refused): create a distribution certificate (with a Mac: Keychain
  Access > Certificate Assistant > request from a CA; without: `openssl req -new -newkey rsa:2048 -nodes -keyout
  dist.key -out dist.csr`), upload the CSR in the developer portal, download the `.cer`, make the p12 (`openssl pkcs12
  -export -inkey dist.key -in dist.pem -out dist.p12`), create an App Store provisioning profile for
  `app.lotties.app`, and store `IOS_DIST_P12_BASE64`, `IOS_DIST_P12_PASSWORD`, `IOS_PROFILE_BASE64`; then the job
  imports them into a temporary keychain and archives with manual signing. Not wired: ask when needed.
- **Never in the repository:** keystores, `.p8`/`.p12`, provisioning profiles, service-account JSON, `google-services.json`,
  `GoogleService-Info.plist` (`code/mobile/.gitignore` refuses them).

## 7. What is unverified

- The whole workflow (never run); `scheme App` is built from Xcode's auto-created scheme because the template has no
  shared scheme; the Capacitor Java level (JDK 21 assumed); that the Apple API key flags work for archive and export on
  `macos-26` with Xcode 26.5; the TestFlight upload through `destination=upload`.
- A first iOS run may fail on signing; the log names the missing piece (App ID, team id, key role).
