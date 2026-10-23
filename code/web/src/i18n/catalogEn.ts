import { mergeCatalogFiles } from './mergeCatalog';

/**
 * The shape of the `translation` namespace, typed from the English files (i18next.d.ts uses it, so
 * `t('home.typo')` fails `tsc`). One line per file of `locales/en/`, sorted: a new feature file
 * adds its line here (catalogs.test.ts fails when a file is missing).
 */
export type Catalog = typeof import('./locales/en/account.json') &
  typeof import('./locales/en/appointments.json') &
  typeof import('./locales/en/auth.json') &
  typeof import('./locales/en/backup.json') &
  typeof import('./locales/en/baby.json') &
  typeof import('./locales/en/common.json') &
  typeof import('./locales/en/credits.json') &
  typeof import('./locales/en/day.json') &
  typeof import('./locales/en/doctor-dashboard.json') &
  typeof import('./locales/en/doctor.json') &
  typeof import('./locales/en/errors.json') &
  typeof import('./locales/en/events.json') &
  typeof import('./locales/en/feeding.json') &
  typeof import('./locales/en/formulas.json') &
  typeof import('./locales/en/growth.json') &
  typeof import('./locales/en/home.json') &
  typeof import('./locales/en/hub.json') &
  typeof import('./locales/en/import.json') &
  typeof import('./locales/en/insights.json') &
  typeof import('./locales/en/medications.json') &
  typeof import('./locales/en/nav.json') &
  typeof import('./locales/en/notifications.json') &
  typeof import('./locales/en/now-layout.json') &
  typeof import('./locales/en/now.json') &
  typeof import('./locales/en/providers.json') &
  typeof import('./locales/en/settings.json') &
  typeof import('./locales/en/sync.json') &
  typeof import('./locales/en/timers.json') &
  typeof import('./locales/en/ui.json') &
  typeof import('./locales/en/vaccines.json');

/** The English catalog (source and fallback, in the main bundle): every `locales/en/*.json`, merged. */
export const enCatalog = mergeCatalogFiles(
  import.meta.glob('./locales/en/*.json', { eager: true, import: 'default' }),
) as Catalog;
