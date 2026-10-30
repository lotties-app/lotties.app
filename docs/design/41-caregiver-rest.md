# 41. Caregiver rest estimate (design, 2026-10-30)

Status: **design only, nothing built.** Owner request, in the owner's words: the app could estimate when the parents
rested, starting from what is already logged about the baby (and later from smart watches, bands and rings), because
the family wants to see how a night with a baby is shared. Not legal advice: the privacy points below are a starting
point for the owner and a Brazilian lawyer.

The feature is called **rest**, never "sleep score" or "sleep tracking": it is a guess made from the baby's log, shown
as a range, and it measures nothing about the person.

## 1. Goals and non-goals

Goals:
- Show each person, for themselves only, a range for when they probably rested last night and for how long, from
  events that are already in the log (who logged what, and when the baby slept or woke).
- Let each person say when they work, so working hours are never counted as rest, and nothing is guessed about them
  while they are at work.
- Later, replace the guess with real data from a smart watch, band or ring, read on the device, with its own consent.

Non-goals (all of them, always):
- No sleep score, no target, no "you slept too little", no alert, no push, no advice, no diagnosis, no colours that
  judge. The app is a baby routine app, not a medical app.
- **No comparison between people.** Never "who slept more", never a shared ranking or a family total; a person's rest
  is not shown to the other parent, the family, a Doctor, an assistant (Alexa, MCP) or in an export or backup.
- No estimate is stored (it is computed when asked) and it is returned only to the person it is about (section 6).

## 2. The rules

Inputs: the baby's events (`Event.StartedAt`, `EndedAt`, type, `CreatedBy` = the account that logged it), the person's
own work windows, and constants (section 3). Everything is computed per person, per night, for babies the person
belongs to. A person's own events are those where `CreatedBy` is their account.

**R1. Night starts.** The parents mark the baby's sleep themselves, so there is no guessing of "bedtime": a baby sleep
event that starts inside the person's night window (section 3) is the baby going to bed, at the time the parents
logged. If the person is not inside a work window at that time, they are assumed to fall asleep **N minutes later**,
N being the value the person configured (for example 10, 20 or 30). This applies to every person who has the feature on, whether or not they logged anything: if the baby went to
bed and I did not log anything and I am not working, the estimate says I rested.

**R2. A person logs during the night.** After bedtime, the first event a person logs with the baby (feed, bottle,
diaper, fussy spell, bath, medicine, and so on) means that person is the one who got up. They are assumed to have woken
**about 20 minutes before that event**. Their rest is interrupted from that moment.

**R3. Back to sleep.** When a baby sleep event starts again inside the night window, a person who was awake falls
asleep **N minutes later** (the same configured value as R1). A person who logged nothing in between is assumed to have rested through.

**R4. Both get up.** If both people log events while the baby is awake, both are awake until the baby sleeps, then R3
applies to both.

**R5. Morning.** A person's rest ends at their first event of the day, minus the wake lead of R2. A person who logs
nothing is asked: once the baby's final wake of the night is logged and the person has logged nothing since bedtime,
the next time they open the app a message asks "Are you up for the day?" (yes now, yes since a time they pick, or not
yet). Their answer ends the rest at that moment, labelled "confirmed by you". "Not yet" asks again the next time the app
is opened. There is no push and no reminder. Until it is answered, the estimate ends at the baby's final wake (low
confidence, shown as such), or at the start of the person's work window if that is earlier.

**R6. Work windows.** A person is "not resting" inside their work windows, and R1 to R5 are not applied to them
there. A window can start before midnight and end after it, and windows repeat weekly (days of the week plus start and
end, in the person's time zone).

Worked example (N = 20 and wake lead 20 for both; baby goes to bed 21:00, mother logs 02:10 and 04:35, baby sleeps
again 02:40 and 05:00, father does not work at night and logs nothing):

| Person | Rest estimate |
| --- | --- |
| Mother | asleep ~21:20, up from ~01:50 (R2, 20 min before 02:10), asleep ~03:00 (R3), up from ~04:15 (R2), asleep ~05:20 |
| Father | asleep ~21:20, nothing interrupts him, ends when he answers the morning question or at the baby's final wake (R5) |

Times are shown as approximate ("about 21:20") and the parts are listed, for example "rested about 21:20 to 01:50 and
03:00 to 04:15", never as a measured minute.

## 3. Constants (defaults, each person can change them)

Each person sets the periods for themselves, because people fall asleep and wake at different speeds. They are
settings, not fixed rules; the defaults apply until the person changes them, and each person's own values are used only
for that person. Allowed values: 5 to 60 minutes (the owner's examples: 10, 20 or any N).

| Name | Default | Used by |
| --- | --- | --- |
| `fallAsleepMinutes` (one value N, after the baby's sleep starts) | 20 | R1, R3 |
| `wakeLeadMinutes` (before the person's own event) | 20 | R2, R5 |
| night window (local time, so a daytime nap is not read as the night; each person edits their own) | 19:00 to 07:00 | R1, R3 |

There is no automatic detection of the baby's bedtime and no minimum length: every baby sleep event the parents log
that starts inside the night window counts, short ones too (R3 uses them to know when the baby is asleep again).

Rules that ignore events: events imported from a file or backup (their author is a stand-in), events logged more than
15 minutes after they started (a backfill is not a sign someone was awake then), and events by a person whose feature
is off. These are checked with `CreatedAt` against `StartedAt`.

Twins or two babies in the family: the baby that is awake sets the rule; a person is resting only when every baby they
care for is asleep or they logged nothing for any of them.

## 4. Data and where it lives

Decision (owner, 2026-10-30): **the server holds the settings and does the calculation.**

- **Settings** (per person, on the server): `enabled` (default off), the time zone, the work windows, the night
  window and the two periods of section 3 (`fallAsleepMinutes`, `wakeLeadMinutes`), in a small
  per-user table that follows the pattern of `user_unit_settings` (`GET/PUT /me/rest-settings`). It is never in the baby
  backup and never in the sync; it needs an `AccountErasureTests` rule and an erasure step in `EfAccountDataEraser`, and
  a new EF migration (so a deploy of it takes a `pg_dump` first).
- **Morning answers** (R5): the only thing stored besides the settings. One small row per person and night holds the
  moment they said they were up (`PUT /me/rest/morning`), with the same rules as the settings table: erased with the
  account, never in the backup or sync, only the person can read or write it. It is optional; no answer means no row.
- **Estimates** are computed by the server from the baby's events, on request (`GET /me/rest?night=YYYY-MM-DD`), and
  are **not stored**: derived data is recomputed, so an edited or deleted event is always reflected and there is
  nothing to erase or leak later. The response holds only the ranges, their confidence and the constants used.
- The computation is one pure function in `Lotties.Domain` (no I/O, like the predictions), tested with fixtures like
  those above. There is no TypeScript twin: the web only draws the answer, so no shared vectors are needed.
- Access: the route reads only the caller's own account. No one else sees it: not another member, not the Owner, not a
  Doctor; no `BabyScope`, no assistant tool, no export. A row in `EndpointRoleMatrixTests` for each new route, and the
  consent gate applies as on every other route.
- Offline: the card shows the last answer the device received, marked as such, and asks for a connection to refresh.

## 5. What the person sees

A **tab in Insights** ("Rest" in English, "Descanso" in Portuguese), shown only to the person who turned the feature
on: last night as a range with its parts, labelled "Estimated from the baby's log, not a measurement", with the work
windows and the three periods editable from the same tab, and the morning question of R5 shown there when it applies. No history chart
before the owner decides one, no totals for the family, no comparison. Turning it off removes the card and deletes the
local settings. Every string through `t()` (en and pt-BR), dates and durations through the Intl helpers.

## 6. Privacy and consent

The estimate is information about when an adult rested: it can be read as health data, and the work windows say when a
person works. Therefore:
- Off by default; each person turns it on for themselves; nobody can turn it on for someone else.
- The server stores the person's work windows and time zone and reads the baby's log to compute the estimate. That is a
  new kind of stored data (the work windows) and a new use of data already held, so it is **not** a pure on-device
  flow: the policy content in both languages, `legal/dataFlows.ts`, the audit (docs/design/33-privacy-audit.md) and the
  policy version and date are updated in the same change, and `consentVersions.json` plus
  `Lotties.Domain.Consents.ConsentVersions` get a new entry if the meaning of the policy changes (tests fail otherwise).
  No third party is involved and nothing leaves our infrastructure. Never claim in the policy what the code does not do.
- The estimate is never written to a log, an event, the backup file, an assistant answer or a report; the work windows
  never appear in a log line. Account deletion removes the settings (erasure step and test above).
- A Doctor, another member and the Owner never see it, and the Owner cannot read it from the database through any
  application route.
- Whether a separate explicit consent, beyond the per-person toggle, is needed is a lawyer question (health-adjacent
  data about an adult, processed on the server); the design assumes the toggle plus the policy is enough until told
  otherwise, and the feature stays off for everyone until that is settled.

## 7. Phase 2: smart watches, bands and rings

A browser app cannot read these. It needs the native shell (`code/mobile`, docs/design/12-mobile-capacitor.md) and, on
iOS, HealthKit sleep analysis; on Android, Health Connect sleep sessions. Read-only, on the device, behind
`isNativeApp()` and lazy imports, with its own explicit opt-in and the platform permission prompt. Measured sessions
replace the guess for that person and are labelled as measured. Because the server does the calculation, the choice is
open: (a) read and show on the device only (nothing uploaded, simplest to defend), or (b) upload the sleep sessions to
a per-user table so every device shows the same answer (a new health-data flow with its own opt-in, erasure rule and
policy text). The owner chose to leave watches, bands and rings to phase 2 and to decide (a) or (b) then. Store review adds work: the
Play Health Connect declaration and the App Store health-data rules, and the policy gains the HealthKit/Health Connect
description. This phase starts only after phase 1 is used and the owner asks.

## 8. Edge cases

- Time zones and daylight saving: the night belongs to the person's stored time zone; a night that crosses the change
  is computed on UTC instants and displayed in local time.
- A person edits or deletes an event later: the estimate is recomputed on the next request (it is derived, not stored).
- A person who leaves a baby's family: that baby's events stop counting for them from then on.
- Sleep of the baby logged late or with a running timer: a running sleep is open-ended, so R3 waits until it starts or
  ends; the estimate marks the last part as "ongoing".
- A person with only the Viewer role cannot log events, so only R1 and R5 apply to them.
- A baby with no sleep logged inside the night window: no estimate that night (shown as "not enough in the log"), never
  a guess from nothing.
- The parents log the baby's sleep late (after the baby fell asleep): the logged start time is used, not the moment of
  logging; the 15-minute backfill rule only decides whether a person's own event proves they were awake.

## 9. Tests

Fixtures for each rule and the worked example, overnight work windows, daylight saving, backfilled and imported events,
twins, a Viewer, a person with the feature off. API tests (SQLite): a person reads only their own estimate, another
member, the Owner and a Doctor get nothing, the feature off returns nothing, the routes are in `EndpointRoleMatrixTests`
and the consent gate, the settings are removed by account erasure (`AccountErasureTests`), and the backup file never
holds them.

## 10. Owner decisions

1. ~~The periods and bedtime~~ Decided: the parents log the baby's sleep; each person configures N minutes after it to
   count as asleep (default 20) and the lead before waking (default 20). The night window defaults to 19:00 to 07:00
   and each person can change it for themselves. Dropped: the 20 to 30 range (single value N only).
2. ~~Where the work windows live~~ Decided: a per-user server table, and the server computes the estimate.
3. ~~The end of rest for someone who logged nothing~~ Decided: the app asks "Are you up for the day?" (R5).
4. ~~Where it goes~~ Decided: a tab in Insights, named "Rest" / "Descanso".
5. Whether to ask the lawyer about a separate consent before phase 1 ships.
6. ~~Whether phase 2 is wanted~~ Decided: yes, as phase 2 (watches, bands, rings); device-only or uploaded is decided then.
