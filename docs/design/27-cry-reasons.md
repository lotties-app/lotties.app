# 27. Why is she crying?

## Data

The built-in `fussy` event type records the outcome (migration `FussyOutcomes`, seed only, stored events untouched):

- `what_helped` (optional select) keeps its options in order and appends `diaper_change`, `burping` and `holding`
  ("Diaper change", "Burping", "Holding / skin to skin"; pt-BR "Troca de fralda", "Arroto", "Colo / pele a pele").
- `suggested_cause` (optional select, **hidden**, label "First suggestion" / "Primeira sugestão"): `hunger`, `sleepy`,
  `diaper`, `gas`, `comfort`. What the app ranked first when the parent used "Why is she crying?", saved with the spell
  so we can later measure whether the ranking helps (compare it with `what_helped`). It is never shown as a diagnosis:
  hidden fields are not drawn in the event sheet nor in the detail line.
- Unknown option values are rejected like any other select (400 `validation_failed` with the field); both fields are
  optional. Export/import round-trips them (the backup import validates against the type definition).
