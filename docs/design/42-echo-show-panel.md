# 42. Echo Show night panel

Status: design, nothing built. Owner device: Echo Show 5 (small screen, about 960x480 landscape). Builds on the Alexa
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
- Showing baby data on a shared device is a new data flow: update the privacy policy (both languages),
  `legal/dataFlows.ts`, audit 33 and the policy version when this is built.

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
