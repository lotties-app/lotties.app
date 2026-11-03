# Voice commands: what you can say to Siri, Alexa and Android

What each voice assistant understands, what Lotties does and what you hear back. The same list is in the app:
**Settings > Voice assistants > Voice commands** (`/settings/voice-commands`), one tab per assistant, in English and
Portuguese, and on the public page `/voice-commands` (no sign-in, linked from the landing footer; same screen and
catalog). Everything here is taken from the code (sources at the end); the drift test
`code/web/src/assistants/voiceCommands.test.ts` fails when an Alexa intent, a Siri phrase, an Android shortcut or an
MCP tool is added or removed without updating the in-app list.

Sample answers are the server's real sentences (the Alexa wording; Siri and Android say the same sentence) with
made-up times and amounts. Without "Say my baby's name in answers" the baby is "the baby" / "o bebê" (pt-BR answers
then simply leave the name out: "Registrei uma fralda de xixi às 15:15.").

## 1. Status per assistant (be honest)

| Assistant | Status | What the user must do |
| --- | --- | --- |
| **Alexa** | Built (skill endpoint, en-US and pt-BR models in `alexa/`). The API side is **off by default** (`Alexa__Enabled=true` turns it on), and the skill only exists for users once the owner creates it in the Amazon console and (for the public) certifies it (docs/ALEXA.md). | Enable the Lotties skill in the Alexa app and link the Lotties account. |
| **Siri** (iPhone) | Built in the iOS app: 8 spoken App Shortcuts (11 phrases) plus about 45 intents in the Shortcuts app and Spotlight, each one an MCP tool call. Needs the MCP server on and the Keycloak client of docs/MCP.md 3.4. | Settings > Voice assistants > Siri and Shortcuts > Connect Siri. |
| **Android** | Built in the Android app: 12 launcher shortcuts (touch and hold the icon, or pin to the home screen); the answer is shown in a Toast and spoken with TextToSpeech. Compiled and unit tested, **not run on a device** (design 37 section 14.4). Needs the Keycloak client of docs/MCP.md 3.5. | Settings > Voice assistants > Voice on Android > Connect voice. |
| **Google Assistant / Gemini** | **Unverified.** `shortcuts.xml` declares the App Action `actions.intent.OPEN_APP_FEATURE` with the 12 shortcuts as inventory ("Hey Google, open wet diaper in Lotties" / "Ok Google, abrir xixi no Lotties"). It needs a Play Console release and Google's review, Google may choose not to surface it, and on phones where Gemini replaced Google Assistant it is not known whether App Actions of third-party apps still run. A log started this way asks for one tap ("Log this now?"). | Nothing beyond the Android setup; may simply not work. |

What is certain on Android: the launcher shortcuts. Everything that depends on Google is marked unverified.

## 2. Safety facts (shown in the app under "Good to know")

- Answers are facts and estimates from the family's own log, never a diagnosis or medical advice.
- **Why is the baby crying** always ends with the red flags: call the pediatrician or emergency services for a fever
  (babies under 3 months need a call right away), crying you cannot soothe, refusing feeds, unusual sleepiness or
  being hard to wake, a bulging or stiff soft spot.
- **Medicines:** no assistant computes, checks or suggests a dose, or speaks an amount, unit or schedule. Only Alexa
  has medicine commands: record that a dose of a medicine registered in Lotties (an active prescription) was given, and
  read the family's own reminders. Every reminder answer ends with "These are reminders of the medicines you registered
  in Lotties, not recommendations from Lotties. Check the prescription, and ask your doctor or pharmacist if you have
  doubts." The logged-dose answer ends with "Lotties doesn't check or suggest doses." Siri, Android and the MCP server
  have no medicine command or tool by design.
- **Names:** answers say "the baby" unless "Say my baby's name in answers" is on (default off); medicine names only
  with "Say the names of my medicines in answers" (default off). Nothing anyone typed (notes, appointment titles,
  formula names, a doctor's or clinic's name, place, phone) is ever said; an appointment is described only by a known
  specialty ("with a pediatrician") or its kind.
- **Undo** never deletes: it marks the newest entry that *the same assistant* logged in the last 30 minutes as "asked to
  delete", and a person approves or keeps it in the app. If that newest entry is a wake-up, nothing changes ("can't be
  undone by voice"); an entry made by another assistant or in the app is never chosen.
- Voice needs the internet: offline, nothing is logged (Siri and Android say so).
- Several babies: choose the one voice commands are about in Settings > Voice assistants.
- Units: what is said follows the person's units setting (Alexa takes ml or ounces for a bottle; temperatures are
  spoken in °F with US units). Siri and Android ask for ml and °C.

## 3. Alexa

Start with "Alexa, open lotties" (pt-BR: "Alexa, abrir lotes") and then the phrase, or in one go: "Alexa, tell lotties
the baby fell asleep" ("Alexa, peça ao lotes: o bebê dormiu"; recognised less often in Portuguese, docs/ALEXA.md 1).
"Help" lists what you can do. A missing value is asked for (diaper content, pain level, temperature, medicine name).

### 3.1 Log

| Intent | English example | Portuguese example | What it does | Sample answer (en) |
| --- | --- | --- | --- | --- |
| SleepStartIntent | the baby fell asleep | o bebê dormiu | Starts a sleep timer; nothing changes if one runs | Got it. The baby fell asleep at 1:10 PM. |
| SleepEndIntent | the baby woke up | o bebê acordou | Ends the running sleep, logs the wake-up | The baby woke up at 2:25 PM, after sleeping 1 hour and 15 minutes. |
| BottleIntent | log a 120 ml bottle of formula | registrar mamadeira de 120 mililitros de fórmula | Bottle now (ml or ounces; formula or breast milk); timer instead with "Time bottle feedings" on | Logged a 120 ml bottle of formula at 3:15 PM for the baby. |
| NursingIntent | start nursing on the left side | começar amamentação no peito esquerdo | Nursing timer; side said, else opposite of the last feed | Nursing started on the left side for the baby at 3:15 PM. |
| DiaperIntent | log a wet diaper (wet, dirty, both) | registrar fralda de xixi (xixi, cocô, os dois) | Diaper now | Logged a wet diaper for the baby at 3:15 PM. |
| BathIntent | log a bath / water was 37 degrees | registrar banho / a água estava a 37 graus | Bath now, water temperature if said | Logged a bath for the baby at 7:00 PM, water at 37 degrees. |
| TummyTimeIntent | start tummy time / log 15 minutes of tummy time | iniciar tempo de bruços / registrar 15 minutos de tempo de bruços | Timer, or a finished session with minutes | Logged 15 minutes of tummy time for the baby. |
| BreastPumpIntent | start pumping / pumped 100 ml on the left | começar a ordenhar / ordenei 100 ml no peito esquerdo | Pump timer with ml per side; minutes = finished | Breast pump session started for the baby at 6:00 AM. |
| BellyMassageIntent | log belly massage / belly massage for 10 minutes | fiz massagem na barriga dela / massagem na barriga por 10 minutos | Timer, or finished with minutes | Logged 10 minutes of belly massage for the baby. |
| FussyIntent | she's fussy / she was fussy for 20 minutes | ela está irritada / ela ficou irritada por 20 minutos | Fussy timer (intensity mild/moderate/intense if said), or finished | Logged 20 minutes of fussy time for the baby. |
| OutdoorIntent | went outside / log 30 minutes of outdoor time | saímos para passear / passeamos por 30 minutos | Timer, or finished with minutes | Logged 30 minutes of outdoor time for the baby. |
| NasalSuctionIntent | used the nasal aspirator | usei o aspirador nasal | Logs it now | Logged nasal suction for the baby at 3:15 PM. |
| NailTrimIntent | trimmed her nails | cortei as unhas dela | Logs it now | Logged a nail trim for the baby at 3:15 PM. |
| SkinCareIntent | put on diaper cream | passei pomada de assadura | Logs it now | Logged skin care for the baby at 3:15 PM. |
| SpitUpIntent | she spit up | ela regurgitou | Logs it now | Logged spit-up for the baby at 3:15 PM. |
| TeethingIntent | she's teething | ela está dentando | Logs it now | Logged teething for the baby at 3:15 PM. |
| MilestoneIntent | she rolled over / baby smiled for the first time | ela virou de bruços / o bebê sorriu pela primeira vez | Milestone from a fixed list (first smile, laughed, held head up, rolled over, sat up, crawled, stood up, first steps, first word) | Logged a milestone for the baby at 3:15 PM. |
| SymptomIntent | she has a cough | ela está com tosse | Symptom from a fixed list (cough, runny nose, congestion, rash, diarrhea, constipation), severity if said; a record only | Logged a symptom for the baby at 3:15 PM. |
| TemperatureIntent | her temperature is 37.5 | a temperatura dela é 37,5 | Reading as said, in the units setting; never judged, no fever threshold | Logged a temperature of 37.5 degrees for the baby at 3:15 PM. |
| BellyPainIntent | belly pain level 3 | dor de barriga nível 3 | Level 1 to 5 as said; a record only | Logged belly pain for the baby at 3:15 PM, intensity 3. |

### 3.2 Ask

| Intent | English example | Portuguese example | Sample answer (en) |
| --- | --- | --- | --- |
| LastFeedIntent | when was the last feed | quando foi a última mamada | The baby's last feed was a 120 ml bottle of formula, at 3:15 PM, 2 hours ago. |
| LastDiaperIntent | when was the last diaper change | quando foi a última troca de fralda | The baby's last diaper was a wet diaper, at 3:15 PM, 40 minutes ago. |
| SleepStatusIntent | is the baby sleeping | há quanto tempo ela está dormindo | The baby has been sleeping since 1:10 PM, for 45 minutes. |
| DiapersTodayIntent | how many diapers today | quantas fraldas hoje | The baby has had 6 diapers today: 5 wet and 2 dirty. |
| FeedsTodayIntent | how many feeds today | quantas mamadas hoje | The baby has had 7 feeds today: 4 bottles and 3 nursing sessions. |
| BottleTodayIntent | how much did she drink today | quanto ela tomou de mamadeira hoje | The baby drank 480 ml in 4 bottles today. |
| SleepTodayIntent | how much did she sleep today | quanto ela dormiu hoje | The baby has slept 4 hours and 30 minutes today, with 3 naps. |
| DaySummaryIntent | how was her day | como foi o dia dela | So far today, the baby slept 4 hours and 30 minutes with 3 naps, had 6 feeds with 480 ml in bottles, and 5 diapers. |
| WeekSummaryIntent | how was her week | como foi a semana dela | In the 7 days up to November 3, the baby slept ... with ... naps, had ... feeds with ... ml in bottles, and ... diapers. |
| NextNapWindowIntent | when is the next nap | quando é a próxima soneca | The baby's next nap window is probably between 2:10 PM and 3:00 PM. |
| NextFeedIntent | when is the next feed | quando é a próxima mamada | The baby's next feed is expected around 5:30 PM, usually between 5:00 PM and 6:00 PM. |
| NextDiaperIntent | when is the next diaper change | quando é a próxima troca de fralda | The next wet diaper is expected around 4:00 PM, usually between 3:30 PM and 4:30 PM. |
| DiapersAverageIntent | how many diapers does she use a day | quantas fraldas ela usa por dia | Over the last 7 days with diapers, the baby used about 7.3 diapers a day: about 6 wet and 2.1 dirty. |
| BottleAverageIntent | how much does she usually drink | quanto ela costuma tomar de mamadeira | The baby's last 5 bottles averaged 130 ml, and the last one was 120 ml. (Facts, not a recommendation; also matches "how much should I make for the next bottle".) |
| NextAppointmentIntent | when is the next appointment | quando é a próxima consulta | The baby's next appointment is with a pediatrician, tomorrow at 9:00 AM. |
| DueVaccinesIntent | which vaccines are due | quais vacinas estão pendentes | By the vaccine schedule, the baby has 2 vaccine doses due, 1 of them overdue: (names). You can see them in the app. |
| CryReasonsIntent | why is the baby crying | por que o bebê está chorando | From what is logged for the baby: hunger looks likely: the last feed was 3 hours ago, and the usual gap is about 2 hours and 30 minutes. This is not a diagnosis or medical advice. Call your pediatrician or emergency services if there is (red flags). |
| BabyProfileIntent | how old is the baby | qual a idade dela | The baby is 4 months old. |
| ListBabiesIntent | list my babies | listar meus bebês | You have 2 babies in Lotties. To choose the one voice commands are about, open the app, then Settings, Voice assistants. (Names only with the name setting on.) |
| SetBabyHelpIntent | switch baby | trocar de bebê | To choose the baby voice commands are about, open the Lotties app, then Settings, Voice assistants. |
| PanelIntent | show the night panel | abrir o painel noturno | Echo with a screen: the night panel (sleep, last feed and next estimate, last diaper, next nap window), no sentence. Speaker: a short spoken summary (sleep, last feed, last diaper). |

Note for Portuguese: "ela está dormindo" / "ele está dormindo" are samples of **SleepStartIntent** (they log a sleep);
ask "há quanto tempo ela está dormindo" to hear the status.

### 3.3 Undo

| Intent | English | Portuguese | Sample answer (en) |
| --- | --- | --- | --- |
| RequestDeleteLastIntent | undo the last entry | desfazer o último registro | I asked to delete the baby's last diaper change, at 3:15 PM. Nothing was deleted: open the Lotties app to approve it or keep it. Other answers: "I can't find an entry you logged by voice in the last 30 minutes, so nothing was changed."; for a wake-up: "... That can't be undone by voice, so nothing was changed." |

### 3.4 Medicines (Alexa only)

| Intent | English | Portuguese | Sample answer (en) |
| --- | --- | --- | --- |
| MedicationIntent | gave her (medicine name as registered) | dei (nome do remédio) para ela | I recorded that a medication dose was given to the baby at 8:00 AM, as you told me. Lotties doesn't check or suggest doses. If the name is not an active prescription: "I can't find that medicine among the active prescriptions registered for the baby in Lotties, so nothing was recorded. Check the app." |
| MedicationReminderIntent | is any medicine due | tem algum remédio para dar | One medicine reminder you registered in Lotties is due now for the baby. The next one is today at 8:00 PM. These are reminders of the medicines you registered in Lotties, not recommendations from Lotties. Check the prescription, and ask your doctor or pharmacist if you have doubts. |

## 4. Siri (iPhone)

iOS allows ten spoken App Shortcuts per app; Lotties registers 8 (11 phrases). Siri understands **only these
phrases** (ending in "in Lotties" / "no Lotties"); a number cannot be inside a phrase, so Siri asks for it next.
Every other action (about 45 in all) is in the Shortcuts app and Spotlight: run it there, or put it in a shortcut of
your own and say that shortcut's name.

| Shortcut | English phrase | Portuguese phrase | What it does |
| --- | --- | --- | --- |
| Diaper | Log a {wet/dirty/both} diaper in Lotties; Log a diaper in Lotties; Diaper change in Lotties | Registrar fralda de {xixi/cocô/os dois} no Lotties; Registrar fralda no Lotties; Troca de fralda no Lotties | Diaper now (wet when the content is not said) |
| Bottle | Log a bottle in Lotties | Registrar mamadeira no Lotties | Asks "How many ml?", logs a **formula** bottle (the shortcut's default content) |
| Breastfeed | Start a breastfeed in Lotties | Iniciar mamada no Lotties | Nursing timer, side opposite of the last feed |
| Sleep | Baby {fell asleep/woke up} in Lotties | O bebê {dormiu/acordou} no Lotties | Starts a sleep, or ends the running one |
| Activity | Log {activity} in Lotties; Start {activity} in Lotties | Registrar {atividade} no Lotties; Iniciar {atividade} no Lotties | Bath, tummy time, belly massage, nasal suction, nail trim, skin care, outdoor time, fussy, spit-up, teething, breast pump; the five timed ones ask "How many minutes? Say zero to start a timer." |
| Health | Log {temperature/symptom/belly pain} in Lotties | Registrar {temperatura/sintoma/dor de barriga} no Lotties | Asks the °C or the level 1 to 5; the symptom is logged without saying which |
| Ask | Ask {topic} in Lotties | Perguntar {assunto} no Lotties | Last feed, next nap window, next feed, next diaper change, last diaper, diapers today, bottles today, feeds today, sleep today, day summary, week summary, next appointment, vaccines due |
| Undo | Undo the last entry in Lotties | Desfazer o último registro no Lotties | Asks to delete the last entry Siri logged (see section 2) |

Answers: the same sentences as Alexa (section 3). Failures are local: "Connect Siri in Lotties: Settings, Voice
assistants.", "Cannot reach Lotties now. Nothing was logged.", "Lotties did not answer. Try again."
In the Shortcuts app only (no phrase): why is the baby crying, is the baby asleep, diapers per day, usual bottle, baby
profile, my babies, milestone, and one intent per log (bath, symptom, ...). No medicine shortcut, no timer stop.

## 5. Android (launcher shortcuts; Google Assistant unverified)

Touch and hold the Lotties icon (the launcher shows the first four or five), or pin any of them to the home screen.
Launcher shortcuts log at once; a choice is a list (no free text). The answer is the server's sentence, shown in a
Toast and spoken aloud in the app language.

| Shortcut id | English label | Portuguese label | What it does |
| --- | --- | --- | --- |
| diaper_wet / diaper_dirty / diaper_both | Log a wet diaper / dirty / wet+dirty | Registrar fralda de xixi / de cocô / xixi e cocô | Diaper now |
| bottle | Log a bottle | Registrar mamadeira | Pick 30 to 240 ml (step 30); logs a bottle without content |
| breastfeed | Start a breastfeed | Iniciar amamentação | Nursing timer |
| fell_asleep / woke_up | Baby fell asleep / Baby woke up | O bebê dormiu / O bebê acordou | Starts / ends a sleep |
| activity | Log an activity | Registrar atividade | Pick one of the 11 activities; the five timed ones offer Start timer, 5, 10, 15, 20, 30, 45, 60 minutes |
| health | Log a health item | Registrar item de saúde | Temperature (pick 36.0 to 40.0 °C by 0.2), belly pain 1 to 5, or symptom |
| ask_last_feed | When was the last feed? | Quando mamou por último? | Says the last feed |
| ask | Ask about the baby | Perguntar sobre o bebê | Pick one of the 13 questions of the Siri "Ask" list |
| undo | Undo the last entry | Desfazer último registro | Asks to delete the last entry Android voice logged |

Google Assistant (unverified, see section 1): "Hey Google, open {label} in Lotties" / "Ok Google, abrir {rótulo} no
Lotties", matching the long or short label of a shortcut (for example "wet diaper", "xixi"). No medicine shortcut.

## 6. What is not possible by voice

- Medicine doses, amounts or advice, on any assistant; medicine commands at all on Siri, Android and MCP.
- Deleting anything: assistants only ask, a person approves in the app.
- Free text (notes, names, titles): every value is a number or an option of the event's own field.
- Stopping or pausing a running timer by voice (except ending a sleep): stop it in the app.
- On Siri, a number inside the phrase ("15 minutes of tummy time"): Siri asks for it after.

## 7. Not confirmed from the sources

- Google Assistant / Gemini App Actions: nothing confirms they run (design 37 section 14.2 to 14.4).
- Android as a whole has not run on a device; the Alexa night panel has not run on a real Echo (design 42).
- Whether the Alexa skill is live for a given user depends on the owner's Amazon console setup and certification,
  which the repository cannot show.
- Sample answers are rendered from the code's sentence templates by hand (example times and amounts); the exact
  duration wording of long totals (week summary) was not run.

## Sources

`alexa/interaction-model.en-US.json`, `alexa/interaction-model.pt-BR.json`;
`code/api/src/Lotties.Api/Assistants/Alexa/AlexaSkill.cs`, `EnglishAlexaLanguage*.cs`, `PortugueseAlexaLanguage*.cs`;
`code/api/src/Lotties.Api/Assistants/Mcp/McpToolCatalog.cs`; `code/api/src/Lotties.Application/Assistants/AssistantService.cs`
(undo rule); `code/mobile/ios/App/App/LottiesShortcuts.swift`, `LottiesSiriIntents.swift`, `en.lproj` and `pt-BR.lproj`
`AppShortcuts.strings`, `pt-BR.lproj/Localizable.strings`; `code/mobile/android/app/src/main/res/xml/shortcuts.xml`,
`res/values*/voice_strings.xml`, `java/app/lotties/app/voice/VoiceCatalog.kt`, `VoiceActivity.kt`, `VoiceRunner.kt`;
docs/design/32-assistants.md, docs/design/37-widgets-siri.md (sections 8 and 14), docs/design/42-echo-show-panel.md,
docs/ALEXA.md, docs/MCP.md.
