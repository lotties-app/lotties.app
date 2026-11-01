# Alexa skill: the owner's setup

How to publish the Lotties Alexa skill (design: [docs/design/32-assistants.md](design/32-assistants.md)). Everything
here is done by the owner in the Amazon developer console, in Keycloak and in the cluster; no secret goes into the
repository. The API side is already in the code and **off** until `Alexa__Enabled=true`.

What you need: an Amazon developer account (the one the skill will be published under), admin access to the Keycloak
realm `lotties.app` (`https://auth.lotties.app`), and the cluster deploy kit (`deploy/homelab`).

## 1. Choose the invocation name

Alexa skills are always called as "Alexa, tell/ask/open *&lt;invocation name&gt;* ...". A bare "Lotties, ..." is not
possible: only Amazon chooses wake words.

- **What the models ship with:** en-US `lotties`, pt-BR `lotes` (the sample phrases stay in each language):
  "Alexa, tell lotties the baby fell asleep", "Alexa, peça ao lotes: o bebê dormiu". The pt-BR name is the Portuguese spelling of the brand
  on purpose: tested on an Echo Dot (2026-10-29), speech recognition in Portuguese never heard `lotties` (it wrote "lotes",
  "lojas", "loris") nor the made-up spellings `lóties`/`lótis`, but "abrir lotes" opened the skill (`lotes` is how Portuguese
  speakers say it, and a word the recogniser knows). The most reliable way to use it is "Alexa, abrir lotes" and then the
  questions without the name; the one-sentence form ("pergunte a lotes ...") is recognised less often. If certification
  rejects a one-word name, say that `lotes` is the phonetic Portuguese spelling of the brand Lotties, or use `lotes baby`. A one-word name that is a brand may
  be rejected at certification without evidence that you own the brand (the site lotties.app, the GitHub organisation
  lotties-app, a trademark registration if any). The pt-BR name used to be `lotties bebê` (and en-US `lotties baby`): an
  owner who already built the skill must re-paste both models (section 3) and **Build** again, and change the
  invocation name in the console.
- **Fallback:** `lotties baby` (two words, no approval needed). If certification rejects `lotties`, switch BOTH models
  to it **before publishing**: the invocation name cannot be changed after the skill is certified and published. It is a
  find/replace: `invocationName` in both `alexa/interaction-model.*.json` (and in the console), the example phrases in this
  guide, and the app's examples (`code/web/src/i18n/locales/*/assistants.json`, key `assistants.intro`).

## 2. Create the skill

1. https://developer.amazon.com/alexa/console/ask, **Create Skill**.
2. Name: `Lotties`. Primary locale: **English (US)**. Experience: *Other*, model **Custom**, hosting **Provision your
   own**. Template: *Start from scratch*.
3. After it is created: **Language settings**, add **Portuguese (BR)**.
4. Copy the **Skill ID** (`amzn1.ask.skill.<uuid>`, at the top of the skill's page or in Endpoint): it goes into
   `Alexa__SkillIds` (section 6).

## 3. Upload the interaction models

For each language (switch with the language dropdown at the top):

1. **Build** > **Interaction Model** > **JSON Editor**.
2. Paste the whole file: `alexa/interaction-model.en-US.json` for English (US), `alexa/interaction-model.pt-BR.json`
   for Portuguese (BR). **Save Model**, then **Build Model**. Fix any warning the console shows (they validate the
   utterances: e.g. a sample that collides with another intent).
3. The models define the intents of the design doc section 1, the custom slot types `BOTTLE_KIND`, `DIAPER_KIND`,
   `BREAST_SIDE`, `VOLUME_UNIT` (the API reads their value ids `FORMULA`, `BREAST_MILK`, `WET`, `DIRTY`, `BOTH`, `LEFT`,
   `RIGHT`, `ML`, `OZ`, and falls back to the spoken words), and dialog delegation that asks for a missing bottle amount or
   diaper kind.
4. **Measurement units (2026-10-25): re-paste both models and press Build again.** `BottleIntent` gained the optional slot
   `volumeUnit` (type `VOLUME_UNIT`: milliliters or ounces) and its sample phrases now take `{amount} {volumeUnit}`
   ("log a 4 ounce bottle", "registrar mamadeira de 4 onças"); the amount prompt is neutral ("How much? For example 120
   milliliters or 4 ounces."). Until the models are rebuilt a spoken unit is not captured and the amount is read in the
   person's unit system. If the console rejects `{volumeUnit}` in the `amount` slot's own samples, delete that one sample
   (`"{amount} {volumeUnit}"`) from the `amount` slot in both files and build again. A person who has not chosen units
   (Settings > Units, `auto`) hears ounces in en-US and milliliters in pt-BR; see docs/design/37-measurement-units.md.

5. **Totals questions (2026-10-25): re-paste both models and press Build again.** Two new intents, `BottleTodayIntent`
   ("how much did she drink today", "quanto ela tomou de mamadeira hoje", "quantas mamadeiras hoje") and
   `FeedsTodayIntent` ("how many feeds today", "quantas mamadas hoje"), answer questions that used to fall into
   `BottleIntent` ("Quanto? Por exemplo 120 mililitros..."); a few `BottleIntent` samples were reworded
   ("ela acabou de tomar mamadeira") so a question cannot match the logging intent. Until the models are rebuilt those
   questions still land in `BottleIntent`.

6. **Echo Show night panel (2026-11-01, design 42): enable the screen interface, re-paste both models and build again.**
   New intent `PanelIntent` ("open the panel", "night mode"; "abrir o painel", "modo noturno"). For the panel to show on an
   Echo Show: **Build** > **Interfaces** (or **Tools** > **Interfaces**) > turn on **Alexa Presentation Language**, keep the
   landscape small-hub viewport (Echo Show 5) ticked, **Save Interfaces**, then rebuild the model. A device without a screen
   gets a short spoken summary instead. The sample APL document the skill sends is kept in `alexa/apl-night-panel.json`
   (the API embeds its own copy; a test keeps the two equal); paste it in the console's APL authoring tool to preview it.
   Say "Alexa, open lotties" and then "open the panel", or "Alexa, ask lotties to open the panel". Not yet verified on a
   device: the checklist is in docs/design/42-echo-show-panel.md section 9.

## 4. Endpoint

**Build** > **Endpoint**:

- Service endpoint type: **HTTPS**.
- Default Region: `https://lotties.app/api/v1/alexa`.
- SSL certificate type: **My development endpoint is a sub-domain of a domain that has a wildcard certificate from a
  trusted certificate authority**. Production reaches the app through Cloudflare, whose Universal certificate lists
  `*.lotties.app` and `lotties.app`; with the plain "certificate from a trusted certificate authority" option Alexa
  answers "I am unable to reach the requested skill" and no request ever reaches the cluster (confirmed 2026-10-25).
  Do not choose the self-signed option.
- Save. The API verifies Amazon's signature on every request (signature, certificate chain from `s3.amazonaws.com/echo.api/`,
  timestamp within 150 seconds, the skill id). The pod must reach `https://s3.amazonaws.com` over HTTPS to download
  Amazon's signing certificate (cached for an hour); if egress is blocked, every request is refused with 400.

## 5. Account linking (Keycloak)

The skill acts as the parent, with her own Lotties account. Alexa gets a Keycloak access token for her through the
authorization code grant and sends it with every request; the API validates it exactly like the web app's tokens
(issuer, audience `lotties-api`, lifetime, signature).

### 5.1 The Keycloak client (realm `lotties.app`)

1. Clients > **Create client**: type OpenID Connect, Client ID `lotties-alexa`. Client authentication **On**
   (confidential), Standard flow **On**, Direct access grants **Off**, Implicit **Off**, Service accounts **Off**.
2. Valid redirect URIs (replace `<vendor>` with your vendor id, shown in the console's account linking page under
   "Alexa Redirect URLs"; add all three, the console lists the exact values):
   - `https://pitangui.amazon.com/api/skill/link/<vendor>`
   - `https://layla.amazon.com/api/skill/link/<vendor>`
   - `https://alexa.amazon.co.jp/api/skill/link/<vendor>`
3. Web origins: none needed (no browser calls from Amazon's pages to Keycloak's APIs).
4. **Audience:** Client scopes > `lotties-alexa-dedicated` > Add mapper > By configuration > **Audience**: Included
   client audience `lotties-api` (or Included custom audience `lotties-api`), Add to access token **On**: exactly as the
   SPA client has it. Without it the API refuses the token and Alexa keeps asking to link.
5. Credentials tab: copy the **client secret**. It goes only into the Alexa console (5.2). Never commit it, never put it
   in a `.env` of this repository: the API does not need it.
6. Tokens (client Advanced settings, or the realm's Tokens tab): the access token lifespan can stay at the realm's value
   (Alexa refreshes on its own: it uses the refresh token whenever the access token expires). Keep refresh tokens long
   enough that parents do not have to re-link often: the realm's SSO Session Idle/Max (or the client's overrides), or
   enable **Offline access** for the client and add the `offline_access` scope in 5.2 for tokens that survive a
   Keycloak session end. A refresh failure makes Alexa ask the parent to link again.

### 5.2 The Alexa console

**Build** > **Account Linking**:

- "Do you allow users to create an account or link to an existing account with you?" **On**.
- "Allow users to enable skill without account linking": **On** (welcome and help work without it; commands answer
  "please link your account").
- Authorization grant type: **Auth Code Grant**.
- Your Web Authorization URI: `https://auth.lotties.app/realms/lotties.app/protocol/openid-connect/auth`
- Access Token URI: `https://auth.lotties.app/realms/lotties.app/protocol/openid-connect/token`
- Your Client ID: `lotties-alexa`
- Your Secret: the client secret from 5.1.5.
- Your Authentication Scheme: **HTTP Basic** (Keycloak accepts it; *Credentials in request body* also works).
- Scope: `openid` (add `offline_access` if you chose offline tokens in 5.1.6).
- Domain List: `auth.lotties.app`.
- Default Access Token Expiration Time: leave empty (Keycloak's `expires_in` is used).
- Save. The page shows the **Alexa Redirect URLs**: check they are the ones in 5.1.2.

## 6. Turn the API on

In the cluster (deploy kit `deploy/homelab`), the API needs two settings; neither is a secret:

| Variable | Value |
| --- | --- |
| `Alexa__Enabled` | `true` |
| `Alexa__SkillIds` | the Skill ID from 2.4 (several: comma-separated, or `Alexa__SkillIds__0`, `__1`, ...) |

Add them to `deploy/homelab/values/api.yaml` under `env:` (`Alexa__Enabled: "true"`, `Alexa__SkillIds:
"amzn1.ask.skill.<uuid>"`) and deploy as usual from the main clone (docs/PROCESS.md "Integrate and deploy"). Optional
tuning is in docs/DEPLOY.md "Alexa skill". The migration `VoiceAssistants` must be applied first (it adds
`user_assistant_settings`). Startup fails when `Alexa__Enabled=true` has no valid skill id.

Check: `curl -i -X POST https://lotties.app/api/v1/alexa -d '{}'` answers **400** when enabled (unsigned), **404** when
disabled.

## 6a. Models of 2026-10-27 (the review of the 21 added intents)

Re-paste both models and **Build** again: the choice slot types (`FUSSY_INTENSITY`, `TEMP_METHOD`, `MILESTONE_TYPE`,
`SYMPTOM_TYPE`, `SYMPTOM_SEVERITY`) now have ids equal to the Lotties field options (the API reads the ids), the symptoms are
the ones the app offers (cough, runny nose, congestion, rash, diarrhea, constipation: no fever, vomiting, lethargy or
dehydration), and the temperature samples without a number are gone. A temperature is always said with its number
("log temperature thirty seven"), in the unit system of Settings > Units. Settings > Voice assistants has two opt-in
switches: the baby's name and the names of your medicines in answers (both off by default).

## 7. Test in the console

**Test** tab, set "Skill testing is enabled in" to **Development**, then type or say, in each language:

1. "open lotties" (pt: "abrir lotes"): the welcome.
2. In the Alexa app (phone, same Amazon account): Skills > Your Skills > Dev > Lotties > **Link account**, sign in with a
   Lotties account. Without linking, a command answers "please link your account" and the app shows the link card.
3. "tell lotties the baby fell asleep", then "tell lotties the baby woke up": a sleep appears in the app.
4. "tell lotties log a bottle", answer "one hundred twenty milliliters" (or "four ounces"): the bottle appears (dialog delegation asks the amount). Without a unit the amount is read in the user's unit system (Settings > Units; `auto` follows the request language: en-US is ounces, pt-BR is ml). Also try "tell lotties log a 4 ounce bottle" and "... a 120 ml bottle".
5. "ask lotties when was the last feed", "... how many diapers today", "... when is the next appointment",
   "... which vaccines are due".
6. With a Viewer account: a command answers that the role does not allow it. With an account of several babies and
   none chosen: it asks to choose one in Settings, Voice assistants.
7. pt-BR: "peça ao lotes para registrar mamadeira de cento e vinte ml de leite materno": answer with a 24-hour time.
8. The questions added later (no slots, answered from the log): "ask lotties what is the next nap window", "... when
   is the next feed", "... when is the next diaper change", "... how many diapers a day does she usually use", "... how
   much should I make for the next bottle", "... how much did she sleep today", "... when was the last diaper change",
   "... why is she crying" (pt: "qual a próxima janela de sono", "quando é a próxima mamada", "quando é a próxima troca de
   fralda", "quantas fraldas por dia ela costuma usar", "quanto devo preparar na próxima mamadeira", "quanto ela dormiu
   hoje", "quando foi a última troca de fralda", "por que ela está chorando"). With little history they say so; the
   crying answer always ends with when to call the pediatrician.
9. "ask lotties to undo the last entry" (pt: "peça ao lotes para desfazer o último registro") right after logging by
   voice: it answers that it asked and that nothing was deleted; the entry shows a banner in the app (Delete or Keep).
   Alexa never deletes by itself.

The JSON Input/Output panes show the request and response; the API logs only the intent, the result code and the
correlation id (`kubectl ... logs deploy/lotties-api | grep Alexa`).

## 8. Certification checklist

- **Privacy policy URL:** `https://lotties.app/privacy` (published; the Alexa part is in "Who sees your data" >
  "Companies and services that receive data", anchor `#privacy-sharing-companies`). It says that Amazon records and
  processes the voice, that Lotties receives only the command and its values, **and** that the answer Lotties sends back
  for Alexa to speak carries no baby name unless the parent turned on "Say my baby's name in answers" (Settings > Voice
  assistants, off by default) and no free text or names of people; it can carry feed and sleep times, diaper counts, the date and time of the next appointment and due
  vaccines (Amazon receives that text), plus that Amazon keeps the account-linking token. Before submitting: the
  owner's values and the legal review in [docs/PRIVACY-OWNER-CHECKLIST.md](PRIVACY-OWNER-CHECKLIST.md). Terms of use
  URL: optional.
- **Distribution** > Skill preview, per language: name `Lotties`, one-sentence and full description, three example
  phrases (they must work exactly: e.g. "Alexa, open lotties", "Alexa, tell lotties the baby fell asleep",
  "Alexa, ask lotties when was the last feed"), small and large icons (`docs/design/icons`), category
  **Health & Fitness** or **Lifestyle**, keywords.
- **Privacy & Compliance:** no purchases; "collects personal information": **yes**, answer honestly: with account
  linking the skill reads and writes the parent's baby log in her Lotties account, and its spoken answers carry log facts and
  no child name by default (docs/design/33-privacy-audit.md section 3); **child-directed: No** (it is used by parents,
  not children, although the data is about a child), no advertising, export compliance. Note that the skill does not
  give medical advice.
- **Testing instructions** for the reviewers: a test Lotties account (create one for them; never a real family's),
  that account linking is required for commands, the example phrases, and that a bottle needs an amount.
- **No health claims:** descriptions say it logs and reads back the family's own records; never "monitors", "detects",
  "keeps your baby healthy" or anything about doses. Medication by voice is limited to two things (docs/design/32-assistants.md
  section 5.4): saying that a dose of a medicine you registered was given (recorded as said, never checked or suggested) and
  asking for the reminders you registered (always with "these are reminders of the medicines you registered in Lotties, not
  recommendations from Lotties"). Describe them that way, never as dosing, advice or "reminds you what to give".
- **Availability:** the countries of each language (US for en-US, Brazil for pt-BR).
- Submit for review. After approval of the brand invocation name (section 1), switch it in a later version.

## 9. Troubleshooting

| Symptom | Likely cause |
| --- | --- |
| Console: "The remote endpoint could not be called, or the response it returned was invalid" with HTTP 404 | `Alexa__Enabled` is not `true` on the running pod |
| "I am unable to reach the requested skill" and nothing in the nginx or API logs | the Endpoint's SSL certificate type does not match what the host serves: use the wildcard option (section 4) |
| HTTP 400 for every request | wrong `Alexa__SkillIds`; the pod cannot reach `s3.amazonaws.com` (log line "Alexa request refused: CertificateUnavailable"); the pod's clock is off by more than 150 s (`stale_timestamp`) |
| "Please link your account" after linking | the Alexa client's access token lacks the `lotties-api` audience (5.1.4), or the issuer is not `https://auth.lotties.app/realms/lotties.app` (`AUTH_AUTHORITY`); decode one token from the console's JSON Input (`context.System.user.accessToken`) at a JWT debugger you trust, offline |
| Linking page shows "Invalid parameter: redirect_uri" | the Alexa Redirect URLs are not all in the client's Valid redirect URIs (5.1.2) |
| Answers in English to a Brazilian device | the device's language is not Portuguese (Brasil), or the pt-BR model was not built |
| Alexa says "open the Lotties app and accept the terms of use" | the linked person has not accepted the current terms and privacy policy (the consent screen, docs/design/38-consent-and-terms.md): she opens the Lotties app once with that account and accepts; the demo account for the reviewers must accept it too (ALEXA-SUBMISSION.md Etapa 2) |
| "You have more than one baby" | the parent belongs to several babies: Settings > Voice assistants in the app |
| Times said as "20 minutes ago" instead of a clock time (English) | the user has no time zone stored yet: the assistant uses the one saved with her notification settings (Settings > Notifications, saved once from a device: it stores that device's zone); Portuguese falls back to `America/Sao_Paulo` |
| "That's a lot of requests" | more than `RequestLimits__AssistantPermitsPerMinute` (30) commands in a minute |
