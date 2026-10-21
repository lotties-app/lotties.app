# i18n

English (`en`, source and fallback) and Brazilian Portuguese (`pt-BR`), with `i18next` + `react-i18next`.
Rules and rationale: `docs/DESIGN.md` section 9.

## Layout

- `locales/en.json`, `locales/pt-BR.json`: catalogs, one namespace, grouped by feature (`nav`, `home`, `settings`, `errors`, `eventTypes`, ...). `en` is bundled; `pt-BR` is a lazy chunk.
- `config.ts`: supported languages, `system` detection (`pt*` -> `pt-BR`, else `en`).
- `i18n.ts`: the i18next instance, lazy loaders, `t` for code outside components.
- `I18nProvider.tsx` / `useLocale.ts`: the `system | en | pt-BR` setting (localStorage, `<html lang>`, title), applied without a reload.
- `format.ts`: `Intl` helpers (`formatTime`, `formatDate`, `formatDuration`, `formatRelative`, `formatAge`, `formatNumber`, `formatUnit`, `formatList`). Never format dates or numbers by hand.
- `catalog.ts`, `eventTypeText.ts`: lookups for server-provided keys (event types, fields, options, problem codes). Own properties only; unknown keys fall back to the server text.
- `i18next.d.ts`: types the keys from `en.json`, so `t('home.typo')` fails `tsc`.

## Adding or changing text

1. Add the key to `locales/en.json`, then the same key to `locales/pt-BR.json`.
2. Use `const { t } = useTranslation()` in components, `import { t } from '../i18n/i18n'` elsewhere. Components that show localized output must call `useTranslation()` so they re-render on a language change.
3. No sentence building from fragments: use `{{interpolation}}`. Counts use plural keys `key_one` / `key_other` and `t('key', { count })`.
4. Keep English wording, sentence case, no exclamation marks. pt-BR: informal "você", natural wording.

`catalogs.test.ts` fails when the key sets, placeholders or plural forms of the two catalogs differ. ESLint (`i18next/no-literal-string`, error) fails on literal JSX text and on text attributes (`aria-label`, `label`, `placeholder`, `title`, `helperText`, ...) in non-test `.tsx` files. Strings built in `.ts` files are not linted: review them.

## Built-in event types

`eventTypes.<typeKey>.name`, `.fields.<fieldKey>.label`, `.options.<fieldKey>.<optionValue>` (option values in lower case: `FORMULA` and `formula` both resolve). Only types with `babyId === null` are translated; user-created types, fields, options and medication names never are.

## Adding a language

1. Copy `locales/en.json` to `locales/<code>.json` and translate it.
2. Add `{ code, nativeName }` to `LOCALES` in `config.ts` and a loader in `LOADERS` in `i18n.ts` (include the matching `@mui/material/locale` export).
3. Add the language to `detectLocale` if the browser language needs mapping, and to `catalogs.test.ts`.
4. Plural categories of the new language may need more forms than `_one`/`_other` (check `Intl.PluralRules`).
