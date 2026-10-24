# Recurring time-of-day patterns (design, 2026-10-22)

Status: implemented for belly pain (owner request), then for the evening fussiness ("hora da bruxa", section 7) together with the overtired heads-up from wake windows (section 6), then the diaper predictions and heads-ups (section 8). Babies often have belly pain every day around the same time; the app notices it from what the family logged and suggests a belly massage shortly before. The detector is generic: the fussy pattern reuses it with its own event type.

## 1. Detector: `RecurringTimeOfDayPattern` (Domain/Patterns)
Pure, deterministic, order-independent. Input: the local wall-clock times of one event type and the local date of today. The caller converts instants with `LocalClock`: with an IANA zone every instant gets the offset in force at that instant (a daylight saving change inside the look-back keeps "18:00" at 18:00); without one, a fixed UTC offset.

Rules (`RecurringTimeOfDayOptions.Default`):
1. Look-back: the last 14 local calendar days, today included. Later times are ignored.
2. Times of day sit on a 24-hour circle: 23:50 and 00:10 are 20 minutes apart.
3. Cluster centre: the event time with the most calendar days having an event within 90 minutes of it (ties: more events within 90 minutes, then the smaller total distance of those events, then the earlier time).
4. A day is one occurrence around the centre: events up to 12 hours either side of the same usual time belong to the same day. Several events of one day count once; a night around midnight (23:50 and 00:15) counts once.
5. One sample per day: its event closest to the centre (within 90 minutes). Usual time = circular mean of the samples (to the minute); spread = circular standard deviation `sqrt(-2 ln R)`. Spread over 45 minutes: no pattern.
6. Window = usual time ± max(30 minutes, the spread), at most 3 hours wide (the clamp only matters with other options: with the default spread limit the window is at most 90 minutes).
7. Pattern only when both hold: at least 60 % of the days with an event have one inside the window (coverage over the 14 days), and at least 4 of the last 7 local days (today included) have one inside the window (the recency rule; 4 of 7 was chosen over 5 of 10).
8. Confidence: high with 8 or more supporting days and a spread up to 30 minutes, medium with 6 or more, low otherwise.

Output (`TimeOfDayPattern`): usual time, window start and end (local `TimeOnly`; the window crosses midnight when the end is earlier), width, spread, confidence, the supporting days (calendar date of the day's first time inside the window, and its times inside the window, oldest day first), the number of days with an event and the recent supporting days. `WindowStartingOn(date)` places the occurrence that starts on a local date.

Reuse: a later kind (e.g. fussiness) passes its own events to `RecurringTimeOfDayPattern.Detect`, adds a `XxxPatterns` helper like `BellyPainPatterns`, an entry in the predictions `patterns` list with its `typeKey`, and, if wanted, its own notification kind. Nothing in the detector knows about belly pain.

## 2. Architecture (follows the nap window)
The nap window is computed by the API (`GET /predictions`) and the web keeps the last response per baby in localStorage for offline use. The belly pain pattern follows it: `GET /babies/{id}/predictions?utcOffsetMinutes=&timeZone=` returns `patterns` (additive, see docs/SPEC.md "Predictions"), so there is no TypeScript port of the detector and no shared vectors. What depends on the last minutes (whether the window was handled, "Not today") is decided on the device from local events, as the awake/asleep state is.

## 3. The suggestion on Now
- Shown in the regular Now layout (below the state card) while now is between window start - 45 min (`rule.leadMinutes`) and the window end, when the pattern exists and no belly pain or belly massage was logged from window start - 45 min on (a massage still running from before also counts). Not in the first-run or night layouts.
- Text: "Belly pain often shows up around 18:00. A belly massage may help." (the usual time of that occurrence).
- Start massage: runs the existing belly massage timer preset with nothing preset (the reason and "did it help" stay for the person to fill in). Disabled for Viewers.
- Not today: hides the card for this window (the local date the window starts on) on this device, per baby; stored in localStorage and cleared with the account's other device state.
- Why?: a sheet with the usual window, how many of the last 7 days had belly pain in it, the rule in plain words, the days and times used (newest first) and "This is a pattern from what you logged, not medical advice. If the pain keeps coming back, mention it to your pediatrician."
- Wording rules: no alarm, no diagnosis, no urgency; hidden when there is no pattern.

## 4. The push (`belly_pain_pattern`)
Opt-in per device and per user and baby ("Belly pain heads-up", off by default; column `baby_notification_preferences.belly_pain_pattern`, migration `BellyPainPattern`). The planner reads the pattern in the recipient's time zone and sends one heads-up per baby and local day 30 minutes before the window starts, unless a belly pain or massage was logged from window start - 45 min on. Quiet hours always apply (not a medicine). Key `belly:{baby}:{local date}`, expiry 15 minutes after the window ends. Details in docs/design/09-push-notifications.md section 2.5.

## 5. Tests
Domain: detector (tight cluster, noise, spread over the limit, midnight wrap, recency, look-back edges, coverage, per-day dedupe, width clamp, confidence, input order), DST day with a zone vs a fixed offset, planner rules. API: predictions `patterns` and the time zone fallback, preferences, scheduler end to end. Web: suggestion logic, the card (lead window, logged, Not today persisted, Why sheet, Start massage), settings switch, worker payload/text/link, pt-BR, axe.

## 6. Wake window and the overtired heads-up ("hora da bruxa", 2026-10-22)
Owner request: the baby stays awake too long, gets overtired and starts crying. No new logging: the heads-up comes from the sleep log.

### 6.1 Rules (`WakeWindows.Measure`, Domain/Predictions; options `WakeWindowOptions.Default`)
Pure, deterministic, order-independent.
1. Sleep events become sleep sessions as for the nap window (`SleepSessions`): night wakings are not sleep, `bed_time` to `woke_up` (at most 16 h) is a night, a timer right after `fell_asleep` inside a night is that night.
2. An awake stretch runs from the latest end of the sessions so far to the start of the next session (so a session logged inside another one never makes a negative or split stretch). It is finished when the next session started.
3. Only stretches that started in the last 14 days, between 05:00 (inclusive) and 18:00 (exclusive) local time, count: daytime stretches. Local times come from `LocalClock` (the IANA zone of the request or the recipient, daylight saving applied per instant; without a zone a fixed offset). Lengths are elapsed time, so a daylight saving change never stretches or shrinks one.
4. Stretches under 1 minute (overlapping or duplicate logs) and over 3 times the plain median (a nap that was not logged) are dropped, as the predictions engine does.
5. With fewer than 5 stretches left there is no wake window: nothing is guessed, no card, no push.
6. The limit (the usual longest comfortable awake stretch) is the 75th percentile of the stretches (linear interpolation between the closest ranks), rounded to the minute: three out of four stretches were this long or shorter.
7. The current stretch starts at the latest sleep end (a finished session or a `woke_up` marker). There is none while a sleep runs (a timer, or a `bed_time` night without its wake-up), after a lone `fell_asleep` newer than that end (at most 16 h old), or when a night waking ended at or after it (the baby is up in the night).

Output (`WakeWindow`): the limit, the stretches used (oldest first) and `AwakeSince` (or `null`); `LimitAt` = awake since + limit.

### 6.2 Architecture
As the nap window and the patterns: `GET /predictions` returns `wakeWindow` (docs/SPEC.md "Predictions"; `null` with too few stretches) and the web keeps the last response for offline use. The web takes only the limit (and the rule and stretches for Why?) from it and measures the current stretch from local events, like the awake/asleep state, so a nap started offline hides the card at once.

### 6.3 The card on Now
- Regular Now layout, right below the state card. Shown while the baby is awake (state card "awake", no night waking since the last sleep) from `limit - 15 min` until `limit + 30 min` of the current stretch. Hidden when a sleep runs, without a wake window, and in the first-run and night layouts.
- Text: "Witching hour soon: awake for 2h 20m, usually fussy after about 2h 30m. A nap soon may help." pt-BR: "A hora da bruxa está chegando: tempo acordado 2 h 20 min, e a irritação costuma começar depois de cerca de 2 h 30 min. Uma soneca em breve pode ajudar." (gender-free: no "acordado(a)" or "irritada").
- Start nap (primary): runs the existing Nap timer preset (disabled for Viewers). Not now: hides the card for this awake stretch (its start instant, per baby, localStorage, cleared with the account's device state). Why?: awake since and for how long, the usual limit, the rule in plain words (percentile, daytime hours, look-back, minimum, the lead and grace), the stretches used (newest first, day, start to end, length) and "This is a pattern from what you logged, not medical advice. If the crying worries you, talk to your pediatrician." (the only mention of the pediatrician).

### 6.4 The push (`overtired_warning`)
Opt-in per device and per user and baby ("Overtired heads-up", off by default; column `overtired_warning`, migration `FussyAndOvertiredPrefs`). The planner reads the wake window in the recipient's time zone; one heads-up per awake stretch at `limit - 15 min` (15 min stale cutoff), nothing once a sleep started, quiet hours apply, key `overtired:{baby}:{awake since}`, expires at `limit + 30 min`. Details in docs/design/09-push-notifications.md section 2.6.

## 7. The fussy pattern (evening fussiness, 2026-10-22)
- New built-in type `fussy` ("Fussy / crying", pt-BR "Choro / irritação"; optional timer; optional `intensity` mild|moderate|intense and `what_helped` feeding|rocking|pacifier|massage|sleep|other|nothing; care category; unpinned Fussy timer preset). Later (migration `FussyOutcomes`, for "Why is she crying?", docs/design/27-cry-reasons.md): `what_helped` gained diaper_change|burping|holding (appended) and the type the hidden optional `suggested_cause` hunger|sleepy|diaper|gas|comfort (what the app ranked first). The pattern detector ignores the payload, so neither changes it.
- `FussyPatterns.Detect` passes the baby's fussy spells to `RecurringTimeOfDayPattern.Detect` with the default options (nothing in the detector changed); the predictions `patterns` list carries a `typeKey: "fussy"` entry next to `belly_pain`.
- Now card while now is between window start - 45 min and the window end, unless a fussy spell was logged from window start - 45 min on (a spell still running counts) or "Not today" was chosen for that window: "Fussiness often starts around 18:00. A calm routine may help." with Not today and Why? only (no action button: a calm routine is a suggestion, not a timer). Why? lists the window, the count, the rule, the days and times and the disclaimer ("... If the crying worries you, mention it to your pediatrician.").
- Push `fussy_pattern`: the belly pain rules (30 min before the window, skipped once a fussy spell was logged from window start - 45 min, quiet hours, key `fussy:{baby}:{local date}`); "Fussy time heads-up", off by default (column `fussy_pattern`). Details in docs/design/09-push-notifications.md section 2.7.
- Wording rules as for belly pain: patterns from the log, never a diagnosis or medical advice, no alarming words.

## 8. Diapers: when the baby will probably pee and poop (2026-10-22)
Owner request: predict the next wet and dirty diaper and let parents opt in to heads-ups. No new logging: the diaper `content` (`WET`, `DIRTY`, `MIXED`) and the feeds are enough. A wet diaper is one marked `WET` or `MIXED`, a dirty one `DIRTY` or `MIXED`.

Heuristics only. The backtest (docs/ml/BENCHMARK.md) found that diapers were the one target where a learned model helped a little (ensemble MAE -11 % in the test window, -5 % in validation, about 12 minutes on a 108-minute error), not enough to carry a model service; the rules below stay pure Domain functions and can be revisited with the shadow-mode gate of that report.

### 8.1 Rules (`DiaperPredictions.Predict`, Domain/Predictions; options `DiaperPredictionOptions.Default`)
Pure, deterministic, order-independent; events after now are ignored. Gaps and lags are elapsed time between instants, so a daylight saving change never stretches or shrinks one (no clock is needed).
1. Wet: with at least 8 wet diapers in the last 7 days, the gaps between consecutive ones lose duplicates (under 1 minute) and outliers (over 3 times the plain median, a change that was not logged); with at least 3 gaps left, the next wet diaper is expected at the latest wet diaper plus the recency-weighted median gap (half-life 4 days, as the predictions engine), usually between the 25th and 75th percentile gaps (the nap window's q25-q75 calibration). Fewer: no estimate.
2. Dirty, gap signal: the same over the last 14 days with at least 5 dirty diapers.
3. Dirty, after-feed signal: for each dirty diaper of the last 14 days, the latest feed that ended at most 3 hours before it (an instant feed ends when it starts; running feeds are skipped), when that dirty diaper is the first one after the feed. With at least 5 such pairs and the 25th to 75th percentile of the lags (interpolated, to the minute) at most 40 minutes apart, the next dirty diaper after a feed is expected after the median lag, usually between those percentiles. Otherwise no after-feed signal.
4. Which dirty expectation applies now: after the latest finished feed when the after-feed signal passed, that feed ended at most 3 hours ago and no dirty diaper came since it ended; otherwise the gap signal (anchored at the latest dirty diaper). Neither gate passed: no dirty estimate. Nothing is ever guessed and no "low quality" numbers are shown.
5. Confidence: gaps high from 20 gaps with a window (upper - lower) at most half the median, medium from 10 with a window at most the median, low otherwise; the lag after feeds high from 15 pairs with a spread up to 20 minutes, medium from 8 with up to 30 minutes, low otherwise.
6. Wet trend: wet diapers of the last 24 hours against the usual count per 24 hours before them (at least 2 days of history). At most half of a usual count of at least 4 is a sharp drop; it only adds a gentle line to the Why sheet.

Output (`DiaperPrediction`): `Wet` and `Dirty` (`Gap`, `AfterFeed`, `LastDirtyAt`), each `null` when its gate did not pass, and the wet trend; `WetExpectation()` and `DirtyExpectation(now)` give the signal, the anchor and the window.

### 8.2 Architecture
As the wake window: `GET /predictions` returns `diaper: {wet, dirty, rule}` (docs/SPEC.md "Predictions") and the web keeps the last response for offline use. The web takes the gaps, the lags and the rule from it and anchors them at its latest local events (the latest wet or dirty diaper, the latest finished feed, each the later of the server's and the local one), so a diaper logged a moment ago (or offline) moves the next expected time and hides the card at once.

### 8.3 The cards on Now
- Regular Now layout, after the pattern cards; not in the first-run or night layouts. One card per kind; both can show at once.
- Shown from 20 minutes before the expected time until 40 minutes after it (`rule.leadMinutes`, `rule.graceMinutes`), hidden without an estimate. A diaper of the kind logged since the anchor moves the anchor, which hides the card.
- Text: wet "Diaper check likely around 15:40." (pt-BR "Troca de fralda provável por volta de 15:40."); dirty after a feed "A dirty diaper often follows feeds after about 30 minutes." ("Uma fralda suja costuma vir cerca de 30 minutos depois das mamadas."); dirty from the gaps "A dirty diaper may come around 15:40." ("Uma fralda suja pode vir por volta de 15:40."). Gender-neutral, never alarming.
- Log diaper (primary): opens the existing diaper tray (disabled for Viewers). Not now: hides the card for this anchor (per baby and kind, localStorage, cleared with the account's device state). Why?: the expected window, the latest diaper (or the end of the feed), the typical gap or the lag with the counts, the rule in plain words, the confidence, a gentle note when wet diapers dropped sharply ("... If that continues, mention it to your pediatrician.", the only mention of the pediatrician) and "This is a pattern from what you logged, not medical advice."

### 8.4 The pushes (`diaper_wet_headsup`, `diaper_dirty_headsup`)
Two kinds, each opt-in per device and per user and baby ("Wet diaper heads-up", "Dirty diaper heads-up", off by default; columns `diaper_wet_headsup`, `diaper_dirty_headsup`, migration `DiaperHeadsUpPrefs`). Wet: one heads-up 10 minutes before the expected wet diaper; dirty: at feed end + the lower lag when the after-feed signal applies, else 5 minutes before the gap-based expected time. At most 3 per kind, baby and recipient per local day (counting the ones sent or being sent) and never two of either kind within 60 minutes; quiet hours apply; expiry 30 minutes after the expected time; keys per baby, kind and anchor. Details in docs/design/09-push-notifications.md section 2.8.


### 8.5 On the ring (2026-10-24)
The day ring and the ruler on Now also place the next wet and dirty diaper, and the belly pain and fussy windows still ahead today, as small dashed markers on their "next up" lane (docs/DESIGN.md "Now: next up on the ring", `now/upcoming.ts`). They read the same estimates as the cards (`wetEstimate` / `dirtyEstimate`, the cards' windows without their 20 min lead and 40 min grace; `occurrenceOn` of the pattern), so the ring and the cards never disagree; a poop needs at least 3 dirty gaps (or feed pairs) behind it, and a pattern window already handled is not shown.

## 9. Tests (wake window, fussiness and diapers)
Domain: wake window maths (interpolated 75th percentile, rounding, fewer than 5 stretches, daytime edges 05:00 and 18:00, 14-day look-back, overlap and outlier drops, input order, running sleep, lone `fell_asleep`, night waking after or inside the night, markers, other types and future events, a daylight saving week read in the zone vs a fixed offset), fussy detector reuse, planner (`overtired_warning`: send time, claimed once, new stretch new key, asleep, stale, expiry, quiet hours, opt-outs, snooze; `fussy_pattern`: as belly pain plus independence of the two pattern kinds), preferences merge. API: `wakeWindow` in the predictions, the fussy pattern, the merging PUT for every kind, the new columns and migrations, scheduler end to end with a retry. Web: suggestion logic, both cards (timing, hidden cases, Not now / Not today persisted, Why sheets, Start nap, Viewer), settings switches, worker payloads/text/tags/links, resolved-notification clean-up, pt-BR, axe in both schemes.

Diapers: Domain maths (wet and dirty gates, no data, duplicates and logging gaps, tight vs noisy confidence, recency weighting, a daylight saving week, input order and future events, the lag after feeds with its gates, first dirty diaper after a feed only, instant and running feeds, which dirty expectation applies, the wet trend), planner (wet and dirty send times, keys per anchor, stale cutoff, expiry, a diaper logged since, quiet hours, opt-outs, the daily cap of 3, the 60-minute spacing across both kinds also within a tick, other users and babies), preferences merge. API: `diaper` in the predictions, the history's diaper content, the merging PUT, the new columns, the migration order, the counted heads-ups repository, scheduler end to end (wet heads-up, logged wet diaper, retry text, dirty held back by the spacing, failed heads-ups not counted). Web: suggestion logic, both cards (timing, hidden cases, Not now persisted, Log diaper, Why sheets with the drop note, Viewer, pt-BR), settings switches, worker payloads/text/tags/links, resolved-notification clean-up, axe in both schemes.
