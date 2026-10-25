# 37a. Measurement units, web side

The web half of the measurement-units feature. The rules, the shared vectors and the server contract are in
`docs/design/37-measurement-units.md` (owned by the API work); this file says where the code lives, how a screen uses
it, what is never converted and how the invariant is kept. Shared vectors: `code/web/src/units/unitsVectors.json`
(the C# side runs the same file).

## 1. The rule

People choose **Automatic**, **Metric** (ml, kg, cm, degrees C) or **US customary** (fl oz, lb + oz, inches, degrees F)
in Settings > Units. **Storage stays metric forever**: `amount_ml`, kg and cm measurements, `value_c`, the outbox, sync,
backup files and the API never see a US value. The setting only changes what a person sees and types.

`auto` resolves from the device locale tag (`navigator.language`; region US, LR or MM is US customary, anything else
metric), never from the UI language: an English phone in Brazil is metric, a Portuguese phone in Miami is US.

## 2. Where the code lives (`code/web/src/units/`)

| File | Role |
| --- | --- |
| `convert.ts` | Pure conversions, exactly the vectors: ml <-> fl oz (29.5735), kg <-> lb + whole oz (28.3495 g/oz), cm <-> in (2.54), C <-> F. Input rounding: whole ml, whole grams, 0.1 cm, 0.1 C |
| `system.ts` | `UnitSetting` (`auto/metric/us`), `resolveUnitSystem(setting, localeTag)` |
| `format.ts` | `formatVolume/Weight/Length/Temperature(value, system, locale)` through `Intl.NumberFormat` (`fluid-ounce`, `pound`, `ounce`, `inch`); temperature hand-built (`98.6 °F`); pt-BR inches read `pol.` |
| `parse.ts` | `parseVolume/Length/Temperature(text, system)`, `parseWeightKg`, `parseWeightLbOz(lb, oz)`: comma or dot, back to canonical metric |
| `state.ts` | module state of the setting (like `currentLocale()`): `currentUnitSystem()`, `setUnitSetting`, `subscribeUnits`, `setDeviceLocaleTag` (tests) |
| `display.ts` | non-component helpers over the module state (`volumeText`, `weightText`, `lengthText`, `temperatureText`, `fieldQuantity`, `fieldValueText`) for text builders such as `payloadSummary`, `tileText`, `rhythmDetails` |
| `useUnits.ts` | `useUnits()`: `system`, `format*`, `parse*`, `labels` (`ml/fl oz`, `kg/lb`, `cm/in`, `°C/°F`), number helpers; `useUnitSettings()` for the Settings screen |
| `QuantityStepper.tsx` | `NumberStepper` for a metric value: metric unchanged; US shows fl oz (steps of 0.5), degrees F, or inches, with presets on the same grid, and hands back the canonical number only when the person edits |
| `presets.ts` | `snapVolume`, `volumePresets`: US presets sit on half fl oz and are stored as whole ml (4 fl oz = 118 ml) |
| `UnitsProvider.tsx`, `UnitsContext.ts` | the per-account setting, its server mirror, and the remount that redraws every screen when the resolved system changes |
| `unitSettingStorage.ts`, `unitSettingsApi.ts` | per-account localStorage entry `{system, pending}` (cleared with the other account entries in `session/deviceState.ts`); `GET/PUT /me/unit-settings` |

`i18n/format.ts` `formatUnit(value, 'milliliter' | 'kilogram' | 'centimeter')` now follows the setting, so every
existing caller converts without change; `formatMetricUnit` is the always-metric variant (dose arithmetic).

## 3. The setting and the server

- Per account: localStorage `baby-routine.unit-setting` = `{system, pending}`, claimed and cleared with the account's
  other entries (sign-out, account switch).
- `UnitsProvider` (inside `AccountDataProvider`, around the routes) reads the local value before the first paint (works
  offline), then `GET /me/unit-settings`: the server value is adopted unless a local choice is `pending`; a pending one
  is sent instead. A change writes locally (`pending: true`), then `PUT`s; success clears `pending`. A failed `PUT`, a
  404 (server without the route) or a network error keeps the local value; it is retried on the next load and on the
  browser `online` event. No new sync engine. Any role, Doctor included.
- Settings shows "Saved on this device..." while a choice is pending.
- The subtree below the provider is keyed by the resolved system, so a change remounts the screens (the section stays
  open through the `#units` hash).

## 4. How a screen uses it

- Component showing a quantity: `const units = useUnits(); units.formatVolume(ml)`.
- Text builder with no hook: `volumeText(ml)`, `fieldValueText(field.unit, value)` from `units/display.ts`, or
  `formatUnit`.
- Strings that used to carry `ml` in the catalog ("Log {{amount}} ml") now take the unit with the value
  ("Log {{amount}}", value `4 fl oz`); a range passes the low end as a number and the high end with its unit.
- Input: `QuantityStepper quantity="volume|temperature|length"` over the canonical value. A number field whose declared
  `unit` is `ml` is a volume and `C` / `°C` a temperature (custom event types included); any other unit is left alone.

## 5. The invariant

Viewing and re-saving never changes a stored value. The form keeps the canonical text of every field; a stepper shows
`toDisplay(canonical)` and calls `onChange` only when the person types, steps or taps a preset, and then returns
`toCanonical(shown)` (whole ml, 0.1 C, 0.1 cm, whole grams). A stored 120 ml bottle shows 4.1 fl oz and saves as 120;
typing 4 stores 118; 7 lb 11 oz stores 3.487 kg. Typing accepts a comma or a dot. Limits (field or measurement min/max)
are checked in canonical units after the conversion, and the message is worded in the person's units ("Weight must be
between 11 oz and 88 lb 3 oz."). The API keeps measurements to 2 decimals, so 3.487 kg is stored as 3.49 kg there,
which still reads 7 lb 11 oz.

Tests: `units/units.test.ts` (all vectors), `units/unitTexts.test.ts`, `events/EventSheet.units.test.tsx`,
`pages/GrowthPage.units.test.tsx`, `now/ui/NowScreen.units.test.tsx`, `settings/UnitsSection.test.tsx`, a US case in
`insights/InsightsSection.test.tsx` and `doctor/PatientsHome.test.tsx`. The shared test setup starts every test metric
(device locale `en-GB`) because jsdom reports `en-US`.

## 6. Never converted

- Medication and prescription doses (mg, ml of a medicine, drops), per-kg dose arithmetic and the weight used for it
  (`formatMetricUnit`; `DoseFields`, `PrescriptionCard`, `eventPresentation` kgUsed).
- Vaccine data.
- Formula preparation recipes (water per scoop is a product instruction).
- Free text typed by the person, and any field with another unit (g, s, drops...).
- Backup, export and import files and previews, the outbox, sync payloads and every API body: canonical metric.
- The reference curves and age norm data (metric data files); only their displayed text converts.

## 7. Screens covered

Feed tray (chips and presets, other-amount stepper, drunk shares, log button, toast), event sheet and every number
field with unit `ml` or `C` (built-in and custom types: stepper, quick values, last value, limits and error text),
bottle level chips and prompt, Day list rows and ribbon names (`payloadSummary`, `amountOfText`), Now tiles, catch-up
text, running timer detail, next-up texts and age-norm amount ranges (`rhythmDetails`), insights (bottle chart axis,
tooltip and table in fl oz, formulas card with per-lb milk), growth (list, chart axis and tooltips, add/edit dialog with
lb + oz and inches), doctor patients home and clinical summary (bottle per day, formulas, latest measurements), doctor
growth and consultation measurements (same dialog and chart), Settings > Units.

## 8. Places that still show a raw unit, and why

- Settings > Event types field editor: it edits the definition (declared unit, min, max in canonical units), not a
  measurement.
- Developer preview pages under `src/dev/` (sample galleries).
- Medicine screens, by the rule above.
- Voice assistant answers are rendered by the API and the adapters, not by the web app.
