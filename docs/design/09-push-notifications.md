# Push notifications: self-hosted Web Push with VAPID (design, 2026-10-21)

Status: design only, nothing implemented. Owner decisions: Web Push sent by our own .NET API with VAPID (RFC 8292), no FCM SDK, OneSignal or other paid/hosted service, no account with any vendor; push is separate from SMTP (email stays for Keycloak account flows only). Task N4 (section 19) removes "push notifications" from the SPEC MVP non-goals and adds the API contract to docs/SPEC.md.

"Self-hosted" means: the API encrypts (RFC 8291, `aes128gcm`) and signs (VAPID) every message and POSTs it to the push service the browser chose (Google FCM for Chrome, Mozilla autopush for Firefox, Apple for Safari, Microsoft WNS for Edge). We never register with those services, pay nothing, and they cannot read the payload; they only see the endpoint, the size and the timing.

## 0. Summary of decisions
| Choice | Decision |
|---|---|
| v1 kinds | Scheduled medicine dose due (from `MedicationStatusCalculator`), nap window opening (from predictions), test. Belly pain pattern heads-up (2026-10-22, section 2.5); overtired and fussy pattern heads-ups (2026-10-22, sections 2.6 and 2.7); wet and dirty diaper heads-ups (2026-10-22, section 2.8); appointment reminders, on by default (2026-10-22, section 2.9). Co-parent activity in v1.1. |
| Opt-in | Per device (browser permission + subscription) and per user and baby (kinds); everything off by default. |
| Lock screen | Generic text by default: no baby name, no medicine name, never a dose amount. Names only when the user turns on "Show names". |
| Text | Rendered by the service worker from a bundled catalog (`push` namespace, en + pt-BR); the server sends codes, ids and instants only. |
| Scheduler | `BackgroundService` in the API, 60 s polling tick, lease row for multi-instance safety, unique delivery key for idempotency. |
| Rules | Pure Domain `NotificationPlanner` over the outputs of the existing pure calculators; all I/O in Application/Infrastructure. |
| Library | `Lib.Net.Http.WebPush` (MIT) behind an `IPushSender` port; fake sender in tests. |
| Secrets | `PUSH_VAPID_PUBLIC_KEY`, `PUSH_VAPID_PRIVATE_KEY`, `PUSH_VAPID_SUBJECT` env only; feature off when unset. |
| Service worker | Switch vite-plugin-pwa from `generateSW` to `injectManifest` with a TypeScript SW. |
| Permission | Asked only from an explicit user action (Settings, or the card after saving a scheduled prescription), behind our own explainer; never on first load. |
| iOS | Only installed Home Screen web app on iOS/iPadOS 16.4+; Safari tab shows install guidance. |

## 1. Goals and non-goals
Goals
- Remind a parent of a scheduled dose and of an opening nap window while the app is closed, on phones and desktops, at no cost, with data staying on the family's own server.
- Respect the medication guardrails of docs/design/06-medications.md section 0 without exception.
- Privacy by default: minimal payloads, generic lock-screen text, opt-in per device, per user and per baby.
- Work on a self-hosted single-instance deployment and stay correct with several API replicas.

Non-goals (v1)
- Email, SMS, native apps, FCM/APNs SDKs, third-party push or analytics services.
- Silent or data-only pushes, background sync triggered by push (every push shows a notification; browsers require it).
- Notification actions that write data (no "Log dose" button; logging always goes through the app and its confirmation flow).
- As-needed (PRN) medicine reminders, bedtime reminders, forgotten-timer reminders (section 2, later kinds).
- Remote dismissal of a notification already shown on another device (Web Push cannot do it without showing another notification).
- An in-app notification inbox/history, digests, marketing or re-engagement messages.
- Declarative Web Push (Safari 18.4+): our service-worker path covers Safari; revisit later.

## 2. Notification kinds
Codes are lower snake case and stable (stored, sent in the payload, used as i18n keys).

### 2.1 `dose_due` (v1)
Trigger, evaluated per baby by the planner from `MedicationStatus` (one per active prescription) at the tick time `now` in the recipient's time zone:
- Only prescriptions with `kind = scheduled` (times of day or `everyMinutes`), `CourseStarted`, not `CourseEnded`, not `LimitReached`, status active and not deleted. As-needed prescriptions never produce a reminder.
- Candidate slots `S`, each evaluated independently by the rules below: the open slot at or before now (`now - OverdueBy`, when set) and `NextScheduledAt` (when set). Both are needed: with a lead time, an earlier slot of the day that is still open must not hide the next one. Add `OverdueSlotAt` to `MedicationStatus` (additive, already computed inside the calculator) so the planner reads the instant instead of re-deriving it.
- Due time `T = max(S, AvailableAt ?? S)` (an interval group can push availability past the slot). If `T > S + 90 min` (`SlotMatchWindow`), the slot cannot be met within the rule: no reminder (counter `skipped{reason=unavailable}`).
- Send time `T - lead`, lead per user and baby: 0 (default), 5 or 15 minutes. Send when `sendAt <= now`, `now - sendAt <= 30 min` (stale cutoff: after downtime the API does not fire old reminders) and the slot is still open.
- Dedupe base key `dose:{prescriptionId:N}:{S utc yyyyMMddHHmm}`. Once any member's dose for that slot is synced, the slot is closed and nothing more is sent for it (also cancels pending snoozes).
- Part-of-the-day prescriptions (docs/design/06-medications.md 2.1, 2026-10-22) have no slots; they remind only when the prescription has `dayPartReminders` (off by default). Candidate: each chosen part of the routine day that is `due` (window open, no dose yet) with a reminder time `R` (inside the window). `T = max(R, availableAt)`; `T` at or after the window's end, or the 24 h limit reached, holds it back (`unavailable` / `limit`). Sent from `T - lead`, never before the window opens; same stale cutoff, time to live, urgency, quiet-hours rule (delivered unless medicine is silenced) and snooze as slots. Key `dose:{rx}:{R utc}`: one per prescription, part and local date (changing the reminder time is a new reminder); the payload `at` is `R`, so the generic lock-screen text is unchanged ("A scheduled dose for 08:00 is not logged yet"). A dose logged inside the window closes it; a part that ends without a dose is never reminded again.
- TTL 90 min (a later delivery would point at a slot that no longer matches), `Urgency: high`.

### 2.2 `nap_window` (v1)
Trigger from the `sleep` prediction of `PredictionEngine.Predict` (same inputs as `GET /predictions`):
- The baby is awake (no running sleep event), the prediction basis is `AwakeWindow`, confidence `Medium` or `High`, and the window's `earliest` falls in the engine's day phase (night sleep and the bed-time window are excluded).
- Send at `earliest - lead`, lead 0, 10 (default) or 20 minutes; only while `now < latest` and `now - sendAt <= 15 min`.
- Dedupe base key `nap:{babyId:N}:{anchor utc yyyyMMddHHmm}` where the anchor is the end of the last sleep session (one reminder per awake window, however much the estimate moves). Add `AnchorAt` to the Domain `Prediction` (additive, not on the wire).
- TTL = `latest - now`, capped at 60 min; `Urgency: normal`. Skipped inside the recipient's quiet hours (dropped, not deferred).

### 2.3 `test` (v1)
Sent on demand from Settings to the caller's devices. Key `test:{deliveryId}`, TTL 5 min, `Urgency: normal`. Ignores quiet hours.

### 2.4 Later kinds (not v1)
- `coparent_activity` (v1.1): "A new entry was logged" for babies the user opted into, never for the user's own entries, batched to at most one per baby per 15 minutes, generic text unless "Show names" is on, then "Ana logged a feed at 14:05". Planned as a polling pass over events with `updated_at` past a per-baby cursor; needs its own prefs column (added in its own migration, not pre-created).
- `timer_forgotten`: a duration timer running longer than the typical duration + 2 h ("Still running?"). Needs owner input on thresholds.
- `bed_time_window`: from `bedTime` of the predictions response. Open question 2.
- As-needed "available again": open question 1; if ever added, neutral wording ("can be logged again from 18:00 if needed"), opt-in per prescription.

### 2.5 `belly_pain_pattern` (2026-10-22; docs/design/11-patterns.md)
Trigger from the baby's belly pain pattern (`BellyPainPatterns.Detect`, read in the recipient's IANA time zone so daylight saving changes inside the look-back are applied):
- Opt-in per user and baby ("Belly pain heads-up"), off by default; only Owners and Parents with a time zone, like the other kinds.
- One reminder per baby and local day: the window starting on that date (windows starting yesterday, today and tomorrow are candidates, so a window around midnight works). Sent at `window start - 30 min` (`NotificationRules.BellyPainLead`), only while now is before the window's end and within 30 minutes of the send time (stale cutoff), and only when no belly pain or belly massage was logged from `window start - 45 min` on (the same lead the Now card uses; a logged event closes the day, like a dose closes a slot).
- Not a medicine: dropped inside quiet hours whatever "Also silence medicine reminders" says. Snooze and dismiss as for naps (the server accepts them; the notification has no action buttons).
- Dedupe base key `belly:{babyId:N}:{local date yyyyMMdd}` (the date the window starts on, in the recipient's zone). TTL until 15 minutes after the window ends; `Urgency: normal`.
- Payload codes only: `{v, id, kind: "belly_pain_pattern", babyId, at (window start), lang, token, names?: {baby}}`; never an intensity, a symptom or advice. A retry rebuilds `at` as due time + 30 min (snooze re-sends show their due time, as naps).
- Lock-screen text "A good moment for a belly massage / Belly pain often shows up from around 17:30." (generic: no baby name unless show-names is on). Tapping opens Now for that baby (`/#notify=belly&baby=..&d=..`), where the card shows when it still applies.

### 2.6 `overtired_warning` (2026-10-22; docs/design/11-patterns.md section 6)
The "hora da bruxa" heads-up: the baby has been awake nearly as long as her usual longest comfortable stretch. Trigger from the baby's wake window (`WakeWindows.Measure`, read in the recipient's IANA time zone, which decides the daytime stretches):
- Opt-in per device (push on) and per user and baby ("Overtired heads-up", off by default; column `baby_notification_preferences.overtired_warning`, migration `FussyAndOvertiredPrefs`).
- Only while the baby is awake: no sleep running, no lone `fell_asleep` since the last wake, no night waking that ended at or after it (the wake window's `AwakeSince` is then `null`). With fewer than 5 daytime stretches there is no wake window and nothing is sent.
- One reminder per awake stretch: sent at `awake since + limit - 15 min` (`NotificationRules.OvertiredLead`), only within 15 minutes of that time (stale cutoff, so never after the limit) and while now is before `limit + 30 min`. A sleep that starts ends the stretch (no current stretch, nothing more is planned); the next stretch has its own key.
- Quiet hours always apply (not a medicine). Dedupe base key `overtired:{babyId:N}:{awake since utc yyyyMMddHHmm}`. TTL until 30 minutes after the limit; `Urgency: normal`.
- Payload codes only: `{v, id, kind: "overtired_warning", babyId, at (the limit), lang, token, names?: {baby}}`; never a symptom or advice. A retry rebuilds `at` as due time + 15 min (snooze re-sends show their due time).
- Lock-screen text "Awake time is near the usual limit / The usual limit is around 15:30. A nap soon may help." (generic; no alarm). Tapping opens Now (`/#notify=overtired&baby=..&d=..`), where the card shows when it still applies. Device tag `overtired:{baby}` (the next stretch's replaces it); the app closes it once a sleep starts from 30 min before the limit.

### 2.7 `fussy_pattern` (2026-10-22; docs/design/11-patterns.md section 7)
The evening fussiness pattern: the rules of section 2.5 over the baby's `fussy` pattern (`FussyPatterns.Detect`).
- Opt-in per device and per user and baby ("Fussy time heads-up", off by default; column `baby_notification_preferences.fussy_pattern`, migration `FussyAndOvertiredPrefs`).
- One per baby and local day at `window start - 30 min`, 30 min stale cutoff, while before the window's end, unless a fussy spell was logged from `window start - 45 min` on. Quiet hours always apply. Key `fussy:{babyId:N}:{local date yyyyMMdd}`; TTL until 15 minutes after the window ends; `Urgency: normal`.
- Payload codes only (`kind: "fussy_pattern"`, `at` = window start). Text "Fussy time is coming up / Fussiness often starts from around 17:30. A calm routine may help." Tapping opens Now (`/#notify=fussy&..`); device tag `fussy:{baby}`; closed once a fussy spell is logged from 45 min before the window.

### 2.8 `diaper_wet_headsup` and `diaper_dirty_headsup` (2026-10-22; docs/design/11-patterns.md section 8)
When the baby will probably pee or poop, from the baby's own diaper and feed log (`DiaperPredictions.Predict`, elapsed time, so no time zone is needed for the estimate itself).
- Two kinds, each opt-in per device (push on) and per user and baby ("Wet diaper heads-up", "Dirty diaper heads-up", both off by default; columns `baby_notification_preferences.diaper_wet_headsup` and `diaper_dirty_headsup`, migration `DiaperHeadsUpPrefs`).
- Wet: anchored at the latest wet (or mixed) diaper; one heads-up at `expected - 10 min` (`NotificationRules.DiaperWetLead`). A wet diaper logged since is a new anchor (new key, later time), so the old heads-up is never sent.
- Dirty: when the lag after feeds passed its gate, the latest feed ended at most 3 hours ago and no dirty diaper came since it ended, one heads-up at `feed end + lower lag`, keyed by the feed end; otherwise, when the gaps between dirty diapers passed their gate, one at `expected - 5 min` (`DiaperDirtyGapLead`), keyed by the latest dirty diaper. Neither gate: nothing.
- Stale cutoff 15 minutes after the send time (`DiaperStaleCutoff`); not a candidate from 30 minutes after the expected time on; time to live until then (`DiaperExpiryAfterExpected`); `Urgency: normal`. Quiet hours always apply (dropped, not deferred).
- Caps per recipient and baby: at most 3 heads-ups of a kind per local day of the recipient (`DiaperDailyCap`, skip reason `daily_cap`), counting the deliveries that were sent or are still pending on any of the recipient's devices (one per dedupe key; failed, expired, gone and cancelled ones do not count); never two of either kind within 60 minutes (`DiaperSpacing`, skip reason `spacing`, measured from the time the push service accepted the earlier one, else its due time). Within one tick at most one diaper heads-up per recipient: the earlier due one wins, wet first on a tie. The scheduler loads these heads-ups once per tick for the last day (`INotificationDeliveryRepository.ListSentHeadsUpsAsync`), only when someone wants a diaper kind.
- Dedupe base keys `wet:{babyId:N}:{anchor utc yyyyMMddHHmm}` and `dirty:{babyId:N}:{anchor utc yyyyMMddHHmm}`.
- Payload codes only: `{v, id, kind: "diaper_wet_headsup" | "diaper_dirty_headsup", babyId, at (the expected time), lang, token, names?: {baby}}`; never the content, a symptom or advice. A retry rebuilds `at` as due time + 10 min (wet) or + 5 min (dirty; after a feed this approximates the expected time).
- Lock-screen text, generic unless show-names: wet "A diaper check may be due / A wet diaper is often due around 15:40." (pt-BR "Pode ser hora de olhar a fralda / Uma fralda molhada costuma vir por volta de 15:40."); dirty "A diaper may be coming / A dirty diaper often comes around 16:05." ("Uma fralda suja pode estar a caminho / Uma fralda suja costuma vir por volta de 16:05."). Tapping opens Now (`/#notify=wet&..` or `/#notify=dirty&..`), where the card shows when it still applies. Device tags `wet:{baby}` and `dirty:{baby}`; the app closes a shown one once a wet (or mixed) diaper is logged from 10 minutes before `at`, or a dirty (or mixed) one from 60 minutes before `at`.

### 2.9 `appointment_reminder` (2026-10-22; docs/design/15-appointments.md)
Reminders before the baby's appointments (`Appointment`, synced per baby), at the offsets chosen on each appointment: 1 week, 1 day, 2 hours, 30 minutes (default 1 day and 2 hours).
- On by default per user and baby (column `baby_notification_preferences.appointment_reminders`, NOT NULL DEFAULT TRUE, migration `Appointments`): the family created the appointment on purpose. The device opt-in is still needed. A member who never stored preferences is a scheduler candidate with the defaults while the baby has an upcoming appointment within a week (`ListCandidatesAsync` adds them; a stored row with only this kind on is a candidate under the same condition). Owners, Parents and Caregivers; Viewers never.
- For every upcoming appointment that has not started and each offset: send at `start - offset`. Inside the recipient's quiet hours (read in their zone at that instant, daylight saving applied) the send time moves to the end of the quiet period when that is still before the start; otherwise that reminder is skipped (an appointment reminder is delayed, not dropped). An offset whose send time was already past when the appointment was last changed (created, moved, restored; its server `updatedAt`) is skipped. Of the offsets due in one tick only the latest goes; an earlier one that was never sent is superseded (never two at once). Done and cancelled appointments never remind.
- Dedupe base key `appt:{appointmentId:N}:{start utc yyyyMMddHHmm}:{offset}`: moving the start is a new key (the reminders of the new time are planned again). Stale cutoff 30 minutes (`AppointmentStaleCutoff`); TTL until the start; `Urgency: normal`; snooze and dismiss as for naps (no buttons).
- Payload codes only: `{v, id, kind: "appointment_reminder", babyId, apptId, offset, at (the start), lang, token, names?: {baby}}`; never the title, the doctor or the notes. A retry rebuilds `apptId`, `at` and `offset` from the key.
- Lock-screen text, worded by the worker in the device zone from `at`, `offset` and the time of display: "Appointment reminder / Appointment tomorrow at 15:30." ("Lembrete de consulta / Consulta amanhã às 15:30."), "Appointment in 2 hours, at 15:30.", "Appointment in 30 minutes, at 15:30.", "Appointment in a week, on Thursday, October 22 at 15:30."; when the offset's phrase is no longer true (delayed by quiet hours) "today at", "tomorrow at" or "on {date} at" ("hoje às", "amanhã às", "marcada para {date}, às"). With show-names: "{{baby}}: appointment tomorrow at 15:30." Device tag `appt:{appointment}`. Tapping opens `/appointments#notify=appt&baby=..&appt=..&d=..`, where the appointment's detail opens.

### 2.10 `doctor_suggestion` (2026-10-22; docs/design/16-doctor-access.md section 10.4)
The baby's doctor sent something the parents decide on or read: a prescription proposal or a shared recommendation.
- Off by default per user and baby (column `baby_notification_preferences.doctor_suggestions`, NOT NULL DEFAULT FALSE, migration `DoctorProposals`; switch "Doctor suggestions" / "Sugestões do médico"); the in-app inbox works without it. Owners and Parents only (`NotificationRules.CanReceiveDoctorSuggestions`): never the Doctor, a Caregiver or a Viewer (a Caregiver may store the flag; the planner ignores it), never the author. A member with the switch on is a scheduler candidate while the baby has such a suggestion of the last 24 hours.
- One per suggestion and member: every pending proposal and every shared, not deleted recommendation created less than 24 hours ago that the member has not opened (`note_reads`). Sent from its creation; inside quiet hours it is held (skip reason `quiet_hours`) and goes on the first tick after them (stale cutoff 24 hours). A proposal decided or withdrawn meanwhile, or a recommendation read or deleted, is no longer planned.
- Dedupe base keys `proposal:{proposalId:N}` and `recommendation:{noteId:N}`; TTL until 24 hours after the creation; `Urgency: normal`; no snooze button. A retry rebuilds the ids from the key.
- Payload codes only: `{v, id, kind: "doctor_suggestion", babyId, proposalId | noteId, at (the creation), lang, token, names?: {baby}}`; never a medicine name, a dose or the note's text.
- Lock-screen text: "Your doctor sent a suggestion / Open Lotties to review it." ("Seu médico enviou uma sugestão / Abra o Lotties para ver."); with show-names "{{baby}}: open Lotties to review it.". Device tag `doctor:{id}`, only the Open action. Tapping opens `/from-doctor#notify=doctor&baby=..&d=..` ("From your doctor").
- The doctor gets no push in v1: her proposal list shows the decision on the next sync.

### 2.11 `vaccine_due` (2026-10-22; docs/design/18-vaccines.md section 6)
A vaccine dose is due according to the baby's schedule (never a recommendation to give or skip it).
- Off by default per user and baby (column `baby_notification_preferences.vaccine_reminders`, NOT NULL DEFAULT FALSE, migration `Vaccines`, added to the candidate index filter; switch "Vaccine reminders" / "Lembretes de vacinas"). Owners and Parents only (`NotificationRules.CanReceiveVaccineReminders`): never a Caregiver, a Viewer or the Doctor (a Caregiver may store the flag; the planner ignores it).
- The planner computes the dose statuses (`VaccineStatusCalculator`) on the recipient's local date with the baby's schedule profile, birth date and records that are not deleted (loaded only when such a recipient exists). Per slot (an alternative group or one dose) with a dose due or overdue (not given, not covered by a combined product, not expired): reminder 1 at 09:00 local on the day the slot became due, reminder 2 at 09:00 fourteen days later if still not given; never more. Inside quiet hours the send time moves to their end when that is still the same local day, else that reminder is skipped. Only reminders of today and yesterday are considered, so turning the switch on for an older baby sends nothing old.
- Dedupe base key `vaccine:{babyId:N}:{doseId}:{n}` (`n` = 1 or 2; a yearly dose adds its due day, `{doseId}@{yyyyMMdd}`, so every year is new); stale cutoff 12 hours; TTL 48 hours; `Urgency: normal`; no snooze button. A retry rebuilds the dose id from the key.
- Payload codes only: `{v, id, kind: "vaccine_due", babyId, doseId, at (the send time), lang, token, names?: {baby, vaccine?}}`; `names.vaccine` is the vaccine's short name (before any parenthesis) in the device language; never a clinic, lot, who gave it or notes.
- Lock-screen text: "A vaccine may be due / Open Lotties to see the vaccine schedule." ("Pode haver uma vacina a tomar / Abra o Lotties para ver o calendário de vacinas."); with show-names "{{baby}}: {{vaccine}} may be due according to the schedule." ("{{baby}}: {{vaccine}} pode estar na época, segundo o calendário."), or without a vaccine name "{{baby}}: a vaccine may be due according to the schedule.". Device tag `vaccine:{babyId}:{doseId}`, only the Open action. Tapping opens `/vaccines#notify=vaccine&baby=..` with the baby selected.

## 3. Privacy and sharing semantics
- Opt-in per device: nothing is subscribed until the user turns on "Notifications on this device" and grants the browser permission. Turning it off unsubscribes the browser and revokes the server row.
- Opt-in per user and baby: `dose_due` and `nap_window` are off for every baby until the user turns them on. Defaults are never inherited from a co-parent.
- Who receives: current members with role Owner or Parent who opted in, on every active subscription of theirs. Viewers cannot opt in (they cannot log a dose). Membership is re-checked on every tick (join on `baby_members`); preference rows cascade-delete when the member leaves or is removed.
- Payload minimisation: the encrypted payload carries only `{v, id, kind, babyId, rxId?, at, lang, token?, names?}`. `names` (`{baby, medication}`, each trimmed to 40 characters) is included only when the recipient turned on "Show names on notifications" (user setting, default off). A dose amount is never sent or shown. The baby's birth date, notes, payload details, prescriptions' indication or instructions are never sent.
- Lock-screen text by default: "Medicine reminder / A scheduled dose for 18:00 is not logged yet." and "Nap window / The estimated nap window opens around 14:20." No baby name, no medicine name.
- Quiet hours (per user, in the user's time zone, `start`-`end` may cross midnight, default on 22:00-07:00): `nap_window`, `belly_pain_pattern`, `overtired_warning`, `fussy_pattern`, `diaper_wet_headsup`, `diaper_dirty_headsup` and later activity kinds are dropped; `appointment_reminder` is delayed to the end of quiet hours when that is still before the start (else skipped). `dose_due` is still delivered (the parent scheduled that time on purpose) unless "Also silence medicine reminders in quiet hours" is on.
- Snooze and dismiss are per user: snoozing my reminder never silences my co-parent's. Snooze = 30 minutes, at most 3 times per reminder; the re-send has key `{base}:s{n}` and is sent only if the item is still open. Each slot or awake window is notified once (no automatic repeats), so dismiss only matters after a snooze: "Stop reminders for this dose" on the in-app reminder line cancels pending snoozes for that base key for this user. Logging the dose (by anyone) is the implicit acknowledgement for everyone.
- Dedupe: one delivery per `(subscription, key)` (unique index). On the device the notification `tag` is the base key, so a snoozed re-send replaces the earlier notification instead of stacking.
- Shared device / account switch: a browser has one endpoint per origin. Subscribing with an endpoint that belongs to another user transfers it to the caller (latest sign-in owns the device) and the old user's pending deliveries for it are cancelled. Logout revokes the device (section 12).
- Logs and API responses never contain endpoints, keys, payloads, names or tokens; deliveries keep ids, kind, times and status only, purged after 14 days.
- Reminders reflect synced data: a dose logged offline and not yet pushed cannot stop a co-parent's reminder. The Settings explainer says so.

## 4. Medication guardrails (docs/design/06-medications.md section 0 applies in full)
- The app is a log and reminder tool, not a medical device. A reminder only repeats a time the parent entered from the doctor's prescription; it never implies a dose should be given, never states or suggests an amount, never mentions substitutes or "same active ingredient" products.
- Wording is neutral: "scheduled dose", "not logged yet", never "give", "take" or "time for medicine". No urgency styling, no repeated nagging (one notification per slot, snooze only on request).
- No reminders for as-needed prescriptions, stopped, deleted, not started or ended courses, or when the 24 h limit is reached.
- The notification has no "Log dose" action. Tapping it opens the Meds tray for that prescription, where the existing flow applies unchanged: status recomputed from local data after a sync pull, per-kg suggestion with its inputs and confirmation, stale-weight warning, and the early-dose question "Too early: next allowed at 18:00. Log anyway?" recording `override: true`. The notification content is never used to prefill or decide anything.
- Settings explainer (and the pre-permission sheet) states: "Reminders come from the prescriptions you entered. They can be late or missing (no connection, phone settings), so don't rely on them alone. Not medical advice."

## 5. Data model (EF Core code-first, snake_case, migration `PushNotifications`)
New Domain folder `Domain/Notifications/`. All timestamps `timestamptz` (UTC). Add model tests in `Lotties.Infrastructure.Tests`.

`push_subscriptions` (aggregate `PushSubscription`, one per browser endpoint)
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | server generated |
| user_id | uuid FK users, cascade | owner |
| endpoint | text, max 2048 | capability URL; never logged or returned |
| endpoint_hash | char(43) | SHA-256 base64url of `endpoint`; unique |
| p256dh | varchar(88) | base64url, decodes to 65 bytes starting `0x04` |
| auth | varchar(24) | base64url, decodes to 16 bytes |
| locale | varchar(10) | `en` or `pt-BR` (unknown -> `en`) |
| device_label | varchar(60) null | client-built, e.g. "Chrome on Android"; trimmed, no NUL |
| expires_at | timestamptz null | from `expirationTime` |
| created_at, last_seen_at | timestamptz | `last_seen_at` bumped by each reconcile |
| last_success_at | timestamptz null | last 2xx from the push service |
| consecutive_failures | int | reset on success |
| revoked_at | timestamptz null | soft revoke |
| revoked_reason | varchar(16) null | `user`, `gone` (404/410), `invalid` (400/403 VAPID mismatch), `inactive`, `transferred` |

Indexes: unique `endpoint_hash`; `(user_id)` filtered `revoked_at IS NULL`. Value objects `PushEndpoint` (validated URI + hash) and `PushKeys`. At most 10 active subscriptions per user (the least recently seen is revoked `inactive` on the 11th).

`user_notification_settings` (one per user, created on first PUT; defaults otherwise)
| Column | Type | Notes |
|---|---|---|
| user_id | uuid PK FK users, cascade | |
| time_zone | varchar(64) | IANA id, validated with `TimeZoneInfo.TryFindSystemTimeZoneById` |
| quiet_hours_enabled | bool | default true |
| quiet_start, quiet_end | time | default 22:00 / 07:00; equal values rejected |
| quiet_includes_medicine | bool | default false |
| show_names | bool | default false |
| updated_at | timestamptz | |

`baby_notification_preferences` (one per member who changed anything)
| Column | Type | Notes |
|---|---|---|
| baby_id, user_id | uuid, PK together | FK to the `baby_members` alternate key `(baby_id, user_id)`, ON DELETE CASCADE |
| dose_due | bool | default false |
| dose_lead_minutes | smallint | 0, 5, 15 |
| nap_window | bool | default false |
| nap_lead_minutes | smallint | 0, 10, 20 |
| belly_pain_pattern | bool | default false (migration `BellyPainPattern`, 2026-10-22) |
| overtired_warning | bool | default false (migration `FussyAndOvertiredPrefs`, 2026-10-22) |
| fussy_pattern | bool | default false (migration `FussyAndOvertiredPrefs`, 2026-10-22) |
| diaper_wet_headsup | bool | default false (migration `DiaperHeadsUpPrefs`, 2026-10-22) |
| diaper_dirty_headsup | bool | default false (migration `DiaperHeadsUpPrefs`, 2026-10-22) |
| appointment_reminders | bool | default TRUE (migration `Appointments`, 2026-10-22; on unless the member turns it off) |
| updated_at | timestamptz | |

Index `(baby_id)` filtered `dose_due OR nap_window OR belly_pain_pattern OR overtired_warning OR fussy_pattern OR diaper_wet_headsup OR diaper_dirty_headsup OR appointment_reminders` (candidate babies; widened by migrations `BellyPainPattern`, `FussyAndOvertiredPrefs`, `DiaperHeadsUpPrefs` and `Appointments`).

`notification_deliveries` (delivery log and idempotency)
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | also the payload `id` |
| subscription_id | uuid FK push_subscriptions, cascade | |
| user_id | uuid | denormalised for snooze lookups |
| baby_id | uuid null | null for `test` |
| kind | varchar(24) | `dose_due`, `nap_window`, `belly_pain_pattern`, `overtired_warning`, `fussy_pattern`, `diaper_wet_headsup`, `diaper_dirty_headsup`, `appointment_reminder`, `test` |
| base_key | varchar(120) | e.g. `dose:{rx}:{slot}` |
| dedupe_key | varchar(124) | base key, or `{base}:s{n}` for snooze re-sends |
| due_at, expires_at | timestamptz | `expires_at = due_at + TTL` |
| status | varchar(12) | `pending`, `sent`, `failed`, `expired`, `gone`, `cancelled` |
| attempts | smallint | max 3 |
| next_attempt_at | timestamptz null | retry time |
| last_status_code | smallint null | HTTP status from the push service |
| action_token_hash | char(43) null | SHA-256 base64url of the per-delivery action token |
| created_at, sent_at | timestamptz | |

Indexes: unique `(subscription_id, dedupe_key)`; `(status, next_attempt_at)`; `(created_at)` for the purge; `(user_id, base_key)`.

`notification_actions` (per-user snooze/dismiss)
| Column | Type | Notes |
|---|---|---|
| user_id, base_key | PK together | |
| baby_id | uuid | |
| action | varchar(10) | `snoozed`, `dismissed` |
| snoozed_until | timestamptz null | |
| snooze_count | smallint | max 3 |
| updated_at | timestamptz | purged 7 days after |

`job_leases` (scheduler leader lease, portable to SQLite)
| Column | Type | Notes |
|---|---|---|
| name | varchar(40) PK | `push-scheduler` |
| holder_id | varchar(64) | instance id (machine + process + random) |
| lease_until | timestamptz | |
| xmin | concurrency token | existing `RowVersions` helper; plain integer token on SQLite like other tests |

Retention (hourly housekeeping): deliveries older than 14 days deleted; actions 7 days after their last change; subscriptions revoked for 30 days hard-deleted; active subscriptions with `last_seen_at` older than 90 days revoked `inactive`; `expires_at` in the past skipped and revoked `gone`.

## 6. API endpoints
Base `/api/v1`, JSON camelCase, problem+json with `code` (status per code in `DomainExceptionStatusCodes`). User-level routes need authentication only (like the catalog); baby routes use the existing baby group and role policies. When push is not configured every route except `GET /push/config` is 409 `push_not_configured`.

| Route | Auth | Body / result |
|---|---|---|
| `GET /push/config` | any user | `{enabled, publicKey|null}` (base64url uncompressed P-256). The web hides the feature when `enabled` is false. |
| `POST /push/subscriptions` | any user, `push-write` | `PushSubscription.toJSON()` plus fields: `{endpoint, expirationTime|null, keys:{p256dh, auth}, locale, deviceLabel?}`. Upsert by endpoint hash: 201 new, 200 updated (keys, locale, label, `last_seen_at`; un-revokes; transfers from another user). Returns `{id, deviceLabel, locale, createdAt, lastSuccessAt}`. Endpoint rules below. |
| `POST /push/subscriptions/revoke` | any user, `push-write` | `{endpoint}` -> 204 always (unknown or another user's endpoint is a no-op). The endpoint travels in the body so it never appears in a path or access log. |
| `GET /push/subscriptions` | any user | the caller's active devices `[{id, deviceLabel, locale, createdAt, lastSeenAt, lastSuccessAt}]`. |
| `DELETE /push/subscriptions/{id}` | any user, `push-write` | revokes one of the caller's devices; 204 idempotent. |
| `GET /push/settings` / `PUT /push/settings` | any user, `push-write` on PUT | `{timeZone, quietHours:{enabled, start:"HH:mm", end:"HH:mm"}, quietIncludesMedicine, showNames}`; GET returns defaults with `timeZone: null` before the first PUT. |
| `GET /push/preferences` | any user | `[{babyId, canReceive, doseDue, doseLeadMinutes, napWindow, napLeadMinutes, bellyPainPattern, overtiredWarning, fussyPattern, diaperWetHeadsUp, diaperDirtyHeadsUp, appointmentReminders}]` for every baby the caller belongs to (`canReceive = role != Viewer`). |
| `PUT /babies/{babyId}/notification-preferences` | Parent/Owner, `push-write` | `{doseDue?, doseLeadMinutes?, napWindow?, napLeadMinutes?, bellyPainPattern?, overtiredWarning?, fussyPattern?, diaperWetHeadsUp?, diaperDirtyHeadsUp?, appointmentReminders?}` merged into the stored state (a field absent or `null` keeps its value, defaults before the first PUT; since 2026-10-22, so a stale client never turns off a kind it does not know) -> 200 stored; Viewer 403; merged leads outside the allowed sets 400 `validation_failed`. |
| `POST /push/test` | any user, `push-test` | `{endpoint?}` (this device; all the caller's devices without it) -> 200 `{results:[{subscriptionId, status: "sent"|"gone"|"failed"}]}`; sends synchronously with the 10 s send timeout. |
| `POST /push/deliveries/{deliveryId}/actions` | anonymous, `push-action` | `{action: "snooze"|"dismiss", token}` -> 204. Unknown id, wrong token or more than 12 h after `due_at` -> 404 `notification_action_not_found` (one code, nothing revealed); fourth snooze 409 `snooze_limit_reached`. |

Endpoint rules (400 `validation_failed` with `field`, or 422 `push_endpoint_not_allowed`): absolute `https` URL, port 443, no user info, at most 2048 characters, host matching `Push:AllowedEndpointHosts` (default `fcm.googleapis.com`, `updates.push.services.mozilla.com`, `*.push.services.mozilla.com`, `web.push.apple.com`, `*.push.apple.com`, `*.notify.windows.com`). The allowlist is the SSRF guard (clients choose the URL the server POSTs to) and is re-checked before every send. `keys` must decode to the sizes in section 5. `locale` outside the supported list becomes `en`.

The action token: 256-bit random per delivery, only its SHA-256 is stored (as invites), sent in the payload so the service worker (which has no access token) can snooze or dismiss; it can do nothing else. The app uses the same route from the deep link.

Rate limits (fixed one-minute window, `RequestLimits` section, non-positive fails startup): `PushWritePermitsPerMinute` 30 per user, `PushTestPermitsPerMinute` 3 per user, `PushActionPermitsPerMinute` 20 per remote address (anonymous partition). The global 300 per user still applies.

New error codes: `push_not_configured` 409, `push_endpoint_not_allowed` 422, `notification_action_not_found` 404, `snooze_limit_reached` 409. Add `errors.<code>` keys to both web catalogs.

## 7. Background scheduler
- `PushSchedulerService : BackgroundService` (Api host wiring, logic in Application `NotificationDispatcher`), `PeriodicTimer` every `Push:TickSeconds` (default 60, 15-300), one scope and `DbContext` per tick, `TimeProvider` for now. Not started when push is not configured or `Push:SchedulerEnabled=false` (tests set it false and drive `INotificationTick.RunOnceAsync(now)` directly).
- Polling, not a scheduled queue: due items depend on data that changes at any moment (a dose logged, a sleep started, a prescription edited, a prediction moving); a precomputed queue would need invalidation on every write. Recomputing per tick from current data is always correct, and the load is small for a self-hosted instance (candidate babies only). Metric `push.tick.duration`; if ticks exceed 10 s, add a per-baby `next_check_at` cache later, not in v1.
- Tick steps:
  1. Lease: update `job_leases` row `push-scheduler` to `holder = me, lease_until = now + 2 x tick` when expired or already mine (optimistic concurrency); losing the race = skip this tick. Only one instance plans at a time.
  2. Retry: deliveries `pending` with `next_attempt_at <= now`, `attempts < 3`, `expires_at > now` are re-sent; expired ones become `expired`.
  3. Plan: candidate babies = preferences with a kind on, joined with Owner/Parent membership and an active subscription. Per baby: load prescriptions, 9 days of doses and the latest weight (as `MedicationStatusService`), and the prediction history (as `PredictionService`) only when a recipient wants that kind; group recipients by time zone, convert each zone to the offset at `now` (`TimeZoneInfo`), run `MedicationStatusCalculator.Calculate` and `PredictionEngine.Predict` once per offset; pass everything with the recipients' settings, snoozes/dismissals and the base keys already delivered to `NotificationPlanner.Plan`. Baby and medication names are loaded only when a recipient has show-names on.
  4. Claim and send: for each planned notification and each active subscription of the recipient, insert the delivery row (`pending`, attempts 0, new action token). A unique violation on `(subscription_id, dedupe_key)` (told apart from other errors by the existing `IUniqueViolationDetector`, SQLite detector in tests) means another tick or instance already claimed it: skip. Commit, then send outside the transaction (at most `Push:MaxConcurrentSends`, default 8) and update status.
  5. Housekeeping once an hour (section 5 retention).
- Idempotency and crash safety: the claim row exists before the send; a crash between claim and send leaves `pending` rows that step 2 retries (at-least-once). A rare duplicate is collapsed on the device by the same `tag` and in the push service by the `Topic` header.
- Pure Domain: `NotificationPlanner.Plan(NotificationPlanInput)` takes `now`, the medication statuses and the sleep prediction per offset, recipients (user id, role, per-baby prefs, quiet hours, lead times, show-names, local offset), snoozes/dismissals and delivered keys, and returns `PlannedNotification(userId, kind, babyId, baseKey, dedupeKey, dueAt, ttl, urgency, content)` where `content` holds the ids, `at` and optional names. No I/O, no clock, fully unit-tested (quiet hours across midnight, leads, stale cutoff, slot window, group-delayed availability, limit reached, course dates, snooze counts, Viewer exclusion).
- Time zones: the user's IANA zone from `user_notification_settings` (sent by the web on first enable and whenever the device zone differs, last writer wins; Settings shows it). Times of day and quiet hours are evaluated in that zone with the offset at `now`, consistent with what that user's app computes offline. DST transitions inside the 9-day window are not modelled (same as the status endpoint). Recipients without a zone are skipped (the web always sends one before subscribing). The runtime image `mcr.microsoft.com/dotnet/aspnet:8.0` (Debian) ships tzdata; keep it if the base image changes.

## 8. Sending
- Library: `Lib.Net.Http.WebPush` 3.3.x (section 8.1) for VAPID (`VapidAuthentication`, `vapid` scheme) and RFC 8291 `aes128gcm` encryption. `PushServiceClient(HttpClient)` gets a typed client from `IHttpClientFactory` (`Push:SendTimeoutSeconds`, default 10). Set `AutoRetryAfter = false`: the library otherwise retries 429 itself, unlimited by default (`MaxRetriesAfter = 0`), which would block a tick; our scheduler owns retries. Set `DefaultTimeToLive` explicitly (library default is 28 days). Non-success responses throw `PushServiceClientException` carrying the status code, mapped to `PushSendResult` in the adapter.
- Port `IPushSender.SendAsync(PushTarget, PushMessage, CancellationToken) -> PushSendResult(statusCode, retryAfter)` in Application; `WebPushSender` in Infrastructure; `FakePushSender` in tests.
- Headers: `TTL` per kind (section 2), `Urgency` (`high` dose, `normal` others), `Topic` = first 32 characters of base64url(SHA-256(base key)) so the push service replaces an undelivered earlier message for the same item.
- Payload (UTF-8 JSON, asserted under 1 KiB in tests; the limit is about 4 KiB): `{"v":1,"id":"<deliveryId>","kind":"dose_due","babyId":"<guid>","rxId":"<guid>","at":"2026-10-21T21:00:00Z","lang":"pt-BR","token":"<base64url>","names":{"baby":"Lia","medication":"Simeticona"}}` (`names` only with show-names on; `rxId` only for doses; no `token` for tests).
- Responses: 201/202 -> `sent`, reset failures; 404/410 -> subscription revoked `gone`, delivery `gone`; 400/403 -> revoked `invalid` (key mismatch after a VAPID change; the web re-subscribes, section 10); 413 -> `failed` + error log (bug); 429 and 5xx -> `pending` with `next_attempt_at` = `Retry-After` or 1, 4 minutes; network errors/timeouts as 5xx. After 3 failed attempts `failed`; 10 consecutive failures revoke the subscription `invalid`.

### 8.1 Library choice (checked 2026-10-21 on nuget.org and the sources)
| Option | Licence | State | Verdict |
|---|---|---|---|
| `Lib.Net.Http.WebPush` 3.3.1 (Tomasz Peczek; 3.3.1 March 2025, 3.3.0 October 2024) | MIT | VAPID (RFC 8292) and RFC 8291; wraps the body in `Aes128GcmEncodedContent`; sets `TTL`, `Urgency`, `Topic`; accepts an injected `HttpClient`. On .NET 6+ its only dependency is `Lib.Net.Http.EncryptedContentEncoding` 2.1.1 (same author, MIT; netstandard2.1 build has no dependencies, so no BouncyCastle). Optional `Lib.AspNetCore.WebPush` exists; not needed. | **Chosen.** Protocol is stable, so the slow release cadence is acceptable; pin the version, keep it behind `IPushSender`. |
| `WebPush` (web-push-csharp) 1.0.13 (April 2026; previous release 2021) | MPL-2.0 | Depends on Portable.BouncyCastle; its README documents the older `Crypto-Key` header style and does not document `aes128gcm`. | Rejected: legacy crypto stack, unclear `aes128gcm` support (Apple requires it). |
| `ClosureOSS.WebPush` 2.5.7 (August 2026; a re-implementation forked from web-push-csharp) | MPL-2.0 | `aes128gcm`, topic, urgency; targets net8-net10 but requires `Microsoft.Extensions.Logging.Abstractions` >= 10.0.11 and `Microsoft.IdentityModel.*` 8.22. | Fallback if `Lib.Net.Http.WebPush` stops working: drags 10.x packages into the net8 app (revisit with the .NET 10 upgrade, PLAN backlog 19). |
| Own implementation on `System.Security.Cryptography` (ECDH P-256, `HKDF`, `AesGcm`, ES256) | ours | about 200 lines plus RFC test vectors | Rejected: avoidable crypto risk. |

Licence compatibility: MIT and MPL-2.0 libraries may be used by an AGPL-3.0 application (both are GPL-compatible; MPL-2.0 keeps its file-level terms for its own files only). Add the chosen packages to the third-party notices if/when the project keeps one.

## 9. Configuration and secrets
- Env (the only place for secrets; root `.env` is gitignored, never committed): `PUSH_VAPID_PUBLIC_KEY`, `PUSH_VAPID_PRIVATE_KEY` (base64url raw P-256 keys), `PUSH_VAPID_SUBJECT` (`mailto:` of the operator or an `https:` URL; Apple rejects invalid subjects). Added to `EnvironmentAliases` as `Push:Vapid:PublicKey|PrivateKey|Subject`.
- Other settings in section `Push` (`Push__TickSeconds`, `Push__SchedulerEnabled`, `Push__AllowedEndpointHosts__0`, `Push__MaxSubscriptionsPerUser`, `Push__SendTimeoutSeconds`, `Push__MaxConcurrentSends`) with a validator like `RequestLimitsOptionsValidator`.
- All three VAPID values unset = push disabled (`GET /push/config` says so). Some but not all set, an invalid key, or a public key that does not match the private key = startup fails.
- Key generation without extra tooling: `dotnet Lotties.Api.dll --generate-vapid-keys` prints a new pair to stdout and exits (no file written; `ECDsa` P-256 from `System.Security.Cryptography`).
- Rotation invalidates every subscription (they are bound to the public key); the web re-subscribes silently on next open because permission stays granted. Document as "rotate only if the private key leaked".
- To-do for the implementer (task N10): docs/DEPLOY.md section "Push notifications" (generate keys, set the three env vars in the deployment secret, subject, allowlist, `sw.js` must stay `no-cache`, HTTPS required), placeholders in `.env.example`, README env table. This spec does not change DEPLOY.md.

## 10. Web: service worker
- Switch `VitePWA` to `strategies: 'injectManifest'`, `srcDir: 'src/pwa/sw'`, `filename: 'sw.ts'` (output stays `sw.js`, matching the nginx `no-cache` rule), `injectManifest.globPatterns` = the current `globPatterns`; keep `registerType: 'prompt'`, `injectRegister: false`, `includeAssets`, the manifest and `darkManifestPlugin` unchanged.
- Tradeoff: `generateSW` + `workbox.importScripts(['push-sw.js'])` keeps the generated worker but the imported file is unbundled plain JS from `public/` (no TypeScript, no imports of the shared catalog or helpers, no Vitest coverage, manual cache-busting). `injectManifest` costs about 30 lines we now own (precache, cleanup, navigation fallback, `SKIP_WAITING`) and gives a typed, bundled, testable worker. Choose `injectManifest`.
- `sw.ts` (thin glue): `precacheAndRoute(self.__WB_MANIFEST)`, `cleanupOutdatedCaches()`, `NavigationRoute(createHandlerBoundToURL('/index.html'), {denylist: [/^\/api(\/|$)/, /^\/auth\/callback/]})` (same as today; still no runtime caching of API calls), `message` `SKIP_WAITING` -> `skipWaiting()` (needed by `useRegisterSW` prompt mode), plus `push`, `notificationclick`, `pushsubscriptionchange`. Dependencies `workbox-precaching`, `workbox-routing` (7.x, already in the tree via workbox-build) become explicit devDependencies. A `tsconfig.sw.json` with `lib: ["ES2022", "WebWorker"]`.
- Both icon files must stay in the precache (`globPatterns` already include `png`).
- Pure, unit-tested modules beside it: `payload.ts` (parse and validate `v:1`; `kind` looked up with an own-property check like `code/web/src/util/ownProperty.ts`; unknown version or kind -> generic "Open the app for details"), `notificationText.ts` (title/body from the bundled `push.{en,pt-BR}.json`, simple `{{name}}` interpolation, times via `Intl.DateTimeFormat(lang, {hour, minute})` in the device zone; no i18next in the worker), `clickTarget.ts` (URL built from kind and validated GUIDs, never from a URL in the payload).
- `push`: always shows a notification (Chrome and Safari require it; Safari revokes subscriptions that do not). Options: `tag` = base key from kind + ids, `renotify` true only for snooze re-sends, `timestamp` = `at`, `lang`, `dir: 'auto'`, `icon` = `/icon-192.png`, `badge` = the existing `/icon-monochrome-512.png` (Android uses its alpha for the status bar; a 96 px export can be added to `code/web/scripts/generate-icons.mjs` later, no new artwork), `actions` (where supported) `[{action: 'snooze', title}, {action: 'open', title}]` for doses, `data` = the payload. No `requireInteraction`, no `silent`, no `image`.
- `notificationclick`: `snooze` -> `fetch(apiBaseUrl + '/api/v1/push/deliveries/{id}/actions', {method: 'POST', body: {action: 'snooze', token}})` (no credentials; `apiBaseUrl` is the same build-time `VITE_API_BASE_URL` as `code/web/src/config/appConfig.ts`, available because the worker is built by Vite; a separate API origin is already covered by the CORS policy), close; otherwise close, then focus an existing same-origin window and `postMessage({type: 'notification-open', ...})`, or `clients.openWindow('/#notify=dose&baby=<id>&rx=<id>&d=<deliveryId>&t=<token>')`. The fragment keeps ids and token out of server logs; the app strips it with `history.replaceState` (as the invite token).
- `pushsubscriptionchange` (Firefox, some Chromium): re-subscribe with the old `applicationServerKey`; the app reconciles the new endpoint with the server on next open (the worker has no access token).

## 11. Web: permission UX and Settings
- Never ask on first load, on the landing, or without a click. `Notification.requestPermission()` is called only inside the click handler of our explainer's "Turn on" button (Safari requires a user gesture; Chrome quiets sites with low acceptance).
- Entry points: Settings > Notifications (`/settings#notifications`); a one-time card after saving a scheduled prescription ("Get a reminder at the scheduled times?" with Turn on / Not now; Not now hides it on this device for 30 days); a "Remind me when the window opens" link in the nap Why sheet. Each opens the same explainer sheet, then subscribes, then turns on that kind for that baby.
- Explainer sheet: what is sent (kinds), that lock-screen text is generic unless "Show names" is on, the guardrail text of section 4, that it can be turned off anytime.
- States (pure `pushSupport.ts` + `permissionState.ts`):
  - `server-disabled` (`enabled: false`): the Notifications section is not shown.
  - `unsupported` (no `serviceWorker`, `PushManager` or `Notification`, or an in-app browser): "This browser can't show notifications from Lotties."
  - `ios-needs-install` (iOS/iPadOS Safari, not standalone): "On iPhone and iPad, notifications work after you add Lotties to your Home Screen: tap Share, then Add to Home Screen, and open it from there." with the existing install hint; `ios-too-old` (below 16.4): "Needs iOS 16.4 or later."
  - `default`: Turn on button.
  - `denied`: how to allow notifications in the browser or system settings for this site; no repeated prompting.
  - `granted` + subscribed: device switch on; `granted` without subscription: Turn on re-subscribes without a prompt.
- Settings section (online-only server state, like measurements; offline shows the last loaded values read-only with "Connect to the internet to change notification settings"):
  1. "Notifications on this device" switch, device label, "Send a test notification".
  2. Per baby (Viewer rows disabled with "Only parents get reminders for this baby"): "Medicine reminders" switch + "Remind me" (At the scheduled time / 5 min before / 15 min before); "Nap window" switch + (When it opens / 10 min before / 20 min before); "Belly pain heads-up" switch ("When belly pain often shows up around the same time, a note 30 min before.", no lead choice); "Overtired heads-up" ("When the baby has been awake nearly as long as usual, a note 15 min before.") and "Fussy time heads-up" ("When fussiness often starts around the same time, a note 30 min before."), both off by default, no lead choice; "Wet diaper heads-up" ("When a wet diaper is usually due, a note 10 min before.") and "Dirty diaper heads-up" ("When a dirty diaper usually comes, after a feed or from the usual gaps, a note shortly before."), both off by default, no lead choice.
  3. Quiet hours switch + start/end time fields; "Also silence medicine reminders in quiet hours".
  4. "Show baby and medicine names on notifications" (explains lock-screen visibility).
  5. "Times use {{zone}}" line; other devices list with Remove.
- Reconcile on every app start while signed in and permission is `granted`: `getSubscription()`; none -> show the device as off; key differs from `publicKey` -> unsubscribe and subscribe again; otherwise POST the subscription (refreshes `last_seen_at`, locale, label). Also on language change (locale) and when the device time zone differs from the stored one (PUT settings).
- Deep link: `/#notify=...` on the Now route selects the baby if the user is a member (else ignored), runs a sync pull (at most 3 s, then shows local state with the usual offline/sync status), opens the Meds tray at that prescription with a small "Reminder for 18:00" line, Snooze 30 min, and (after a snooze) Stop reminders for this dose; nap opens Now. All decisions use local data, never the notification.
- Clean-up: after a sync or a dose log, close shown notifications whose item is resolved (`registration.getNotifications()` filtered by tag).

## 12. Web: offline, logout, accounts
- Turning on, test send and preference changes need a connection (buttons disabled offline with the reason).
- A push reaching an offline device is held by the push service until TTL; a tap while offline opens the app from local data (offline-safe session).
- Logout (existing unsynced-outbox warning first, in `code/web/src/session/endSession.ts`): revoke this device on the server, then `subscription.unsubscribe()`; offline logout unsubscribes locally only (the next send gets 410 and the server revokes). Leaving a baby needs nothing on the web (server cascade).
- Per-account Dexie is untouched; the worker reads no local database.

## 13. i18n (add to both catalogs; parity tests cover the new files)
Worker catalog `code/web/src/i18n/locales/push.{en,pt-BR}.json` (bundled into the worker only):
| Key | en | pt-BR |
|---|---|---|
| `dose_due.title` | Medicine reminder | Lembrete de remédio |
| `dose_due.body` | A scheduled dose for {{time}} is not logged yet. | Uma dose agendada para {{time}} ainda não foi registrada. |
| `dose_due.bodyNamed` | {{baby}}: {{medication}} scheduled for {{time}}, not logged yet. | {{baby}}: {{medication}} agendado para {{time}}, ainda não registrado. |
| `nap_window.title` | Nap window | Janela de soneca |
| `nap_window.body` | The estimated nap window opens around {{time}}. | A janela estimada de soneca abre por volta de {{time}}. |
| `nap_window.bodyNamed` | {{baby}}: the estimated nap window opens around {{time}}. | {{baby}}: a janela estimada de soneca abre por volta de {{time}}. |
| `belly_pain_pattern.title` | A good moment for a belly massage | Hora de uma massagem na barriguinha |
| `belly_pain_pattern.body` | Belly pain often shows up from around {{time}}. | A dor de barriga costuma aparecer a partir de {{time}}. |
| `belly_pain_pattern.bodyNamed` | {{baby}}: belly pain often shows up from around {{time}}. | {{baby}}: a dor de barriga costuma aparecer a partir de {{time}}. |
| `overtired_warning.title` | Awake time is near the usual limit | Tempo acordado perto do limite de costume |
| `overtired_warning.body` | The usual limit is around {{time}}. A nap soon may help. | O limite de costume é por volta de {{time}}. Uma soneca em breve pode ajudar. |
| `overtired_warning.bodyNamed` | {{baby}}: the usual limit is around {{time}}. A nap soon may help. | {{baby}}: o limite de costume é por volta de {{time}}. Uma soneca em breve pode ajudar. |
| `fussy_pattern.title` | Fussy time is coming up | A hora do choro está chegando |
| `fussy_pattern.body` | Fussiness often starts from around {{time}}. A calm routine may help. | A irritação costuma começar a partir de {{time}}. Uma rotina calma pode ajudar. |
| `fussy_pattern.bodyNamed` | {{baby}}: fussiness often starts from around {{time}}. | {{baby}}: a irritação costuma começar a partir de {{time}}. |
| `diaper_wet_headsup.title` | A diaper check may be due | Pode ser hora de olhar a fralda |
| `diaper_wet_headsup.body` | A wet diaper is often due around {{time}}. | Uma fralda molhada costuma vir por volta de {{time}}. |
| `diaper_wet_headsup.bodyNamed` | {{baby}}: a wet diaper is often due around {{time}}. | {{baby}}: uma fralda molhada costuma vir por volta de {{time}}. |
| `diaper_dirty_headsup.title` | A diaper may be coming | Uma fralda suja pode estar a caminho |
| `diaper_dirty_headsup.body` | A dirty diaper often comes around {{time}}. | Uma fralda suja costuma vir por volta de {{time}}. |
| `diaper_dirty_headsup.bodyNamed` | {{baby}}: a dirty diaper often comes around {{time}}. | {{baby}}: uma fralda suja costuma vir por volta de {{time}}. |
| `appointment_reminder.title` | Appointment reminder | Lembrete de consulta |
| `appointment_reminder.tomorrow` / `today` | Appointment tomorrow at {{time}}. / Appointment today at {{time}}. | Consulta amanhã às {{time}}. / Consulta hoje às {{time}}. |
| `appointment_reminder.hours` / `minutes` | Appointment in 2 hours, at {{time}}. / Appointment in 30 minutes, at {{time}}. | Consulta daqui a 2 horas, às {{time}}. / Consulta daqui a 30 minutos, às {{time}}. |
| `appointment_reminder.week` / `on` | Appointment in a week, on {{date}} at {{time}}. / Appointment on {{date}} at {{time}}. | Consulta daqui a uma semana, {{date}}, às {{time}}. / Consulta marcada para {{date}}, às {{time}}. |
| `appointment_reminder.*Named` | {{baby}}: appointment ... (each phrase above) | {{baby}}: consulta ... |
| `test.title` / `test.body` | Notifications are on / This is a test from Lotties. | Notificações ativadas / Este é um teste do Lotties. |
| `generic.title` / `generic.body` | Lotties / Open the app for details. | Lotties / Abra o app para ver os detalhes. |
| `action.snooze` / `action.open` | Snooze 30 min / Open | Adiar 30 min / Abrir |

App catalogs (`notifications.*` in `en.json`/`pt-BR.json`): section title, device switch, test button and results, explainer title/body/guardrail, every state message of section 11, per-baby labels and lead options, quiet hours labels, show-names label and help, time zone line, devices list, prompt card, deep-link reminder line, offline notes, plus `errors.push_not_configured`, `errors.push_endpoint_not_allowed`, `errors.notification_action_not_found`, `errors.snooze_limit_reached`. Copy rules of docs/DESIGN.md sections 6 and 9 (sentence case, no exclamation marks, informal "você"). Times only via `code/web/src/i18n/format.ts` in the app.

## 14. Accessibility
Settings controls reuse `SwitchRow`, `Field`, `SegmentedControl` and the time field (labels, keyboard, focus rings); the explainer sheet traps and returns focus; subscription results are announced in a polite live region ("Notifications are on for this device"); notification text is self-contained (no meaning carried by icon or colour, no emoji); `lang` set on each notification; axe in light/dark/night and en/pt-BR for the section and the sheet.

## 15. Platform support (to re-check during N11)
| Platform | Push | Needs install | Action buttons | Notes |
|---|---|---|---|---|
| Chrome / Edge desktop (Windows, macOS, Linux) | yes | no | yes | delivered while the browser runs (background allowed by default on Windows) |
| Chrome Android, Samsung Internet | yes | no | yes | installed PWA recommended for reliability |
| Firefox desktop / Android | yes | no | desktop yes | `pushsubscriptionchange` fires on endpoint change |
| Safari macOS 13+ (Safari 16.1+) | yes | no | no | permission only from a user gesture |
| Safari iOS / iPadOS 16.4+ | yes | Home Screen web app only | no | no notifications in a Safari tab; subscriptions revoked if pushes do not show notifications |
| iOS below 16.4, in-app browsers (WhatsApp, Instagram), Brave with Google push off | no | | | shown as `unsupported` / `ios-too-old` |
Snooze is always available in the app (deep link) where action buttons are missing.

## 16. Security checklist
SSRF allowlist on subscribe and send; endpoints and keys never logged, never returned; action token single-purpose, hashed, 12 h; anonymous action route rate-limited per address and returns one 404 code; notification click opens only same-origin URLs built from validated GUIDs; payload names only with opt-in; VAPID private key env only, validated at startup; no CSP change needed (subscription goes through `PushManager`, not `fetch`; the snooze fetch is same-origin).

## 17. Testing
- Domain (xUnit): `NotificationPlanner` table tests (each rule in sections 2 and 3), `PushEndpoint`/`PushKeys` validation, quiet hours, lead sets, dedupe keys, snooze counts; additive `OverdueSlotAt` and `AnchorAt` in the calculator and engine tests.
- API (WebApplicationFactory on SQLite, header test auth): every route (401, 403 Viewer, validation, allowlist 422, upsert/transfer/un-revoke, revoke idempotent, max devices, prefs cascade on member removal, rate limits 429, `push_not_configured`); scheduler driven by `INotificationTick.RunOnceAsync(now)` with `FakeTimeProvider` (Microsoft.Extensions.TimeProvider.Testing) and `FakePushSender` (records messages; scripted 201, 410, 400, 429 + Retry-After, 500, timeout): dose slot lifecycle, logged dose stops reminders, co-parents each get one, snooze re-send and cap, dismiss, quiet hours, stale cutoff after downtime, crash between claim and send retried, two ticks concurrently produce one delivery (unique index), lease taken by another holder skips, housekeeping.
- Infrastructure: model/snapshot tests for the new tables and indexes; `WebPushSender` against a fake `HttpMessageHandler` asserting `TTL`, `Urgency`, `Topic`, `Authorization: vapid t=..., k=...`, `Content-Encoding: aes128gcm`; decrypt the body with a test key pair to check the payload round-trip.
- Web (Vitest): support/permission state machine (iOS standalone and versions, denied, unsupported), reconcile (mocked `PushManager`: key change, missing subscription, locale/zone change), worker modules (payload parsing, text in both languages, click targets, tags), deep link handling (opens the Meds tray, strips the fragment, ignores foreign babies), Settings section and explainer (axe, en/pt-BR, offline read-only), prompt card timing, logout revokes; i18n parity including `push.*.json`; a build check that `dist/sw.js` contains the precache manifest and the denylist.
- No e2e push delivery (needs a real push service); one e2e spec for the Settings section with notification permission granted in Chromium and the subscribe call asserted.
- Manual device checklist (task N11, HTTPS staging): Android Chrome (tab and installed), desktop Chrome, Edge, Firefox, macOS Safari, iPhone 16.4+ Home Screen app and Safari tab guidance; enable, test, dose reminder at slot and with lead, snooze action and in-app snooze, dose logged by the co-parent stops theirs, quiet hours, show names off/on on the lock screen, airplane mode then reconnect within TTL, permission denied recovery, logout unsubscribes, account switch transfers the endpoint, VAPID rotation re-subscribes.

## 18. Observability
- `Meter` `Lotties.Push` (no exporter dependency; readable with `dotnet-counters`): counters `push.planned{kind}`, `push.sent{kind}`, `push.failed{kind,status}`, `push.gone`, `push.skipped{reason}` (stale, quiet_hours, unavailable, limit, snoozed, dismissed, spacing, daily_cap), `push.actions{action}`; histograms `push.tick.duration`, `push.send.duration`; observable gauge `push.subscriptions.active`.
- Logs: Information per tick only when something was sent (counts), Warning for ticks over 10 s, lease lost repeatedly, 413, 10-failure revocations; Debug per delivery (delivery id, subscription id, kind, push service host, status). Never endpoints, keys, tokens, payloads or names.
- Delivery rows answer support questions ("was it sent?") for 14 days.

## 19. Rollout (ordered tasks)
| # | Task | Tier | Deps | Verify |
|---|---|---|---|---|
| N1 | Domain `Notifications/`: entities and value objects, `NotificationPlanner`, additive `MedicationStatus.OverdueSlotAt` and `Prediction.AnchorAt`, tests | Careful | none | `dotnet test` |
| N2 | Infrastructure: EF configurations, migration `PushNotifications`, repositories, `job_leases`, model tests | Careful | N1 | model + SQLite tests |
| N3 | Infrastructure: `WebPushSender` (library), `Push` options + validator, env aliases, `--generate-vapid-keys` | Medium | N1 | sender tests (fake handler, decrypt) |
| N4 | Application + Api: endpoints, rate limit policies, error codes, SPEC "Push notifications" contract section, remove push from SPEC non-goals | Medium | N2, N3 | endpoint tests |
| N5 | Scheduler: `NotificationDispatcher`, lease, claim/send/retry, housekeeping, metrics | Careful | N2, N3 | scheduler tests with fake sender + fake time |
| N6 | Web: move to `injectManifest` TypeScript worker with today's behaviour only (precache, navigation denylist, `SKIP_WAITING`) | Careful | none (parallel with N1-N5) | build, offline reload and update prompt unchanged, Lighthouse PWA installable |
| N7 | Web: worker `push`/`notificationclick`/`pushsubscriptionchange`, `push` catalogs | Medium | N6 | worker module tests |
| N8 | Web: `notifications/` module (support, permission, reconcile, API), Settings section, explainer, iOS guidance, logout hook, i18n, axe, dev preview `/dev/notifications?state=` | Medium | N4, N7 | Vitest, axe, screenshots light/dark/night en/pt-BR |
| N9 | Web: prescription prompt card, nap Why sheet link, deep link into the Meds tray, in-app snooze, closing resolved notifications | Medium | N8 | Vitest |
| N10 | Docs: DEPLOY.md push section, `.env.example` placeholders, README env table, filemap | Light | N4, N8 | review |
| N11 | Manual device checklist on HTTPS staging, fix-ups | Medium | N5, N9, N10 | checklist in the PR |
| N12 | v1.1 `coparent_activity` | Medium | N11 + owner go | tests |

## 20. Open questions for the owner
1. As-needed medicines: keep without reminders (recommended), or add an opt-in "can be logged again from 18:00" notice per prescription?
2. Bed-time window: add it as its own opt-in kind in v1.1, or never?
3. Quiet hours default on 22:00-07:00: right default?
4. Medicine reminders in quiet hours: delivered by default (recommended, the parent scheduled the time) or silenced by default?
5. Viewers (e.g. grandparents) never get baby reminders in v1: confirm.
6. Snooze fixed at 30 minutes, at most 3 times: confirm, or offer 15/30/60?
7. "Show names" off by default, and when on shows baby and medicine names together: confirm, or allow the baby name only?
8. `coparent_activity` in v1.1: wanted, and should it include the co-parent's display name when names are on?
9. VAPID subject: which operator contact (`mailto:` address or https URL) for the production deployment?
