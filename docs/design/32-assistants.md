# 32. Voice and AI assistants (Alexa, MCP server)

Parents with full hands log and ask by voice: "Alexa, tell Lotties the baby fell asleep", "Alexa, ask Lotties
when was the last feed". Two layers: an adapter-neutral **assistant command layer** in Application, and one **adapter**
per platform in Api: Alexa (section 6) and a remote MCP server for AI assistants such as Claude (section 9), both over the
same command layer. The owner's step-by-step guides: [docs/ALEXA.md](../ALEXA.md) (Alexa developer console and Keycloak)
and [docs/MCP.md](../MCP.md) (Keycloak client scopes and clients, connecting Claude and other MCP clients).

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
| `NextNapWindowIntent` | "what is the next nap window", "when will she be sleepy", "when is the next nap", "when does she need a nap", "when should she nap next", "when is nap time" | "qual a próxima janela de sono", "quando ela vai ficar com sono", "quando é a próxima soneca", "quando ela precisa dormir" | `ReadNextNapWindow` |
| `NextFeedIntent` | "when is the next feed", "when will she be hungry", "when is the next bottle", "when should she eat next", "when is the next meal" | "quando é a próxima mamada", "quando ela vai ter fome", "quando é a próxima mamadeira", "quando ela vai mamar de novo" | `ReadNextFeed` |
| `NextDiaperIntent` | "when is the next diaper change", "when is the next diaper", "when will she need a diaper change", "when should I change the next diaper" | "quando é a próxima troca de fralda", "quando é a próxima fralda", "quando devo trocar a próxima fralda" | `ReadNextDiaper` |
| `DiapersAverageIntent` | "how many diapers a day does she usually use", "how many diapers per day on average", "average diapers per day" | "quantas fraldas por dia ela costuma usar", "qual a média de fraldas por dia", "fraldas por dia" | `ReadDiapersAverage` |
| `BottleAverageIntent` | "how much should I make for the next bottle", "how big was the last bottle", "how much does she usually drink" | "quanto devo preparar na próxima mamadeira", "qual foi o tamanho da última mamadeira", "quanto ela costuma tomar de mamadeira" | `ReadBottleAverage` |
| `BottleTodayIntent` | "how much did she drink today", "how many ml of milk today", "how many bottles today" | "quanto ela tomou de mamadeira hoje", "quantos mls de mamadeira tomou hoje", "quantas mamadeiras hoje" | `ReadBottleToday` |
| `FeedsTodayIntent` | "how many feeds today", "how many times did she eat today" | "quantas mamadas hoje", "quantas vezes ela mamou hoje", "quantas vezes ela comeu hoje" | `ReadFeedsToday` |
| `SleepTodayIntent` | "how much did she sleep today", "how many naps today", "total sleep today" | "quanto ela dormiu hoje", "quantas sonecas ela fez hoje", "total de sono hoje" | `ReadSleepToday` |
| `LastDiaperIntent` | "when was the last diaper change", "when did I last change her diaper", "last diaper" | "quando foi a última troca de fralda", "quando troquei a fralda dela", "última fralda" | `ReadLastDiaper` |
| `CryReasonsIntent` | "why is she crying", "why is the baby fussy", "what could be making her cry" | "por que ela está chorando", "por que ela está irritada", "por que ela não para de chorar" | `ReadCryReasons` |
| `RequestDeleteLastIntent` | "undo the last thing I logged", "delete the last entry", "undo the last entry", "cancel the last entry" | "desfazer o último registro", "apagar o último registro", "excluir o último registro" | `RequestDeleteLast` (asks only, section 5.3) |
| `BathIntent` (`temperature` AMAZON.NUMBER, optional, in the user's unit system) | "log a bath", "water was thirty seven degrees" | "registrar banho" | `LogBath` |
| `TummyTimeIntent` | "start tummy time" | "iniciar tempo de bruços" | `LogTummyTime` (timer, stopped in the app) |
| `BellyPainIntent` (`painLevel` AMAZON.NUMBER, 1-5, asked for when missing) | "belly pain level three" | "dor de barriga nível 3" | `LogBellyPain` |
| `BreastPumpIntent` (`amountLeft`, `amountRight` in ml, optional) | "start pumping" | "começar a ordenhar" | `LogBreastPump` (timer) |
| `NasalSuctionIntent` | "suctioned her nose" | "aspirei o nariz dela" | `LogNasalSuction` |
| `BellyMassageIntent` | "gave her a belly massage" | "fiz massagem na barriga dela" | `LogBellyMassage` (timer) |
| `FussyIntent` (`intensity` FUSSY_INTENSITY, optional) | "she's fussy" | "ela está irritada" | `LogFussy` (timer) |
| `NailTrimIntent` | "trimmed her nails" | "cortei as unhas dela" | `LogNailTrim` |
| `TemperatureIntent` (`value` AMAZON.NUMBER, required, in the user's unit system; `method` TEMP_METHOD, optional) | "log temperature thirty seven" | "registrar temperatura 37" | `LogTemperature` (a record only) |
| `SpitUpIntent` | "she spit up" | "ela regurgitou" | `LogSpitUp` |
| `TeethingIntent` | "she's teething" | "ela está dentando" | `LogTeething` |
| `MilestoneIntent` (`milestone` MILESTONE_TYPE, optional) | "she rolled over" | "ela virou de bruços" | `LogMilestone` |
| `SymptomIntent` (`symptom` SYMPTOM_TYPE, `severity` SYMPTOM_SEVERITY, optional) | "she has a cough" | "ela está com tosse" | `LogSymptom` (a record only) |
| `OutdoorIntent` | "went for a walk" | "saímos para passear" | `LogOutdoor` (timer) |
| `SkinCareIntent` | "applied lotion" | "passei hidratante" | `LogSkinCare` |
| `MedicationIntent` (`medicationName` AMAZON.SearchQuery, required) | "gave her" + the registered medicine name | "dei" + the registered medicine name | `LogMedication` (section 5.4) |
| `MedicationReminderIntent` | "is any medicine due" | "tem algum remédio para dar" | `ReadMedicationReminder` (section 5.4) |
| `DaySummaryIntent` | "how was her day" | "como foi o dia dela" | `ReadDaySummary` (today) |
| `WeekSummaryIntent` | "how was her week" | "como foi a semana dela" | `ReadWeekSummary` (up to today) |
| `BabyProfileIntent` | "how old is she" | "quantos anos ela tem" | `ReadBabyProfile` (the age only) |
| `PanelIntent` | "open the panel", "night mode" | "abrir o painel", "modo noturno" | the reads of the Echo Show night panel, design 42 (read intent, no slots) |
| `ListBabiesIntent` | "list my babies" | "listar meus bebês" | `ListBabies` |
| `SetBabyHelpIntent` | "choose the baby" | "escolher o bebê" | (help: Settings, Voice assistants) |
| `AMAZON.HelpIntent`, `StopIntent`, `CancelIntent`, `FallbackIntent`, `NavigateHomeIntent` | | | built-in |

Alexa custom skills are always reached through the wake word and the invocation name: "Alexa, tell/ask/open
**lotties** ...". A bare "Lotties, ..." is not possible on Alexa (only Amazon chooses wake words). The models ship with
the one-word invocation **"lotties"**, the same in en-US and pt-BR (the sample phrases stay in each language). A one-word
brand name may need evidence of brand ownership at certification (site lotties.app, GitHub organisation lotties-app); if
Amazon rejects it, switch both models to the documented fallback **"lotties baby"** BEFORE publishing: the invocation
name cannot be changed after the skill is certified and published (docs/ALEXA.md section 1).

Not offered, on purpose: free-text notes (nothing the parent says is stored as text: every choice slot resolves to one of the
built-in options of the event type's own field and anything else is left out), health advice of any kind (answers are facts from
the parents' own log and the published vaccine schedule), dose commands (section 5.4: by voice a parent can only say that a dose
of a medicine she registered was given, and ask for the reminders she registered), the "ended by sleep" rule (section 5), a
"fever" or "dehydration" symptom (the Symptom event type has no such option: a temperature is logged with `TemperatureIntent`,
as a number, never interpreted) and the `other` option of the milestone and symptom fields (it would need her own words).

## 2. Layers

```
Alexa service ──HTTPS──> Api/Assistants/Alexa (AlexaSkill)      MCP client ──HTTPS──> Api/Assistants/Mcp (McpToolRunner)
                            verify signature, skill id, time            authenticate the bearer token (own audience)
                            validate the account-link token             set the user, check the scopes
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
- **Api**: `Assistants/Alexa/*` (the Alexa adapter), `Authentication/AccountLinkTokens.cs` (token validation, section 6),
  `Assistants/Mcp/*` (the MCP adapter, section 9), `Limits/AssistantRateLimiter.cs`.

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
| `bottle_started` | same fields; the bottle runs as a timer (account setting "Time bottle feedings" on), stopped in the app |
| `nursing_started`, `nursing_already_running` | `side`; one already runs |
| `diaper_logged` | `diaper` |
| `last_feed`, `no_feeds` | the newest feeding of 30 days: `at`, `endedAt`, `running`, `minutes`, `feedMethod`, `amountMl`, `side`, `bottleKind` |
| `sleeping`, `awake`, `no_sleeps` | since `at` (`minutes` so far, or the last sleep's length) |
| `diapers_today` | `count`, `wet`, `dirty`, `window` (`today` in the user's zone, else `last_day`) |
| `next_appointment`, `no_appointment` | the next upcoming appointment within a year: `appointment` (`startsAt`, `type` code, and `specialty`: the CODE of the linked care provider's specialty, only when her typed specialty is one of `DoctorSpecialties`; never a title, name, clinic, place, note or any other provider data) |
| `vaccines_due`, `no_vaccines_due` | `count` due or overdue, `overdue`, up to five doses with their names in `en` and `pt-BR` (the vaccine status engine, facts only) |
| `next_nap_window`, `nap_window_asleep`, `no_nap_prediction` | the sleep prediction's window (`estimate`: earliest, expected, latest, UTC) while awake, by the Now screen's rules (stale after 2 h past the window or no sleep in 24 h = none); asleep: `at` and, when the prediction measures the running sleep to its expected end, `endedAt` = the expected wake-up |
| `next_feed`, `no_next_feed` | the feeding prediction's window (`estimate`) |
| `next_diaper`, `no_next_diaper` | the next wet and dirty diaper (`wetEstimate`, `dirtyEstimate`, each only when its Domain gate passed: `DiaperPrediction.WetExpectation`, `DirtyExpectation`) |
| `diapers_average`, `no_diapers_average` | `perDay`, `wetPerDay`, `dirtyPerDay` (one decimal) over the complete local days with diapers among the last seven (today left out), `count` = those days, at least 3 |
| `bottle_average`, `no_bottle_data` | `count` (up to 5), `amountMl` = their average, `lastAmountMl`, `at` = the last one; at least 3 bottles with an amount in 14 days; facts, never a recommendation |
| `sleep_today` | `minutes` since local midnight (a running sleep until now) and `count` naps: the day summary's sleep math |
| `bottle_today` | `count` bottles since local midnight (`window`: `today` in the user's zone, else `last_day`), `amountMl` = the ml drunk (zero bottles is still this code, `count` 0), `formulaBottles` and `breastMilkBottles` (`bottles`, `ml`, those that said what they held). The ml is **the drunk-amount rule every server total uses**, `BottleAmounts.DrunkMl` through `FeedObservation.BottleMl` (the drunk amount, else the prepared amount; a bottle without an amount counts as a bottle only), summed by `AssistantFeedTotals`; spoken in the user's unit system |
| `feeds_today` | `count` feeds since local midnight (same `window` rule), `bottleFeeds`, `breastFeeds`, `solidFeeds`; zero feeds is still this code |
| `last_diaper`, `no_diapers` | the newest diaper of 30 days: `at`, `diaper` |
| `cry_reasons`, `cry_no_data` | up to three likely causes (`cryCauses`: cause, level, facts), always `redFlags` (each cause carries its ranking score internally; the spoken Alexa answer leads with the top cause and its first fact, and adds the second only when its score is within 0.1 of the first, while the safety sentence and the full red-flag list are never shortened; MCP keeps every cause); `running` = a sleep timer runs so the log may be behind |
| `delete_requested`, `no_entry_to_delete`, `last_not_undoable` | the newest entry this adapter made in 30 minutes was marked as a deletion request (`at`, `entryType`); nothing was deleted; none to ask about (section 5.3) |
| `bath_logged`, `tummy_time_started`, `belly_pain_logged`, `breast_pump_started`, `nasal_suction_logged`, `belly_massage_started`, `fussy_started`, `nail_trim_logged`, `temperature_logged`, `spit_up_logged`, `teething_logged`, `milestone_logged`, `symptom_logged`, `outdoor_started`, `skin_care_logged` | the entry was written (`at`); `temperature_c` (as said, converted to Celsius), `intensity` (belly pain level, or the fussy choice) only where the person gave them; timers are running until stopped in the app |
| `invalid_value` | a number is missing or out of range (`field`: `temperature` 30-45 C, `water_temperature` 0-60 C, `pain_level` 1-5, `pump_amount` 1-500 ml; `min`, `max` in C, ml or the level); nothing was written |
| `medication_logged`, `no_active_prescription` | it was recorded that a dose of a registered medicine was given (`at`; `medicine` only with `sayMedicineNames`); the medicine name matches none with an active prescription today (nothing written) |
| `medication_reminder`, `no_medication_due` | the family's own reminders: `count` due now (may be 0), `at` the next scheduled time, `dueMedicines`/`medicine` only with `sayMedicineNames`; none registered or scheduled |
| `unknown_baby` | the adapter named a baby (`babyId`) that is not one of the user's family memberships (unknown, someone else's, or hers only as Doctor: the same answer) |
| `invalid_date` | a summary date in the future or more than 365 days back (`earliestDate`, `latestDate`) |
| `babies` | the user's family babies (`babies`: `id`, `name` only with `sayBabyName`, `role`, `canLog`, `isDefault`), never a Doctor's patients |
| `baby_profile` | the baby's `age` (and the name only with `sayBabyName`) (`days`, `weeks`, whole calendar `months` on the user's local date); nothing else of the profile |
| `day_summary`, `week_summary` | `days`: one or seven local days, oldest first, each `date`, `complete` (false for today) and the clinical summary's day rows: `sleep` (`totalMinutes`, `nightMinutes`, `napMinutes`, `naps`, `longestMinutes`), `feeding` (`feeds`, `bottleMl`, `breast`, `bottle`, `solid`), `diapers` (`total`, `wet`, `dirty`) |

The queries added with the MCP server (`ListBabies`, `ReadBabyProfile`, `ReadDaySummary(date?)`,
`ReadWeekSummary(endDate?)`) are adapter-neutral too: Alexa renders their codes in both languages (`ListBabiesIntent`,
`BabyProfileIntent`, `DaySummaryIntent`, `WeekSummaryIntent`; the Alexa day and week summaries are always today and the seven
days up to today). The summaries reuse the clinical summary's reader and math unchanged (`DailyObservationReader`, `SleepSummaries`,
`FeedingSummaries`, `DiaperSummaries`: the day rows of `GET /clinical-summary`, ported from the parents' Insights); the
tests compare them with that endpoint on the shared golden scenario. Days are local days in the zone of section 5's zone
rule; the summaries always name it (`timeZone`, `UTC` when none is known, and `timeZoneSource`: `requested`, `stored`,
`adapter`, `language`, `utc`), so an assistant can tell the user which days it counted. `bottleMl` is what the baby drank
(`BottleAmounts.DrunkMl`, the web's `drunkMl`: `amount_drunk_ml`, else the prepared `amount_ml` because a bottle without a
drunk value was fully drunk, which keeps old bottles' totals); the clinical summary, the formula usage and `last_feed`
read the same function (docs/design/20-feeding-amounts.md).

## 4. Which baby

`AssistantBabyChoice.Decide` over the user's memberships, Doctor memberships left out (a Doctor's patients never enter
the assistant, like the parents' shell): the stored default when she is still a family member of it; else the only baby
she can log for; else, when she logs for none, her only baby (read-only answers); else `choose_baby`. A user who is only
a Doctor gets `not_allowed`. An adapter that lets the user name the baby (the MCP tools' `babyId`,
`AssistantInvocation.BabyId`) gets that baby when it is one of her family memberships, else `unknown_baby`; the role rules
then apply as usual.

The default lives in `user_assistant_settings(user_id PK/FK users ON DELETE CASCADE, default_baby_id FK babies ON DELETE
SET NULL, say_baby_name bool NOT NULL default false, say_medicine_names bool NOT NULL default false, updated_at)` (migrations `VoiceAssistants`, `AssistantSayBabyName`, `AssistantSayMedicineNames`), set by `PUT /me/assistant-settings {defaultBabyId|null, sayBabyName?, sayMedicineNames?}` (only a
baby she can log for: Owner, Parent, Caregiver; anything else, a foreign or unknown id included, is 400
`validation_failed` field `defaultBabyId`, so nothing tells babies apart) and read by `GET`. The web: Settings >
Voice assistants (`code/web/src/settings/VoiceAssistantsSection.tsx`), a select of the babies she logs for, shown
when she logs for at least one. Account deletion removes her row and clears other rows that point at an erased baby.

`sayBabyName` (default false, section 7) is a per-user switch beside it: a `PUT` without the member leaves the stored value
alone (an older client keeps working); `GET` always returns it. Settings > Voice assistants has the switch "Say my baby's
name in answers"; it is hers, not a baby's, so a user who logs for no baby still sees it.

`sayMedicineNames` (default false, section 7) works the same way: a second per-user switch, "Say the names of my medicines in
answers" ("Falar o nome dos remédios nas respostas"), below the first. Off, a medicine is "a medication dose" or "medicine reminders";
on, the name as the family registered it is spoken in the `MedicationIntent` confirmation and the reminder, in Alexa and in the MCP
text, and is in the structured JSON (`medicine`, `dueMedicines`) only then. Never an amount, dose, schedule or interval, whatever it says.

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
- **Bottle** follows the account's "Time bottle feedings" setting (`user_feeding_settings`, `GET/PUT /me/feeding-settings`,
  docs/design/20-feeding-amounts.md section 3; absent means off). Off (default): an instant (start = end = now), all of it
  drunk (no `amount_drunk_ml`). On: it **starts running** (`ended_at` null) with the prepared amount `amount_ml` and no
  `amount_drunk_ml`, exactly the Feed tray's shape, and the person stops it in the app, where the drunk amount and pauses
  are told; the answer is `bottle_started` instead of `bottle_logged` (a timer started, not "N ml drunk"; Alexa: "Started
  timing a 120 ml bottle ..."; pt-BR "Comecei a cronometrar uma mamadeira de ..."). `bottle_feeding_type` comes from the
  kind either way; a formula bottle names the baby's current formula when there is one (the Feed tray rule), else only its
  kind. The id is still the UUID v5 of the request, so a retry finds the same event and answers `bottle_started` when it is
  running (or was stopped later), else `bottle_logged`. Several bottles may run at once, as in the web.
- **Nursing** starts a timer (`method: breast`, `side`, `side_since`, as the web's `startNursing`) on the side said,
  else opposite to where the last finished feed ended. It is stopped in the app.
- **Reads** use the clinical event reads (no deleted events), the appointment repository (upcoming only) and the vaccine
  status engine (`VaccineOverviewReader`, the reminders' engine). Local days and clock times use one zone, chosen by
  `AssistantZoneChoice` (the same rule for every adapter): the zone the caller asked for (an MCP tool's `timeZone`), else
  the one stored with her notification settings, else the adapter's fallback for the request's language (Alexa pt-BR:
  `America/Sao_Paulo`), else `America/Sao_Paulo` when her app language is Portuguese (Brazil) (the locale of her newest
  active push subscription, the only language the server keeps), else none. With none, answers say "20 minutes ago",
  diapers today count the last 24 hours (`window: last_day`), and the day summaries use UTC days and say so
  (`timeZone: "UTC"`, `timeZoneSource: "utc"`): never silently.

## 5.1 Predictions and "why is she crying"

Eight read-only questions reuse pure Domain functions; the adapters only render:

- **Next nap window, feed, diaper change** (`AssistantForecasts`): `PredictionEngine.Predict` and `DiaperPredictions.Predict`
  over `IPredictionHistoryRepository` (the same history window as `GET /predictions`), with the user's zone offset in
  force now as the prediction instant. The nap window follows the Now screen's `napPrediction`: only while awake
  (`AssistantSleepState`, the port of `deriveNowState`), not stale. Nothing is guessed: no prediction = "not enough history".
- **Diapers per day / sleep today** reuse the clinical summary's readers and math (`DiaperSummaries`, `SleepSummaries`).
- **Last bottles** (`bottle_average`): the average and the last of her last 5 bottles with an amount (what she drank, as
  `last_feed` tells), from at least 3 in 14 days. The web suggests amounts in TypeScript only (`bottleSuggestions.ts`);
  the server has no such code, so this is the simple average, phrased "her last N bottles averaged X ml, the last was Y ml",
  never a recommendation.
- **Why is she crying** (`AssistantCryReasons`, `Domain/CryReasons`): the scoring half of `code/web/src/now/cryReasons.ts`
  is a pure C# function (`CryReasonRanker.Rank` over `CrySignals`), identical to the web's `scoreCrySignals`; both run the
  shared vectors `code/web/src/now/cryReasonsVectors.json` (`cryReasonsVectors.test.ts`, `CryReasonVectorTests`). The
  web extracts the signals from its local Dexie log (`cryReasonSignals`), the server from the stored log
  (the awake stretch and night rule, her feed gaps, the prediction's feed gap, the published norm in the first four
  weeks, a smaller last bottle (`CryTopUp`), the wake window and overtired heads-up, the diaper gaps, belly pain and
  fussy windows). The two extractions read the same facts but are separate code (the server has no cached predictions
  DTO and no lone-marker bed-time pairing beyond `AssistantSleepState`), so only the scoring is vector-tested. The answer
  tells the top three non-comfort causes that are likely or possible and have a logged fact, then **always** the safety
  sentence: not a diagnosis or medical advice, call the pediatrician or emergency services for a fever (babies under 3
  months need a call right away), crying that cannot be soothed, refusing feeds, unusual sleepiness or being hard to wake,
  a bulging or stiff soft spot (the web's "When to call for help" wording). No soothing steps, no doses, no medication.

## 5.2 Origin marker

Every event an assistant command **creates** carries the payload member `via` = the adapter's lowercase name (`alexa`,
`mcp`; `AssistantOrigin`, from the `AssistantInvocation` adapter name; nothing else is ever written: no text, id, token or
utterance). When a command **changes** an event that another origin created (stopping a sleep timer or nursing session
the app, or another adapter, started; night wakings stopped by a wake-up), the original `via` stays and
`updated_via` = the adapter is added; an adapter stopping its own timer changes nothing but the usual folding. A replayed
request id finds the stored event and writes nothing, so the marker never changes. Like the cry monitor's marks it is a
plain payload member: no table, no migration, no declared field (members no field declares are not checked); the generic
upsert, sync, backup export/import and the doctor's view carry it as payload. The web editor keeps it
(`useEventSheetForm.editBase` keeps `via`, `updated_via` and the delete-request members through an edit) and shows a quiet
line wherever the entry is shown (day list row, event sheet, read-only sheet): "Added by Alexa" / "Added by an AI
assistant", "Finished by Alexa" (`assistants.origin.*`).

## 5.3 Assistants never delete

An assistant can never delete, overwrite or edit away a record. There is no delete command, no delete in the Alexa intents
or the MCP tools, and the assistant code reaches no `IEventService.DeleteAsync`, repository removal, `deleted` flag or payload
overwrite: the only changes an existing event gets are the timer stop (the folded pause, `updated_via`) and the request
below. `AssistantNeverDeletesTests` fails when that stops being true: a scan of the assistant sources (Domain, Application,
Api) for delete and remove calls, a reflection test on `IAssistantService` (the only method named like a delete is
`RequestDeleteLastAsync`), the MCP tool list (the only such tool is `request_delete_last_entry`) and a behavioural test
that no command lowers the event count or soft-deletes. A write only touches events its own adapter created
(`via` = that adapter) or stops an open timer; it never touches another origin's entry.

What it can do is **ask**: `RequestDeleteLast` ("undo the last thing I logged", "delete the last entry"; pt-BR "desfazer o
último registro", "apagar o último registro"; MCP `request_delete_last_entry`, scope `lotties.write`) finds the newest
non-deleted entry that the calling adapter created (`via`) in the last 30 minutes, of any kind, and adds two payload members: `delete_requested_via` = the adapter name and `delete_requested_at` = the server clock
(ISO instant). It answers `delete_requested` (neutral: it asked, nothing was deleted, the person approves in the app) or
`no_entry_to_delete`. If that newest entry is the `woke_up` marker (which voice may not mark) the request stops there: it answers
`last_not_undoable` (the last thing logged was a wake-up, it cannot be undone by voice, correct it in the app), changes nothing
and never falls back to an older entry. It is the same upsert as an edit (client time never older than the stored one), idempotent: an entry
that already carries the request is left as it is, so asking twice, or replaying the request id, changes nothing. No new
table, no migration, no new route (the markers are undeclared payload members like `via`, carried by sync, backup and the
doctor's view). The Viewer role cannot ask (it is a write); a role that logs can.

The web shows, in the day list row and in the event sheet (not on Now), a banner "Alexa asked to delete this entry" /
"An AI assistant asked to delete this entry" with **Delete** (the normal soft delete, then the usual Undo notice) and
**Keep** (a normal edit that removes the two members and keeps `via`; a normal client `updatedAt` conflict rule applies). Only
roles that may already edit the entry see the buttons; a Viewer, or a Caregiver looking at someone else's entry, sees the
banner read-only. Strings: `assistants.deleteRequest.*`.

## 5.4 The loggers added later and medication

- **Choices are the field's own options.** `AssistantChoices` (Domain) reads the options of the built-in event type's field
  (`BuiltInEventTypes`); a value that is not one of them is "not said", never stored, so there is no free text and no value the app
  does not offer. The Alexa slot types carry those options as ids (`FUSSY_INTENSITY`, `TEMP_METHOD`, `MILESTONE_TYPE`,
  `SYMPTOM_TYPE`, `SYMPTOM_SEVERITY`; the spoken synonyms map to them); a test compares the model ids with the options. `other` is
  never offered for milestones and symptoms.
- **Numbers are validated, never invented.** A belly pain level (1-5), a temperature (30-45 C) and a missing value are asked for by the
  adapter (`PainLevelMissing`, `TemperatureMissing` prompts, which end the session) or answered `invalid_value`; pump amounts are
  1-500 ml each (the samples say "ml"). Temperatures, bath water included, are said in the user's unit system (docs/design/37) and
  stored in Celsius with one decimal; the answer tells them back in that system. A temperature answer is a fact: no threshold, no
  "fever", no "normal", no advice; the Symptom answer is "logged a symptom", nothing else.
- **Same write path as everything else:** the normal event service, `via`, an idempotent id from the request id, Owner, Parent or
  Caregiver only (a Viewer or Doctor is `not_allowed`). "Undo the last thing" looks at every built-in kind of entry, so the newest
  entry of the adapter is never skipped. Timers (tummy time, pump, belly massage, fussy, outdoor) start and are stopped in the app.
- **Medication by voice is limited to two things.** (1) `MedicationIntent`: that a dose of a medicine the family registered was
  given now. The medicine is matched by name among the baby's medicines with a prescription active on her local today; the entry
  copies what the family registered (name, prescription, the registered dose) as the app's "given" does, and nothing is computed,
  checked or judged (no interval, no "too early", no "safe"); the answer says "I recorded that a medication dose was given, as you
  told me. Lotties doesn't check or suggest doses." (2) `MedicationReminderIntent`: the family's own reminders, from the registered
  schedule through the app's own `MedicationStatusCalculator` (no weight, so never a suggested dose; as-needed prescriptions have
  none; no default interval): how many are due now and the next scheduled time. **Every** reminder answer, in Alexa and in the MCP
  text, ends with: "These are reminders of the medicines you registered in Lotties, not recommendations from Lotties. Check the
  prescription, and ask your doctor or pharmacist if you have doubts." ("São lembretes dos medicamentos que você cadastrou no
  Lotties, não recomendações do Lotties. Confira a receita e, em caso de dúvida, fale com o médico ou o farmacêutico."). No answer
  has an amount, unit, schedule or interval; the medicine name only with `sayMedicineNames`. No MCP tool exists for either
  (an AI assistant writes the arguments, and a medicine is the case where a wrong guess matters most): this is the owner's call to
  revisit.

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
- **What an assistant may say (data minimisation, LGPD art. 6 III and art. 46 §2).** An answer leaves Lotties: Amazon keeps
  it in the voice history, an AI assistant's provider receives it. So an answer is built from this list only:
  - **No baby name by default.** The result carries the name (`AssistantBaby.Name`, `AssistantBabyAccess.Name`) only when
    the user turned on `sayBabyName`; `AssistantSubject.Result` and `AccessOf` put it there, nowhere else. Without it Alexa
    says "the baby" / "o bebê" (en: "The baby drank 838 ml in 7 bottles today."; pt-BR drops "para X" tails that add nothing:
    "Registrei uma mamadeira de 118 ml às 23:28."), and the MCP text and structured JSON have no name member. The
    `list_babies` answer then has only `id`, `role`, `canLog`, `isDefault` (Alexa says how many babies and where to choose in
    Settings > Voice assistants), so with several babies and names off an AI assistant cannot tell them apart: the parent
    picks a default baby in the app or turns the names on.
  - **No free text people typed and no names of people**: never an appointment title, a formula name, a note, a custom
    milestone/symptom text. Formula bottles say "of formula". The fussy timer echoes only its validated intensity (mild,
    moderate, intense). The medicine is matched by name when the parent says it, and a medication dose is "a medication dose"
    unless the user turned on `sayMedicineNames` (default false, a second switch like `sayBabyName`): only then the name as the family
    registered it is spoken (Alexa, MCP text) and returned (`medicine`, `dueMedicines` in the structured JSON). **Never** an amount,
    dose, unit, schedule or interval, in either case (section 5.4).
  - **Nothing about a doctor or a clinic, except the specialty.** Forbidden in every spoken text, MCP text and structured JSON: a
    doctor's or professional's name, a clinic name, the appointment's title, location, notes or outcome, phone numbers, addresses,
    registration council/number/region, e-mail, any other text of an appointment or care provider. The one thing allowed is the
    **specialty**, and `CareProvider.Specialty` is free text, so it is said only when it normalises (case, accents, punctuation
    ignored, exact match) to one of `DoctorSpecialties` (Domain/Assistants): pediatrician, neonatologist, neurologist,
    neuropediatrician, cardiologist, dermatologist, ophthalmologist, ENT (otolaryngologist), orthopedist, gastroenterologist,
    allergist/immunologist, pulmonologist, endocrinologist, nutritionist, speech therapist, physiotherapist, psychologist, dentist,
    general practitioner (each with en-US and pt-BR spoken names and synonyms such as "pediatra", "pediatria", "neuro", "otorrino",
    "fono"). The Application resolves the appointment's linked provider (`providerId`, one of this baby's, not deleted) and puts only
    the CODE in the result (`appointment.specialty`); the typed text never leaves it. "The baby's next appointment is with a
    pediatrician, tomorrow at 3:15 PM." / "A próxima consulta do bebê é com pediatra, amanhã às 15:15."; without a recognised
    specialty: "The baby's next appointment is tomorrow at 3:15 PM." (a vaccination or exam keeps its kind: "a vaccination, ...").
  - **Facts from fixed vocabularies**: times, amounts, counts, durations, ages, diaper/feed kinds, built-in cry causes and
    red flags, the vaccine names of the published schedule (not typed by the family).
  - **Guards.** Adapters read a name only through `SpokenBaby` (`Lotties.Api/Assistants/SpokenBaby.cs`) and a medicine name only
    through `SpokenMedicine`; a source scan fails when an adapter reads a medicine member, an appointment or care provider member
    (title, doctor name, location, notes, outcome, clinic, phone, address, e-mail, registration), and the Application reads a
    provider's typed specialty only through `DoctorSpecialties.CodeOf`. Tests with distinctive doctor, clinic, phone and medicine
    strings assert none appears in any rendering of any command (JSON, en, pt-BR, MCP sentence, content and structured JSON). Tests
    (`AssistantNamePrivacyTests`) run every command through the service with the setting off and on and scan every
    rendering (Alexa en/pt-BR, MCP sentence, content, structured JSON); a source scan fails the build when an adapter
    reads `Baby.Name` or a listed baby's name outside `SpokenBaby`, when the application sets a name without `SayBabyName`,
    or when an adapter reads an appointment title, a formula or medication name.
- Account linking issues Keycloak tokens to Amazon for the Alexa client only (its own confidential client and secret,
  never in this repository). Unlinking the skill in the Alexa app, or removing the client's sessions in Keycloak,
  revokes it.

## 8. Adding an adapter (how the MCP server was added)

1. Authenticate the user the adapter's way (an MCP server behind the normal bearer auth already has
   `HttpContext.User`; a platform that sends a token elsewhere validates it with `IAccountLinkTokenValidator`), so
   `ICurrentUser` resolves her.
2. Map each tool or intent to one `IAssistantService` method; pass `AssistantInvocation(adapterName, requestId,
   fallbackZone)` with a request id the platform repeats on retries (or a fresh GUID when it has none: then retries may
   log twice).
3. Render `AssistantResult` (for MCP: return it as JSON; it is already language-neutral), and add the adapter's routes to
   `EndpointRoleMatrixTests` with a role and scope decision.
4. Never add a free-text field or advice. Medication is limited to section 5.4 (a dose given, as said; the family's own reminders, always with
   the not-a-recommendation sentence); no dose is ever computed, suggested or spoken.

## 9. The MCP adapter (`/api/v1/mcp`)

A remote MCP server, so an AI assistant the user chooses (Claude, any MCP client) can read the baby's log and, only if she
allows it, log events, by tool calls. It follows the MCP specification revision **2026-07-28**
(modelcontextprotocol.io/specification/2026-07-28: Streamable HTTP transport, Authorization) and also serves clients of
**2025-11-25** and earlier (the `initialize` handshake) on the same endpoint. It is built on the official C# SDK
`ModelContextProtocol.AspNetCore` 2.3.0 (Apache-2.0) in stateless mode: no `Mcp-Session-Id`, no GET stream, every POST
self-contained (the SDK checks `MCP-Protocol-Version`, `Mcp-Method`, `Mcp-Name` and the per-request `_meta`). Code:
`code/api/src/Lotties.Api/Assistants/Mcp/`.

### 9.1 Routes

| Route | What |
| --- | --- |
| `POST /api/v1/mcp` | the MCP endpoint (JSON-RPC: `initialize`, `server/discover`, `tools/list`, `tools/call`, `ping`) |
| `GET`, `DELETE /api/v1/mcp` | 405 `Allow: POST` (no stream, no session; never the API's fallback 401, which would send a client into a sign-in loop) |
| `GET /.well-known/oauth-protected-resource/api/v1/mcp`, `GET /.well-known/oauth-protected-resource` | RFC 9728 protected resource metadata: `resource` (the canonical URL), `authorization_servers` [the OIDC authority, the realm's issuer], `scopes_supported` [`lotties.read`, `lotties.write`], `bearer_methods_supported` [`header`], `resource_name`; public, any origin |

`Mcp:Enabled` false (the default): every one of them answers 404 before any authentication (`McpRequestGuard`), so a
disabled server looks like no route. The canonical URL is `Mcp:ResourceUrl` when set (recommended in production), else the
request's scheme and host (after the trusted proxy headers) plus `/api/v1/mcp`. The ingress sends
`/.well-known/oauth-protected-resource` to the API (deploy/homelab/manifests/ingress.yaml).

### 9.2 Authentication and scopes

- **Tokens**: OAuth access tokens Keycloak issues to the MCP client, in the `Authorization: Bearer` header only (never the
  query string). A third JWT bearer scheme, `McpTokens.SchemeName` ("Mcp"), is configured by the API's own
  `ConfigureJwtBearerOptions` (issuer from the discovery document, signing keys, lifetime, `sub` required) with one change:
  the audience is `Mcp:Audience` (default `lotties-mcp`, added by Keycloak's audience mapper on the two client scopes). It
  must differ from `AUTH_AUDIENCE` (startup fails otherwise): the web app's tokens never work on MCP, and the tokens an AI
  provider holds never work on the REST API (no token passthrough, no confused deputy). The user is mapped as for the web
  (issuer + `sub` through `ICurrentUser`).
- **401** without a valid token: `WWW-Authenticate: Bearer resource_metadata="<metadata URL>", scope="lotties.read"`
  (`error="invalid_token"` first when a token was sent). Clients start their sign-in from it, and asking for
  `lotties.read` only keeps the default read-only.
- **Scopes** (`McpScopes`, read from the token's space-separated `scope` claim or `scp` claims; independent, neither implies
  the other): `lotties.read` opens the read tools, `lotties.write` the logging tools. `tools/list` shows only the tools the
  token opens. A token with neither is **403** on every message; a `tools/call` of a tool whose scope the token lacks is
  **403** `WWW-Authenticate: Bearer error="insufficient_scope", scope="<missing>", resource_metadata=...` before the SDK
  runs (`McpScopeGate`: the body is read once, bounded, then handed on), so a client can step up; the tool runner checks
  the scope again.
- **Roles** are the command layer's, unchanged: writes need Owner, Parent or Caregiver (a Viewer holding `lotties.write`
  still gets `not_allowed`), the Caregiver rules of the event service apply, reads any family role, a user who is only a
  Doctor gets `not_allowed`, and a Doctor's patients never appear (not in `list_babies`, `unknown_baby` by id).

### 9.3 Tools

Every tool but `list_babies` takes an optional `babyId` (from `list_babies`; without it the baby choice of section 4
applies, and several babies answer `choose_baby`, whose text names `list_babies`) and an optional `timeZone` (an IANA id
the server knows, else `invalid_arguments`; it wins over the stored zone, section 5). Schemas are strict
(`additionalProperties: false`, exact JSON types, no coercion) and come from the same definitions the validator enforces
(`McpParameter`). Descriptions end with "Facts from the parents' own Lotties log, not medical advice." Hints: reads
`readOnlyHint: true`; writes `readOnlyHint: false`, `destructiveHint: false`, `idempotentHint: true`; all
`openWorldHint: false`.

| Tool | Scope | Arguments | Command |
| --- | --- | --- | --- |
| `list_babies` | read | none | `ListBabies` |
| `get_baby_profile` | read | `babyId?` | `ReadBabyProfile` |
| `get_last_feed` | read | `babyId?` | `ReadLastFeed` |
| `get_sleep_status` | read | `babyId?` | `ReadSleepStatus` |
| `get_diapers_today` | read | `babyId?` | `ReadDiapersToday` |
| `get_next_appointment` | read | `babyId?` | `ReadNextAppointment` |
| `get_due_vaccines` | read | `babyId?` | `ReadDueVaccines` |
| `get_day_summary` | read | `babyId?`, `date?` (YYYY-MM-DD) | `ReadDaySummary` |
| `get_week_summary` | read | `babyId?`, `endDate?` (YYYY-MM-DD) | `ReadWeekSummary` |
| `get_next_nap_window` | read | `babyId?` | `ReadNextNapWindow` |
| `get_next_feed` | read | `babyId?` | `ReadNextFeed` |
| `get_next_diaper` | read | `babyId?` | `ReadNextDiaper` |
| `get_diapers_average` | read | `babyId?` | `ReadDiapersAverage` |
| `get_bottle_average` | read | `babyId?` | `ReadBottleAverage` |
| `get_sleep_today` | read | `babyId?` | `ReadSleepToday` |
| `get_bottle_today` | read | `babyId?` | `ReadBottleToday` |
| `get_feeds_today` | read | `babyId?` | `ReadFeedsToday` |
| `get_last_diaper` | read | `babyId?` | `ReadLastDiaper` |
| `get_cry_reasons` | read | `babyId?` | `ReadCryReasons` |
| `request_delete_last_entry` | write | `babyId?`, `idempotencyKey?` | `RequestDeleteLast` (asks only, section 5.3) |
| `log_sleep_start` | write | `babyId?`, `idempotencyKey?` | `LogSleepStart` |
| `log_sleep_end` | write | `babyId?`, `idempotencyKey?` | `LogSleepEnd` |
| `log_bottle` | write | `babyId?`, `amountMl` (1-500), `kind?` (`formula`, `breast_milk`), `idempotencyKey?` | `LogBottle` |
| `log_nursing` | write | `babyId?`, `side?` (`left`, `right`), `idempotencyKey?` | `LogNursing` |
| `log_diaper` | write | `babyId?`, `kind` (`wet`, `dirty`, `both`), `idempotencyKey?` | `LogDiaper` |
| `log_bath` | write | `babyId?`, `temperatureC?` (above 0 up to 60), `idempotencyKey?` | `LogBath` |
| `log_tummy_time`, `log_nasal_suction` (`tool?`, `saline?`), `log_belly_massage` (`reason?`, `helped?`), `log_nail_trim` (`where?`), `log_spit_up` (`kind?`, `amount?`), `log_teething` (`stage?`, `tooth?`), `log_outdoor` (`kind?`), `log_skin_care` (`product?`) | write | `babyId?`, the listed choices (the event field's options), `idempotencyKey?` | `LogTummyTime`, `LogNasalSuction`, ... |
| `log_belly_pain` | write | `babyId?`, `level` (1-5, required), `idempotencyKey?` | `LogBellyPain` |
| `log_breast_pump` | write | `babyId?`, `amountLeftMl?`, `amountRightMl?` (1-500), `idempotencyKey?` | `LogBreastPump` |
| `log_fussy` | write | `babyId?`, `intensity?`, `whatHelped?`, `idempotencyKey?` | `LogFussy` |
| `log_temperature` | write | `babyId?`, `temperatureC` (30-45, required), `method?`, `idempotencyKey?` | `LogTemperature` (Celsius, a record only) |
| `log_milestone` | write | `babyId?`, `milestone?`, `idempotencyKey?` | `LogMilestone` |
| `log_symptom` | write | `babyId?`, `symptom?`, `severity?`, `idempotencyKey?` | `LogSymptom` (a record only) |

The choice arguments are enums built from the event types' own field options, so no free text can be sent. `invalid_value` is a tool
error. No medication tool (section 5.4), no dose, no free-text argument (nothing a model writes is stored as text), no advice.

**Idempotency.** The adapter's request id (what the event id derives from, section 5) is, for a write with an
`idempotencyKey` (8-64 of `[A-Za-z0-9._:-]`), `key:<hash of issuer and sub>:<key>`: the same key from the same user
answers the stored outcome and logs nothing again; the same key from another user is another event. Without a key every
call is new (`call:<random>`). The JSON-RPC id and the session are deliberately not used: MCP is stateless since
2026-07-28 (no session id) and JSON-RPC ids repeat across conversations and may be reused after a response, so they cannot
tell a retry from a genuine second bottle (a false replay would silently drop a log, worse than a double one). The tool
descriptions ask the model for a new key per action and the same key on a retry.

### 9.4 Results

`structuredContent` is the `AssistantResult` as JSON (camelCase, codes and enums snake_case, instants UTC, `timeZone` the
family's zone, null and empty members left out); `content` holds one short plain-English sentence and the same JSON as
text (MCP's backward-compatibility rule for structured results). The refusals `not_allowed`, `no_baby`, `choose_baby`,
`unknown_baby`, `rate_limited`, `invalid_amount`, `invalid_date` are tool errors (`isError: true`) carrying their code; so
are the adapter's own `invalid_arguments` (with `field`), `insufficient_scope`, `rejected` (a domain refusal, its code
only) and `internal_error`. Facts such as `sleep_already_running` are normal results. An unknown tool is a JSON-RPC
`-32602` error. Nothing beyond the baby's id and the user's own log is returned: no user ids, no stack traces, no exception
text. Outputs are bounded (at most five vaccine doses, seven days).

### 9.5 Safety and privacy

- Limits: the per-user `RequestLimits:AssistantPermitsPerMinute` (shared with Alexa) per `tools/call` (`rate_limited`);
  the global per-user HTTP limit counts the MCP user (the guard puts the MCP principal on the request before the rate
  limiter); the body is at most `Mcp:MaxRequestBodyBytes` (64 KiB, else 413); the request timeout applies.
- Origin (the Streamable HTTP DNS rebinding rule): a request with an `Origin` not in `Mcp:AllowedOrigins` is 403.
  Server-side clients (Claude's connectors) send none. CORS on the endpoint allows only those origins (none by default;
  exposes `WWW-Authenticate`, `Mcp-Session-Id`, `MCP-Protocol-Version`); the metadata documents allow any origin (public,
  GET only). The host header is the server's `AllowedHosts`.
- Logs: one line per tool call (tool name, result code, correlation id `HttpContext.TraceIdentifier`) and refusals by
  reason. Never arguments, idempotency keys, tokens, results or user ids; the SDK's own log categories are filtered to
  Warning. The command layer logs as for Alexa (adapter `mcp`, command, baby id, result code).
- The child's data goes to the AI provider the user connects: that is what the tools are for, and the consent screens and
  the Settings panel say so (docs/MCP.md has the texts in en and pt-BR). Read-only unless she grants `lotties.write`;
  revocable in the Keycloak account console, Applications. Short access tokens are recommended (5 minutes; the client
  refreshes).
- Web: Settings > Voice assistants shows an "AI assistants (MCP)" panel when `GET /me/assistant-settings` says
  `mcpEnabled` (with `mcpUrl`, the same canonical URL as the metadata): the URL with Copy URL, the privacy note, and Manage
  connected apps (the account console's Applications page of the configured authority).

## 10. Not verifiable here

Without Amazon: the real certificate chain and signature (tested with a chain generated in the test), the interaction
models' build in the developer console, entity resolution and dialog delegation behaviour, the account-linking flow
against Keycloak, the invocation name approval, certification. docs/ALEXA.md lists the console tests to run.

Without a real MCP client and Keycloak: the OAuth flow itself (discovery from the 401, client registration or the
pre-registered client, the consent screen texts, PKCE, the `resource` parameter, refresh), Keycloak's audience mapper and
`scope` claim in real tokens, Claude's connector UI and the scopes it asks for, a client's step-up after a 403, the ingress
route for the metadata path. The tests cover the server with tokens signed by a test key and the official SDK's client in
both protocol eras; docs/MCP.md lists the manual checks (MCP Inspector, Claude).

## Units (2026-10-25)

Answers are told, and bottle amounts are understood, in the user's unit system (stored setting, else the request locale, else metric); structured values stay metric. Contract, rounding, the `volumeUnit` slot and the MCP `amount` + `unit` parameters: docs/design/37-measurement-units.md section 6.
