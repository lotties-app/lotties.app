# 42. Echo Show night panel

Status: option A (APL skill screen) built 2026-11-01, not yet tried on a real device (sections 8 and 9). Option B not built. Owner device: Echo Show 5 (small screen, about 960x480 landscape). Builds on the Alexa
adapter of [32-assistants.md](32-assistants.md); no new command logic.

## 1. Goal

A screen that stays on at night, dark and dim, showing the few things a parent wants at a glance at 3 a.m. without
unlocking a phone: time since the last feed, since the last diaper, whether the baby is asleep and for how long, and
the next likely nap or feed. Facts and the family's own estimates only, never advice (same rule as the rest of the app).

## 2. What the panel shows

One screen, large type, low contrast on black, no animation, no photos:

| Tile | Content | Source command |
| --- | --- | --- |
| Sleep | asleep since HH:MM (duration) or awake for N min | `ReadSleepStatus` |
| Feed | last feed HH:MM (N min ago); next estimate HH:MM | `ReadLastFeed`, `ReadNextFeed` |
| Diaper | last change HH:MM (N min ago) | `ReadLastDiaper` |
| Nap | next window HH:MM | `ReadNextNapWindow` |

Clock shown small in a corner. Units follow the person's setting (`AssistantResult.Units`). A tile whose answer is
`consent_required`, empty or an error shows a dash, never a stale number.

## 3. Privacy rules (inherited, not new)

- The screen is in a room, visible to guests: no baby name unless `sayBabyName` is on, no medicine names, no free
  text, no names of people, nothing about a doctor or clinic. Read names only through `SpokenBaby` / `SpokenMedicine`.
- No medication tile in version 1.
- No dose, no advice, no "normal / abnormal" wording. Estimates carry the existing "estimate from your log" label.
- Reviewed when built (option A): the screen shows the same facts as the spoken answers, from the same read commands, to
  the same recipient (Amazon, the user's own device), under the same name rules, so the policy, `legal/dataFlows.ts` and
  the version did not change; the conclusion is noted in audit 33 (row 70). Option B (a web page with a pairing token) is a
  new data flow and must update the policy (both languages), `legal/dataFlows.ts`, audit 33 and the policy version.

## 4. How it stays on (needs a decision)

A custom Alexa skill screen is not meant to stay up all night. Options, to be verified against the current Amazon
documentation before choosing (limits below are from memory, not checked):

| Option | How | Problem |
| --- | --- | --- |
| A. APL skill screen | "Alexa, open lotties panel" renders an APL document, refreshed by the skill | Skill sessions end; the APL idle timeout is limited (about 30 min at most, verify), so it drops back to the Alexa home screen. Re-launch by routine or voice. |
| B. Silk browser page | Echo Show 5 opens a Lotties `/panel` web page in its browser, fullscreen | No Alexa limits and fully our own layout, but a wall device needs a login. Needs a read-only pairing token (section 5). Browser may sleep or be closed by the device. |
| C. A then B fallback | Ship A first (reuses the Alexa link, no new auth), add B if A drops too often | Two surfaces to keep in step. |

Recommendation: start with A (smallest, reuses account linking and the command layer), measure how long it really
stays up, and only build B if that is not enough.

## 5. If option B (panel page) is chosen

- Route `/panel`, no shell, no navigation, dark theme forced, text size by viewport, wake lock requested.
- Auth by a device pairing code: Owner/Parent creates it in the app, scoped to one baby, read-only, revocable, listing
  only the tiles above. Stored hashed like board API keys (`lbk_` style), secret shown once. Never a full account
  session on a shared wall device.
- Pairing tokens are account-level data: erased with the account (rule in `AccountErasureTests.Rules` and
  `EfAccountDataEraser`), never in the backup, never logged, route rows in `EndpointRoleMatrixTests`.
- Polls the existing read commands; no new data stored.

## 6. Open decisions

1. Option A first (recommended) or straight to B.
2. Does the baby's name show by default on the panel? Default follows `sayBabyName` (off).
3. Night schedule: only shown between configured hours, or always when launched.
4. Which Echo Show models to support (5 is the target; larger screens only scale).

## 7. Out of scope

Camera, audio monitoring, push alerts to the screen, controlling the device from the app, medication tile, charts.

## 8. Built: option A

- Intent `PanelIntent` (en-US "open the panel", "show the night panel", "night mode"; pt-BR "abrir o painel", "modo noturno"),
  a read intent with no slots. In `AlexaSkill` it takes the same path as every command: account-linking token (none or
  invalid = the LinkAccount card), the per-user assistant limit, then the existing `ReadSleepStatus`, `ReadLastFeed`,
  `ReadNextFeed`, `ReadLastDiaper`, `ReadNextNapWindow`, one after the other. The adapter adds no command logic; `AlexaPanel`
  only lays the results out.
- A device that reports `Alexa.Presentation.APL` in `context.System.device.supportedInterfaces` gets an
  `Alexa.Presentation.APL.RenderDocument` directive and no speech (it is night), `shouldEndSession=false`, no reprompt. A
  device without a screen hears the usual sentences of the sleep, last feed and last diaper answers.
- The document (`Panel/panel.apl.json`, embedded; copy in `alexa/apl-night-panel.json`, a test keeps them equal) is static and
  language-neutral: near-black background, dim grey and amber text, no animation, no image; sizes in `vh`/`vw`, so it is laid
  out for 960x480 (Echo Show 5) and scales up. Its texts and numbers come from the datasource, built in the request's language
  (`IAlexaLanguage.Panel`, `ClockOf`; clock times in the user's zone like the speech, durations as "45 min" / "2 h 05 min").
- Tiles: Sleep (duration, "asleep since" / "awake since"), Feed (last time, "N min ago", next feed as an estimate from the
  log), Diaper (last time, "N min ago"), Nap (next window, marked as an estimate from the log), and a small clock and a
  "not updated" mark in the header. The header shows the baby's name only through `SpokenBaby` (`sayBabyName`), else "Lotties".
  A tile whose result is not the success code of its read (`consent_required`, no baby, no data, error) shows a dash. No
  medication tile, no free text, no advice, no "normal" wording. No measures are shown, so units do not matter yet (a bottle
  amount would go through `AssistantResult.Units`).
- Refresh: the document runs `SendEvent` (argument `panelRefresh`) after 60 s in a repeating `Sequential` (`onMount`); the skill
  receives `Alexa.Presentation.APL.UserEvent` and answers a new RenderDocument with fresh data (session still open). The
  document asks for `settings.idleTimeout` of 30 minutes.
- Rate limit: a render or a refresh costs one permit of the user's `AssistantPermitsPerMinute` window (30 by default), not one
  per read, so the panel uses about 1 of 30 a minute. If a refresh is refused anyway (the person used the other 29 that minute),
  the skill answers an `ExecuteCommands` that only sets the small "not updated" text, so the last screen stays and is never
  replaced by a blank one or a spoken error; the next minute's refresh clears it. A first `PanelIntent` over the limit speaks
  the usual "try again in a minute".
- Logs: request type, known intent name (`PanelIntent` is in `KnownIntents`), and the outcome `panel:N/4` (tiles with a fact),
  `panel:speech` or `panel:stale`. Never the screen text, slots, tokens or ids.
- `SessionEndedRequest` and any other unknown request type already answer an empty response; a UserEvent with another argument too.

## 9. Not verified, and the owner's test on the Echo Show 5

Written from memory of Amazon's APL documentation, without a device or the console: check each against the current docs.

- `settings.idleTimeout` of 1800000 (30 min) as the maximum the screen stays, and whether a refresh `UserEvent` and re-render
  count as activity and restart that timer. Expect the screen to drop to the Alexa home screen after some time; the real time
  is what this build is meant to measure (the reason to build option A first, section 4).
- That the session stays open without speech or reprompt while the document is on screen, and that a long `Sequential` with
  `repeatCount` 600 and a `delay` on `SendEvent` keeps firing; and that a new RenderDocument stops the old document's commands.
- APL version "1.9", `wrap`, `vh`/`vw` units and `SetValue` on a Text `text` property on the Echo Show 5.
- The `ExecuteCommands` token: the directive uses the same token as the RenderDocument (`lotties-panel`).
- The clock is the time of the last render (up to a minute old), not a live clock.

Checklist (owner):

1. Developer console > Build > Interfaces: turn on Alexa Presentation Language, Save Interfaces.
2. Paste both interaction models (`alexa/`), Save Model, Build Model, no warning.
3. Optionally preview `alexa/apl-night-panel.json` in the APL authoring tool (viewport Hub Round/Small landscape).
4. On the Echo Show 5: "Alexa, open lotties", then "open the panel" (pt-BR: "abrir o painel"). Expect the dark panel, no sound.
5. Four tiles with the last feed, diaper, sleep state and the estimates; the estimates say they are from the log; no baby name
   unless Settings > Voice assistants > say the name is on; no dash while the data exists.
6. Log a feed in the app; within about a minute the Feed tile changes with no touch.
7. Note how many minutes the panel stays before it drops to the home screen, with and without the room light, and say whether
   re-launching by a routine is acceptable; if not, option B (section 5) is next.
8. Say "open the panel" on a speaker without a screen: a short spoken summary.
9. Revoke the account link in the Alexa app: the panel asks to link the account.
