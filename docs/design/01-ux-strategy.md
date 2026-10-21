# 01 · UX strategy: from event logger to calm co-pilot

Status: proposal from the design review (2026-10-21). Lens: jobs, journeys, information architecture. Keeps DESIGN.md tokens, event sheet (§10) and timeline rows (§11); changes what sits where and how logging works.

**Thesis.** Parents don't open the app to "log an event". They open it to answer *"what's going on with her, and what's next?"*. Logging is how they keep that answer true. So the home screen should be the answer, and every log should be one tap away from it.

## Research notes

Web search, mostly store listings and vendor pages: signals, not proof.
- **Huckleberry**: SweetSpot recalculates the rest of the day after an off-script morning; next window on the lock screen (Live Activities). Lesson: a prediction is a living plan, not one number.
- **Napper**: a 24-hour circular day clock. A reviewer needed about a week of data before predictions felt right. Night waking is separate from waking up. Lessons: show the learning period; make night waking effortless.
- **PiyoLog**: built for a couple sharing in real time, one-handed, with a very wide record list. Lesson: handover and "log anything" are core.
- **Native feed timers** (Booby Track, Feed Easy, Bebito) live on the lock screen. A PWA can't: iOS has no PWA shortcuts or widgets; Web Push, Badging and Screen Wake Lock need an installed app on 16.4+ (firt.dev). Lesson: the in-app path must be the fastest in the category.
- **NN/g, flexibility and efficiency**: accelerators must not get in novices' way, and most users won't customise. Good defaults and "remember the last value" beat settings.
- **Parent research** (BSA 2018; an Australian study covered in 2024): trackers can empower or create guilt and "techno anxiety". So no red "overdue", no scores, and the baby is compared only with herself.
- Nothing usable on Sprout, Glow's reports or Baby Tracker (Nighp); general knowledge there.

Sources: huckleberrycare.com/blog/sweetspot-your-smart-sleep-timing-companion · techradar.com/computing/websites-apps/napper · cafebazaar.ir/app/jp.co.sakabou.piyolog · producthunt.com/p/bebito-baby-tracker · firt.dev/notes/pwa-ios · nngroup.com/articles/flexibility-efficiency-heuristic · eastmojo.com/features/2024/07/19/baby-apps-are-everywhere-but-their-use-can-carry-hidden-dangers

## 1. Jobs to be done and moments that matter

| Job | When…, I want…, so… | Today |
|---|---|---|
| J1 Capture | When I'm busy with the baby, I want to record it in seconds, one-handed, so I don't have to remember later | Generic grid; the "+" opens a placeholder |
| J2 Recall | When she fusses, I want to know when she last ate, slept or was changed, and which side, so I can decide what to do | Not on Home |
| J3 Anticipate | When I plan the next hours, I want to know roughly when she'll need sleep or food, so I can time a shower, my nap or an outing | Prediction cards, no plan |
| J4 Hand over | When the baby changes hands, I want the other caregiver to know her state and what happened, without a briefing | Missing |
| J5 Medicate safely | Before giving medicine, I want to see what was given, when, by whom, and when the next dose is allowed | Missing |
| J6 Reassure | When I'm worried, I want to compare today with *her* normal | Missing |
| J7 Report | At the paediatrician, I want an accurate summary plus my questions | Missing |
| J8 See progress | At the end of the week, I want to see what is getting better, so I feel competent and can adjust routines | Missing (planned as Insights, pass 2) |

**Moments**
- **3 a.m. feed.** Dark room, baby on one arm, brain at 30%. Needs a dim screen with three huge targets, last values prefilled, which side to start, the screen kept on while nursing, no keyboard, no decisions. Today the Feeding tile starts a timer with no method, Stop then fails silently (§2.4), and breast sides are typed as seconds.
- **Handover** (shift change, back from work, grandparent arriving). Needs what happened since I left and who logged it, her state, medicines given and when the next dose is allowed, and a text for a nanny with no app.
- **"Is this normal?"** (fewer wet diapers, a long nap, a colic evening). Needs her 7-14-day baseline beside today, calm wording, and a quick way to save a question for the doctor.
- **Planning the day.** Today as a ribbon with the next nap and feed as ghosts that move when the day goes off-script.
- **Doctor visit.** Last 24 h, 7 days or since the last visit: medicines and symptoms with times, latest weight, saved questions; shown on the phone or shared.
- **First five minutes.** Value before data: import from Napper, or answer "asleep or awake right now?".

## 2. Critique of the current information architecture

Today the header holds the baby, sync and account. The bottom bar is **Home · Timeline · (+) · Growth · Settings**.

1. **Organised around our data model, not the parent's questions.** Home shows every event type as an equal tile (Breast pump weighs as much as Diaper), Timeline shows rows, Growth a table. Answering J2 ("when did she last eat?") means reading the timeline.
2. **Logging is split three ways**: the Home grid, pinned presets (planned), and the Track sheet behind "+", which today says "Quick actions will appear here". The most prominent control opens an empty sheet. Three surfaces, three mental models.
3. **Sleep is five buttons.** Wake-up, Nap, Bedtime, Fell asleep and Night waking copy Napper's categories. A tired parent thinks in one bit: asleep or awake. The kind should be inferred and correctable, not chosen.
4. **Timers first, details later, and it breaks.** Feeding is a duration type with a required `method`; the generic tile starts a feed without one. On Stop the server rejects the completed event (400), sync dead-letters it and restores the server copy: the feed silently "un-stops". Same for any custom duration type with required fields.
5. **Wrong emphasis in the bar.** Growth (monthly, online only) and Settings (setup) take two of four tabs, while handover, medicines, insights and the doctor summary have no home. Invites and the Napper import, the two flows that decide whether a family adopts the app, are accordions inside Settings.
6. **Predictions are cards with Low/Medium/High chips**: accurate but clinical, floating without the day around them; "Overdue" suggests the parent is late.
7. **The day is split**: counts on Home (planned), events on Timeline, the plan nowhere.
8. **Roles are second-class.** Viewers get a disabled logging grid instead of a view made for them. `createdBy` is stored but never shown, so nobody can tell who logged what.
9. **No night behaviour.** A dark theme is not a night mode: same density and text size, and the screen sleeps mid-feed.

## 3. IA concepts

**A. "Now" dashboard.** Home is a live state card ("Awake 1 h 20 min · nap window 14:05-14:35") with the one action that changes the state, four "last & log" tiles (Feed, Diaper, Meds, one pinned), a catch-up card and a day ribbon.
- Pros: answers J2-J5 at a glance; one-tap logging; useful with sparse data.
- Cons: depends on good state inference; can get busy.

**B. Day canvas.** Home is a vertical 24-hour calendar: past events as blocks, a now line, predicted nap and feed as ghost blocks; tap empty space to backfill; quick-log bar at the bottom.
- Pros: best for planning (J3), backfilling, patterns.
- Cons: dense, small targets at 3 a.m.; meaningless in week one; hard one-handed.

**C. Quick-log bar (conversational).** One input everywhere: "120 ml 10 min ago", "xixi", "cocô"; chips learn your phrases; history reads as a stream.
- Pros: custom things for free; fast for experts.
- Cons: offline parsing in en and pt-BR, ambiguity, typing at night, poor discoverability; voice is not offline or private everywhere.

**D. Ambient.** Notifications ("nap window opens in 15 min", "Ana started a feed"), Android shortcuts and notification actions, an in-app night console that keeps the screen on.
- Pros: no navigation in those moments.
- Cons: PWA limits (no iOS widgets or shortcuts, push only when installed), push infrastructure, notification fatigue. A complement, not an IA.

### Recommendation

**A as the home**; B's ghost predictions in a **Day** tab and a compact ribbon on Now; D's **night console** in-app now, push later; **C as a P2 experiment**.

- **Bottom bar: Now · Day · Insights.** No centre "+": logging lives on Now (tiles + More); Day has a FAB for backfilling.
- **Header:** baby avatar → **Baby profile** (Family & invites, Things we track, Medicines, Import, Measurements); account avatar → **Settings** (appearance, language, sync, sign out).
- **Growth** becomes an Insights section; a measurement is logged like anything else.

**Why.** The bar holds only the three daily questions: what now, how was the day, how is she doing. Setup moves to its subject, the baby. One logging model everywhere. The home is useful from the first tap, not after a week of data.

## 4. Top 5 flows, redrawn

Taps are counted from the app already open on its home screen; typing is counted separately. "Pass B" means DESIGN.md §3-5 as planned (pinned presets plus the Track sheet).

| Task | Today (main) | Pass B (planned) | Proposed |
|---|---|---|---|
| Night bottle, same as last time | ~9 + keyboard; Stop may fail | 3-4 | **2** |
| Night nursing, both sides | ~10 + typing seconds | ~6 + typing | **4**, no typing |
| Nap start and stop | 2 (backdating ~6) | 2, after choosing among 5 sleep tiles (backdating ~4) | **2** (backdating +1) |
| Handover to partner | 1 + reading ~20 rows; no who, no medicines | 0 for 4 "last" lines; no who, no medicines | **0** (catch-up card); share with a nanny: 3 |
| Last 24 h for the doctor | 2 + reading and mental arithmetic; no share | 3 + reading; no share | **3**, including share |
| Add a custom thing and log it | ~9 + typing, online only | ~9 + typing | **3** + typing the name |

1. **Night feed.** The night console shows **Feed · Diaper · Back asleep**. **Feed** opens on the last method. Bottle: a big "Log 120 ml formula" repeats the last feed; chips 60/90/120/150 change it; the Undo snackbar offers −5/−10 min. Breast: "Start right (left last time)" opens a live L/R timer; tap the other side to switch, then **Done**. The screen stays awake and per-side seconds fill in automatically.
2. **Nap.** The state card reads "Awake 1 h 52 min · nap window 14:05-14:35" → **Asleep** (nap or night inferred from time and bedtime). Snackbar: "Nap from 14:12 · −5 −10 −15 · Undo". The card flips to "Asleep 0:42" with **Woke up**. Before 05:00, Woke up means a night waking ("Up for the day" is the second choice) and the card offers **Back asleep**.
3. **Handover.** After 3 h or more away, or when another member logged something, a catch-up card sits above the tiles: "Since 08:10 · Vini: 2 naps (2 h), 2 feeds (240 ml), 3 diapers · Paracetamol 11:40, next from 15:40". Tap to expand. ⋯ → Share handover sends plain text through the OS share sheet.
4. **Doctor.** Insights → **Visit summary** → range chips (24 h · 7 days · since last visit): totals beside her 14-day baseline, medicines and symptoms with times, latest measurement, "Questions for the doctor" (saved anytime) → Share or Print.
5. **Custom thing.** Now → **More** → type "Vitamin D" → **Track "Vitamin D"** → mini form (icon guessed, duration off, "Is this a medicine?" shortcut to the catalogue) → **Create and log**; snackbar offers "Pin to Now?".

## 5. Onboarding and empty states

- **Welcome, three screens (2 and 3 skippable):** 1) "Who are we caring for?" name + birth date ("Today", "This week" chips). 2) "How do you start?" **Start fresh · Bring my Napper history · I have an invite**. 3) "What do you want help with?" Sleep, Feeding, Diapers, Medicine, Pumping: sets the pinned tiles and what Insights leads with.
- **First event = state.** The empty Now asks one question: "What is Lia doing now? **Sleeping / Awake**". One tap logs the first sleep marker and the state card comes alive.
- **Learning in the open.** Where predictions will appear: "Learning Lia's rhythm · 2 of 3 days" with a thin progress bar, never an empty card.
- **Napper import** moves into onboarding and the Baby profile. A step 0 shows how to export from Napper. Afterwards the app lands on Insights, "Here are Lia's last 7 weeks", so predictions and baselines work on day one. The medicine mapping groups typo variants into one decision.
- **Invite a co-parent** in context: after the first day or five events, a dismissible card "Share Lia with someone? You'll both see the same day." → **Invite** → role in plain words (Can log / Can view; Owner under More) → OS share sheet. Accepting lands on Now with a welcome and the catch-up card.
- **Viewers** get a read-only Now (state, last events, catch-up), no disabled buttons.
- **Offline first run.** Creating a baby needs the network today: say so up front, keep the form filled, retry automatically (offline creation is P2).
- **Every empty state** is one sentence and one action ("Nothing logged this day" + Add).

## 6. What to remove or demote

- **Remove** the every-type Home grid and the centre "+" with its Track sheet: one logging model (Now tiles + More, FAB on Day).
- **Remove** the five sleep tiles; Bedtime ("in bed, routine started") and manual night entries move into the sleep sheet.
- **Remove** Low/Medium/High chips and "Overdue"; a time window's width carries confidence, "Why?" on tap.
- **Demote** Growth to an Insights section, Settings to the account menu, baby setup to the Baby profile.
- **Demote** the three Today metric cards to one line under the ribbon.
- **Demote** Breast pump, Bath, Tummy time, Belly pain to More unless chosen at onboarding.
- **Replace** the Viewers' disabled controls with a read-only Now.

## 7. Prioritised roadmap

| P | Item | Effort |
|---|---|---|
| P0 | Stopping a timer with missing required fields opens a finish sheet (fixes the "un-stopping" feed) | S |
| P0 | Now screen: state card (state, prediction window, one action), last & log tiles, More sheet; reuses `presets/` | M |
| P0 | Sleep as a state toggle: kind inference, night-waking default, time-shift chips in the Undo snackbar | M |
| P0 | Feed sheet: repeat last, amount chips; nursing L/R live timer with Screen Wake Lock | M |
| P0 | Navigation: Now · Day · Insights; Baby profile; Settings in the account menu | M |
| P0 | Day tab = DESIGN §11, plus a ribbon with ghost predictions | M |
| P1 | Catch-up / handover card with attribution and share text | M |
| P1 | Medicines: last given, by whom, "next from" (per-medicine minimum interval entered by the parent; API field) | M |
| P1 | Night console (automatic from 20:00 to 06:00 or during night sleep) | M |
| P1 | Onboarding (3 steps, first state, learning progress); invite through the share sheet | M |
| P1 | Insights v1: her baseline vs this week, a morning summary ("Last night: 10 h 20 min, longest stretch 4 h 50 min, her best this week"), Growth | L |
| P1 | Visit summary plus Questions for the doctor (an instant built-in "question" event type, so no new table) | M |
| P1 | Create a custom thing inline from More (offline needs a client-id PUT for event types) | M |
| P2 | Web Push: nap window, next dose, "partner started a feed" (installed PWA only) | L |
| P2 | Android manifest shortcuts to `/log?preset=…` | S |
| P2 | Quick-log text bar in en and pt-BR (experiment) | L |
| P2 | Patterns chart: a days × hours sleep map | M |
| P2 | Account-free local mode, create a baby offline | L |

Wireframes for the recommended concept: `docs/design/mockups/01-now.html` (Now while awake, one tap later with the time-shift snackbar, handover catch-up, Feed sheet) and `docs/design/mockups/01-night-and-visit.html` (night view, nursing L/R timer, visit summary, first run).
