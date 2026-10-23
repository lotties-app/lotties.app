# 32. Voice assistants (Alexa first, an MCP server next)

Parents with full hands log and ask by voice: "Alexa, tell Lotties baby the baby fell asleep", "Alexa, ask Lotties baby
when was the last feed". Two layers: an adapter-neutral **assistant command layer** in Application, and one **adapter**
per platform in Api (Alexa now; an MCP server is the next adapter and reuses the command layer unchanged). The owner's
step-by-step for the Alexa developer console and Keycloak is [docs/ALEXA.md](../ALEXA.md).

## 1. What a parent can say

| Intent | en-US example | pt-BR example | Command |
| --- | --- | --- | --- |
| `SleepStartIntent` | "the baby fell asleep", "she is sleeping", "start sleep" | "o bebê dormiu", "ela está dormindo", "iniciar sono" | `LogSleepStart` |
| `SleepEndIntent` | "the baby woke up" | "o bebê acordou" | `LogSleepEnd` |
| `BottleIntent` (`amount` AMAZON.NUMBER, required; `kind` formula / breast milk, optional) | "log a 120 ml bottle of formula" | "registrar mamadeira de 120 ml de leite materno" | `LogBottle` |
| `NursingIntent` (`side` left / right, optional) | "start nursing on the left side" | "começar amamentação no peito esquerdo" | `LogNursing` |
| `DiaperIntent` (`kind` wet / dirty / both, required) | "log a wet diaper", "poop diaper" | "fralda de xixi", "ela fez cocô" | `LogDiaper` |
| `LastFeedIntent` | "when was the last feed" | "quando foi a última mamada" | `ReadLastFeed` |
| `SleepStatusIntent` | "is she sleeping", "how long has she been awake" | "há quanto tempo ela está dormindo" | `ReadSleepStatus` |
| `DiapersTodayIntent` | "how many diapers today" | "quantas fraldas hoje" | `ReadDiapersToday` |
| `NextAppointmentIntent` | "when is the next appointment" | "quando é a próxima consulta" | `ReadNextAppointment` |
| `DueVaccinesIntent` | "which vaccines are due" | "quais vacinas estão pendentes" | `ReadDueVaccines` |
| `SetBabyHelpIntent` | "choose the baby" | "escolher o bebê" | (help: Settings, Voice assistants) |
| `AMAZON.HelpIntent`, `StopIntent`, `CancelIntent`, `FallbackIntent`, `NavigateHomeIntent` | | | built-in |

Alexa custom skills are always reached through the wake word and the invocation name: "Alexa, tell/ask/open
**lotties baby** ...". A bare "Lotties, ..." is not possible on Alexa (only Amazon chooses wake words). The one-word
invocation "lotties" is a brand name and needs Amazon's approval with trademark evidence; the models ship with the
fallback **"lotties baby"** (pt-BR **"lotties bebê"**) and docs/ALEXA.md says how to switch once approved.

Not offered, on purpose: medications (no intent exists; an assistant never logs, reads or advises a dose), free-text
notes (nothing the parent says is stored as text), health advice of any kind (answers are facts from the parents' own
log and the published vaccine schedule), the "ended by sleep" rule (section 5), and other built-in markers (nasal
suction and the like were skipped: they add utterances, not value, and are easy to add as one command each later).

## 2. Layers

```
Alexa service ──HTTPS──> Api/Assistants/Alexa (AlexaSkill)      MCP client ──> (future) Api/Assistants/Mcp
                            verify signature, skill id, time            authenticate the bearer token
                            validate the account-link token             set the user
                            set HttpContext.User                        map tools to commands
                            render AssistantResult as speech            render AssistantResult as JSON
                                         │                                           │
                                         └──────────────> Application/Assistants <───┘
                                                    IAssistantService (commands, queries)
                                                    AssistantSubjects (user, baby, role, time zone)
                                                          │
                                       IEventService (the same upsert as PUT /events/{id}), repositories
                                                          │
                                       Domain/Assistants: baby choice, event ids, payloads, facts
```

- **Domain** (`Domain/Assistants`): `AssistantBabyChoice` (which baby, section 4), `AssistantEventIds` (UUID v5 of
  adapter + request id + command + baby), `AssistantPayloads` (the payloads the web writes for the same actions),
  `AssistantEventFacts` (reading events back: sleep timers, the web's nap/night rule, the suggested nursing side, a
  feed's facts, a diaper's content), `AssistantLimits` (bottle 1-500 ml, the Feed tray's stepper limit),
  `UserAssistantSettings` (the stored default baby).
- **Application** (`Application/Assistants`): `IAssistantService` with one method per command, `AssistantResult`
  (section 3), `AssistantSubjects`, `IAssistantSettingsService` (`GET`/`PUT /me/assistant-settings`).
- **Api**: `Assistants/Alexa/*` (the adapter), `Authentication/AccountLinkTokens.cs` (token validation, section 6),
  `Limits/AssistantRateLimiter.cs`.

## 3. Results are language-neutral

Every command answers an `AssistantResult`: a stable `code` (snake_case on the wire) plus typed facts (instants in UTC,
minutes, amounts, enums, the baby's id and name, the IANA `timeZone` to tell local times in, `asOf`), never a sentence.
Each adapter renders it; the Alexa adapter has one class per language (`EnglishAlexaLanguage`, `PortugueseAlexaLanguage`)
with a line for every code, tested for every code in both languages.

| Code | When |
| --- | --- |
| `not_allowed` | the role cannot do it (a Viewer writing; any command from a user who is only a Doctor) |
| `no_baby`, `choose_baby` | no baby; several and no default (set it in the app) |
| `rate_limited` | over the per-user assistant limit (the adapter's) |
| `invalid_amount` | bottle amount missing or outside 1-500 ml (`min`, `max`) |
| `sleep_started`, `sleep_already_running` | a sleep timer started; one already runs (`at` = its start) |
| `sleep_ended`, `no_running_sleep`, `several_running_sleeps` | woke up (`at`, `minutes`); none running; `count` running (nothing changed) |
| `bottle_logged` | `amountMl`, `bottleKind`, `formulaName` |
| `nursing_started`, `nursing_already_running` | `side`; one already runs |
| `diaper_logged` | `diaper` |
| `last_feed`, `no_feeds` | the newest feeding of 30 days: `at`, `endedAt`, `running`, `minutes`, `feedMethod`, `amountMl`, `side`, `bottleKind` |
| `sleeping`, `awake`, `no_sleeps` | since `at` (`minutes` so far, or the last sleep's length) |
| `diapers_today` | `count`, `wet`, `dirty`, `window` (`today` in the user's zone, else `last_day`) |
| `next_appointment`, `no_appointment` | the next upcoming appointment within a year: `appointment` (start, the family's title, type) |
| `vaccines_due`, `no_vaccines_due` | `count` due or overdue, `overdue`, up to five doses with their names in `en` and `pt-BR` (the vaccine status engine, facts only) |

## 4. Which baby

`AssistantBabyChoice.Decide` over the user's memberships, Doctor memberships left out (a Doctor's patients never enter
the assistant, like the parents' shell): the stored default when she is still a family member of it; else the only baby
she can log for; else, when she logs for none, her only baby (read-only answers); else `choose_baby`. A user who is only
a Doctor gets `not_allowed`.

The default lives in `user_assistant_settings(user_id PK/FK users ON DELETE CASCADE, default_baby_id FK babies ON DELETE
SET NULL, updated_at)` (migration `VoiceAssistants`), set by `PUT /me/assistant-settings {defaultBabyId|null}` (only a
baby she can log for: Owner, Parent, Caregiver; anything else, a foreign or unknown id included, is 400
`validation_failed` field `defaultBabyId`, so nothing tells babies apart) and read by `GET`. The web: Settings >
Voice assistants (`code/web/src/settings/VoiceAssistantsSection.tsx`), a select of the babies she logs for, shown
when she logs for at least one. Account deletion removes her row and clears other rows that point at an erased baby.

## 5. Rules of the commands

- **Same write path.** Every write is `IEventService.UpsertAsync`, the use case of `PUT /events/{id}`: field rules,
  bottle drunk ≤ prepared, the formula reference, `createdBy` = the linked user, the Caregiver rules. The role is checked
  first by the command layer (writes need `CanLogEvents`: Owner, Parent, Caregiver; reads any family role), because there
  is no route policy in front of it.
- **Idempotent.** The event id is `AssistantEventIds.For(adapter, requestId, command, babyId)`. A platform retry carries
  the same request id: the stored event is found and its outcome answered, nothing is written twice. Saying the same
  words again is a new request id and logs again (two bottles are two bottles).
- **Sleep start** starts a sleep timer whose kind is the web's `inferFellAsleepKind` rule (night after a bed time of the
  last 3 hours or from 19:00 to 04:59 local, else nap; without a known zone only the bed time counts) and answers
  `sleep_already_running` when a nap, night or kind-less sleep timer runs. It logs no `fell_asleep` marker.
- **Wake up** mirrors the web's Wake-up: stops the one running sleep timer (an open pause folded into
  `paused_seconds`), stops running night wakings, and logs the `woke_up` marker under the derived id (which is what makes a
  retry recognisable). None running: `no_running_sleep`; several: `several_running_sleeps`, nothing changed. A Caregiver
  may stop someone else's running sleep (the running-event exception, unchanged).
- **Ended by sleep is not applied by voice.** The web stops a running feeding when a sleep starts
  (`web/src/now/sleepStopsFeeding.ts`, docs/design/20-feeding-amounts.md section 2); the server has no domain function for
  it and the rule is not duplicated here: a feeding left running stays running until stopped in the app.
- **Bottle** is an instant (start = end = now), all of it drunk (no `amount_drunk_ml`), `bottle_feeding_type` from the
  kind; a formula bottle names the baby's current formula when there is one (the Feed tray rule), else only its kind.
- **Nursing** starts a timer (`method: breast`, `side`, `side_since`, as the web's `startNursing`) on the side said,
  else opposite to where the last finished feed ended. It is stopped in the app.
- **Reads** use the clinical event reads (no deleted events), the appointment repository (upcoming only) and the vaccine
  status engine (`VaccineOverviewReader`, the reminders' engine). Local days and clock times use the user's time zone:
  the one stored with her notification settings, else the adapter's fallback (pt-BR: `America/Sao_Paulo`; en: none, so
  answers say "20 minutes ago" and diapers count the last 24 hours).

## 6. The Alexa adapter (`POST /api/v1/alexa`)

Anonymous for ASP.NET (no `Authorization` header), like `POST /push/deliveries/.../actions`: Amazon's signature and the
account-linking token in the body authenticate it. In order:

1. `Alexa:Enabled` false (the default): 404.
2. Body read once, raw, at most `Alexa:MaxRequestBodyBytes` (128 KiB): else 413. The raw bytes are what the signature
   covers, so the body is read by the handler (no model binding) and kept as bytes.
3. Signature (`AlexaRequestVerifier`): `SignatureCertChainUrl` passes Amazon's URL rules (https, host `s3.amazonaws.com`,
   port 443 or none, path starting `/echo.api/` after normalising dot segments; anything else is refused before any
   download, so the header cannot make the API fetch another URL); the chain is downloaded over a client with no
   redirects and no cookies, a 5 s timeout and a 64 KiB cap, cached per URL (60 min, never past the leaf's expiry; a
   failure for a minute; at most 32 URLs); the leaf is valid now, names `echo-api.amazon.com` in its subject alternative
   names, and the chain builds to a root the operating system trusts (revocation not checked online); `Signature-256`
   (else `Signature`) is the base64 RSA PKCS#1 SHA-256 signature of the raw body under the leaf's key. Any failure: 400.
4. JSON parsed with a depth limit of 32 into a minimal envelope; not an Alexa request: 400.
5. `request.timestamp` within 150 seconds of the server clock (past or future): else 400.
6. Every skill id the request names (`session.application.applicationId`, `context.System.application.applicationId`)
   is in `Alexa:SkillIds`: else 400.
7. `LaunchRequest`, the built-in intents and `SetBabyHelpIntent` answer without an account. A command intent needs the
   account-linking token (`context.System.user.accessToken`, else `session.user.accessToken`): none, or one that fails
   validation, answers the `LinkAccount` card and "please link your account in the Alexa app".
8. The token is validated by `AccountLinkTokens.SchemeName`, a second JWT bearer scheme configured by the same
   `ConfigureJwtBearerOptions` as the API's (issuer from the authority's discovery document, audience `lotties-api`,
   signing keys, lifetime, `sub` required); only where the token is read from differs (the request items, never the
   header). Nothing is copied by hand or weakened. The principal becomes `HttpContext.User`, so `ICurrentUser` maps it to
   the Lotties user exactly as for the web (issuer + `sub`, provisioned on first use).
9. The per-user limit `RequestLimits:AssistantPermitsPerMinute` (30, fixed one-minute windows like every other limit;
   the request is anonymous at the HTTP level, so the adapter asks the limiter after authenticating her): over it the
   skill says "try again in a minute". The global per-address limit applies before, as for every anonymous request.
10. The command runs; its result is spoken in the request's language (`pt-*` Portuguese with 24-hour times, every other
    locale English with 12-hour times), one short sentence, SSML-escaped as a whole (names and titles are the family's
    text), `shouldEndSession: true`; a reprompt only for the welcome, help and fallback. `SessionEndedRequest` gets an
    empty response.

## 7. Privacy and logging

- Amazon records and processes the audio and transcribes it; Lotties receives only the intent name and its slot values
  (an amount, a kind, a side), the locale, the request ids and the account-linking token. Nothing the parent says is
  stored as text.
- Logged: the request type, the intent name (only names the skill knows), the result code and the correlation id
  (`HttpContext.TraceIdentifier`), plus verification refusals by reason code. Never the body, slot values, tokens,
  Amazon user or device ids. The command layer logs the adapter, command, baby id and result code, as the REST routes do.
- Answers speak the baby's name and the family's own appointment title aloud on the device; that is the point of asking.
- Account linking issues Keycloak tokens to Amazon for the Alexa client only (its own confidential client and secret,
  never in this repository). Unlinking the skill in the Alexa app, or removing the client's sessions in Keycloak,
  revokes it.

## 8. Adding an adapter (the MCP server)

1. Authenticate the user the adapter's way (an MCP server behind the normal bearer auth already has
   `HttpContext.User`; a platform that sends a token elsewhere validates it with `IAccountLinkTokenValidator`), so
   `ICurrentUser` resolves her.
2. Map each tool or intent to one `IAssistantService` method; pass `AssistantInvocation(adapterName, requestId,
   fallbackZone)` with a request id the platform repeats on retries (or a fresh GUID when it has none: then retries may
   log twice).
3. Render `AssistantResult` (for MCP: return it as JSON; it is already language-neutral), and add the adapter's routes to
   `EndpointRoleMatrixTests` with a role and scope decision.
4. Never add a medication command, a free-text field, or advice.

## 9. Not verifiable here

Without Amazon: the real certificate chain and signature (tested with a chain generated in the test), the interaction
models' build in the developer console, entity resolution and dialog delegation behaviour, the account-linking flow
against Keycloak, the invocation name approval, certification. docs/ALEXA.md lists the console tests to run.
