# 45 - Privacy-first onboarding

Status: implemented on branch `claude/privacy-first-onboarding-3a33ba`. Owner decisions: names are optional and a
label is the default; the birth date is coarsened to its week (no new field); a doctor shares only what she chooses.
Principle: the app asks for the least; a real name or an exact date is something the person opts into.

## 1. Labels instead of names

### Baby
- `Baby.Name` stays the real name and may now be empty (column stays `NOT NULL`, empty string = "no name").
- New `Baby.Label` (nullable text, max 100): one of the preset codes `baby`, `girl`, `boy` (`BabyLabels.Presets`) or a
  custom text. Null/blank is read as `baby`. A custom text equal to a preset code is that preset.
- Shown name everywhere (`Baby.ShownName` on the server, `babyShownName(baby, t)` on the web): the name when present,
  else the label (presets localized: Baby / Girl / Boy; "Bebê / Menina / Menino" in pt-BR; custom text verbatim).
- Setting a custom text or a name is the opt-in. Renaming later is just filling `Name`; the label stays as a fallback
  and is never rewritten.
- Existing babies keep their name; their `Label` is null. Nobody is asked to clear anything.
- Create/update body: `name` optional, new optional `label`. A baby with neither gets `baby`.

### User (self)
- `User.DisplayName` becomes optional in the same way (the OIDC claim still fills it at first sign-in; a user can
  clear it). New `User.RoleLabel` (nullable text, max 100): presets `mother`, `father`, `stepMother`, `stepFather`,
  `sister`, `brother`, `grandmother`, `grandfather`, `friend` (`RoleLabels.Presets`) or a custom text.
- `PUT /api/v1/me/profile` `{displayName?, roleLabel?}`; `GET /me` returns both. Members, invites and the people named
  on notes/measurements carry `roleLabel`; clients show name, else label, else the existing fallback.
- Existing users keep their display name.

### Where a name is read (audit)
| Place | Rule |
| --- | --- |
| API validators (`Baby`, `SaveBabyRequest`, `User.Rename`) | name optional; length cap kept; NUL rejected |
| Alexa/MCP (`SpokenBaby`, `AssistantSubject`) | spoken only when `sayBabyName` AND a real `Name` exists; a label is NEVER spoken as a name |
| Backup (`BackupFile.Baby`) | adds `label`, `birthWeekOnly`; a missing name imports as empty; authors stay stand-ins |
| Notifications (`NotificationNameSource`) | use `Baby.ShownName` |
| Backup file name, erasure dialogs, doctor patient list | `ShownName` |
| Invites/members | `roleLabel` added next to `displayName` |
| Doctor views | see section 3; a baby's label is shown to the doctor like the name |

## 2. Birth in weeks

- The form keeps a date picker and shows: "Lotties stores only the week of birth (the Monday of that week)."
- On create the API stores `BirthWeek.Monday(date)` (ISO week, Monday on or before the date) in `BirthDate` and sets
  `Baby.BirthDateWeekOnly = true`. All 126 users of `BirthDate` keep working: it is still a `DateOnly`.
- Future-date rule is unchanged and runs on the date the person typed (latest = UTC today + 1), before coarsening.
  The Monday is never later than the typed date, so a coarsened date is never in the future.
- Existing babies keep their exact `BirthDate` (`BirthDateWeekOnly = false`) until the Owner/Parent edits the date
  (the new date is then coarsened) or presses "Store only the week" (`PUT /babies/{id}` with `birthWeekOnly: true`
  and the same date). Coarsening is one way: the exact day is not kept.
- Effect on age: a baby born on day d of the week appears `d` days (0 to 6) older than she is. Vaccine due dates and
  age-norm lookups use the stored Monday, so a dose can show up to 6 days early. The shared vectors take the birth date
  as an input, so they are unchanged; `birthWeekVectors.json` (C# + TS twins) pins the Monday rule.
- Age is shown in weeks while `BirthDateWeekOnly` and under 12 weeks, in months after; exact-date babies are
  unchanged. The vaccine and norms pages add a footnote "Based on the week of birth" for week-only babies.

## 3. Doctors

- `ProfessionalProfile.Specialty` is the only required field (a `DoctorSpecialties` code when it matches, else a
  free text kept as typed). `DisplayName` and `RegistrationNumber` are optional. No contact or clinic field exists on
  the profile, so none is shown.
- New flags `ShareDisplayName` and `ShareRegistration` (bool, default false for new profiles; existing profiles are
  migrated to true so what families already see does not silently disappear; she can switch each off).
- `ProfessionalSummary` and `PersonSummary` (what families see, `PersonDirectory`) drop `displayName` and
  `registrationNumber` unless the flag is on. A doctor who does not share her name is shown by specialty (and
  `roleLabel` when set); her account display name is never the fallback for a doctor profile.
- Assistants: unchanged, only the specialty code ever leaves (CLAUDE.md rule).
- Role matrix, scopes and the doctor dashboard are untouched; the routes are the same, only fields shrink.
- Joining as a Doctor still needs a declared profile; it now needs only a specialty.

## 4. Storage and migration (one: `PrivacyFirstOnboarding`)
- `babies.Label` (null), `babies.BirthDateWeekOnly` (bool, default false), `babies.Name` stays required.
- `users.RoleLabel` (null).
- `professional_profiles.ShareDisplayName`, `ShareRegistration` (bool, default true for existing rows), `DisplayName`
  required -> default empty.
- Erasure: the new columns live on rows already covered by `AccountErasureTests.Rules`; no new table. Anonymizing a
  user also clears `RoleLabel`.
- Privacy policy: version bump with a minor consent entry; text says names are optional, birth is stored as a week.
