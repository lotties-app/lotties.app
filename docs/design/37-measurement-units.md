# 37. Measurement units (metric and US customary)

People choose how amounts are shown, said and typed: metric (ml, kg, cm, degrees C) or US customary (fl oz, lb and oz,
inches, degrees F). **Storage stays metric forever.** This is a presentation and input setting; it changes no event, no
measurement and no sync rule. The web side is in `docs/design/37a-measurement-units-web.md` (written by the web worker);
this file is the contract and the server side.

## 1. Contract

- Setting values: `auto`, `metric`, `us`.
- `auto` resolves by locale tag: region `US`, `LR` or `MM` -> `us`; anything else (a bare `en`, an empty or unreadable tag,
  `pt-BR`, `en-GB`) -> `metric`. The region is the first two-letter part after the language (`en-US`, `en_us`,
  `zh-Hans-US` are US).
- `GET /me/unit-settings` -> 200 `{ "system": "auto" | "metric" | "us" }` (`auto` when nothing is stored).
- `PUT /me/unit-settings` body `{ "system": ... }` -> 200 with the same shape; 400 `validation_failed` (field `system`) for an
  unknown or missing value. Any signed-in user of any role (a Doctor included): it is the person's own display choice,
  like `/me/assistant-settings`. Saving the same value changes nothing.
- No other route changes.

## 2. Rounding rules (shared vectors)

The rules live in two implementations that both run `code/web/src/units/unitsVectors.json` (its `_doc` is the short form):
TypeScript in `code/web/src/units`, C# in `Lotties.Domain.Units` (`UnitSystems.Resolve`, `UnitConversions`; tests
`Lotties.Domain.Tests/Units/UnitVectorTests`, which read the file linked into the test output the way
`CryReasonVectorTests` read theirs).

| Quantity | Display | Input |
| --- | --- | --- |
| Volume | ml -> fl oz, 1 decimal, trailing `.0` dropped (`4`, `4.1`); 1 fl oz = 29.5735 ml | fl oz -> whole ml |
| Weight | kg -> whole ounces, shown as lb + oz (`7 lb 1 oz`; under 1 lb only `11 oz`); 1 kg = 35.27396 oz | lb + oz -> whole grams (kg with 3 decimals); 1 oz = 28.349523 g |
| Length | cm -> in, 1 decimal; 1 in = 2.54 cm | in -> cm, 0.1 |
| Temperature | C -> F, 1 decimal | F -> C, 0.1 |

Halves round away from zero. C# computes with `decimal` so the vectors do not depend on binary floating point.

## 3. What is never converted

Only volume, weight, length and temperature are converted. Never a medication dose (a dose is entered and shown in the
unit it was prescribed in), never a count, a duration, a time, a formula's scoops or a vaccine fact. Assistants have no
medication command at all (design 32).

## 4. Why storage stays metric

Events keep `amount_ml`, measurements `kg`/`cm`, temperatures `temperature_c`/`value_c`. Reasons: one canonical value for
sync, conflict rules, charts, age norms, backups and predictions; the same event reads the same on every device and for
every family member whatever each one chose; a person who changes her setting rewrites nothing; no rounding loss is stored
(a bottle typed as `4 oz` is stored as 118 ml, and shows as `4` again, as the vectors pin).

## 5. Server side

- Table `user_unit_settings` (migration `UnitSettings`): `user_id` (PK, FK to `users`, cascade), `setting` (`auto`, `metric`,
  `us`, as text), `updated_at`. A new tiny table rather than a column on `user_assistant_settings`: that row means "the
  voice assistants' default baby", its PUT is full state for that purpose, and the unit setting is used by the web too, for
  users with no assistant at all (Viewers and Doctors have no baby to choose). Separate rows keep both PUTs independent.
  No row means `auto`.
- Domain `UserUnitSettings` + `IUserUnitSettingsRepository`; Application `UnitSettingsService` (get/save, validation by
  `UnitSystems.TryParse`) and `IUnitPreferences.ResolveAsync(localeTag)` (the stored setting, else the locale, metric when
  there is none); Api `MeEndpoints`.
- Account deletion: the row is erased (`EfAccountDataEraser`; `AccountErasureTests.Rules` has `user_unit_settings.user_id`
  = Erase and the fixture saves a setting).
- Backup/export: the setting is a user-level preference, not a fact about a baby. It is **never** in the baby backup file
  (`lotties-backup`, design 24) and not in any export of a baby; restoring a backup never touches it.
- Privacy (design 33): a new kind of stored, non-sensitive user data; the policy (both languages), the audit inventory and
  the policy version (6) say so.

## 6. Assistants (Alexa and MCP)

One command layer (design 32): adapters only authenticate, map and render.

- `AssistantInvocation.Locale` carries the request locale (Alexa's `en-US`, `pt-BR`; MCP has none). `AssistantService`
  resolves the system once per command (`IUnitPreferences`) and sets `AssistantResult.Units`, a presentation hint that is
  not in the wire JSON. Resolution: the stored setting; `auto` or nothing stored -> the request locale; no locale -> metric.
  So an Alexa user in en-US with `auto` hears ounces, in pt-BR hears ml, and an explicit setting wins over the locale.
- Spoken and rendered text with a volume uses the right unit words: en-US `4 ounces` / `1 ounce`, pt-BR `4 onças`; metric
  stays `120 ml`. `SpokenMeasures` also renders weight (`7 pounds 1 ounce`, `7 libras e 1 onça`), length (`19.7 inches`,
  `19,7 polegadas`) and temperature (`38 degrees`, `38 graus`) for any future answer that carries them; today only volumes
  occur (last feed, bottle average and last bottle, bottle logged, day and week totals).
- MCP: `structuredContent` stays canonical metric with explicit unit names (`amountMl`, `lastAmountMl`); only the
  one-line text follows the setting (`4.1 fl oz`). MCP passes no locale, so `auto` is metric for it (a client locale
  argument was left out: the stored setting already covers a US person).
- Bottle by voice: `BottleIntent` has an optional `volumeUnit` slot (custom type `VOLUME_UNIT`, ids `ML` and `OZ`) and
  `amount` accepts decimals ("four and a half"). `IAssistantService.LogBottleVolumeAsync(amount, unit?, kind)` converts to
  whole ml with the shared rule, then applies the existing limits (1-500 ml after conversion) and the same idempotent event
  id. With no unit said, the amount is read in the user's resolved system (a US user's "log a 4 bottle" is 4 oz). The
  elicitation prompt is neutral ("How much? For example 120 milliliters or 4 ounces."). Slot names stay unique across
  intents. The sample utterances that used a literal "ml" now use `{volumeUnit}`, so the unit is captured.
- MCP `log_bottle`: `amountMl` (integer ml) is unchanged and no longer required; new optional `amount` (number, decimals) with
  `unit` (`ml` | `oz`, default `ml`). Exactly one of `amountMl` and `amount`; `unit` only with `amount`; anything else is
  `invalid_arguments`. Without `unit` an `amount` is ml: MCP never guesses a system for input.
- An answer for a value out of range in a US system tells the limit in ounces ("up to 16.9 ounces").

## 7. How it resolves, in one place

1. The person's stored `system` if it is `metric` or `us`.
2. Otherwise (`auto`, nothing stored) the locale tag of the request: web = the app language/browser locale (web worker),
   Alexa = the request locale, MCP = none.
3. A tag with region US, LR or MM is US customary; everything else metric.
