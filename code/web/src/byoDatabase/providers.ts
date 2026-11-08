/*
 * The provider guides of the setup wizard (docs/design/47-bring-your-own-database.md section 7):
 * Supabase and Neon as worked examples, never endorsements, then any other Postgres. The product
 * stays provider-neutral: the label is only what the person sees later ("your Supabase database").
 * Steps live in the i18n catalogs (`byoDatabase.guides.<id>.steps`), same order in both languages.
 */

export const PROVIDERS = ['supabase', 'neon', 'other'] as const;
export type ProviderId = (typeof PROVIDERS)[number];

/** Ports the server accepts (design 47 section 3.2): direct 5432, pooler 6543. */
export const ALLOWED_PORTS = [5432, 6543] as const;

/** Defaults the connection step starts with (the person changes them to what her provider shows). */
export const PROVIDER_DEFAULTS: Readonly<
  Record<ProviderId, { appPort: number; migratorPort: number }>
> = {
  supabase: { appPort: 6543, migratorPort: 5432 },
  neon: { appPort: 5432, migratorPort: 5432 },
  other: { appPort: 5432, migratorPort: 5432 },
};

/** Number of steps of each guide (keys `step1`..`stepN` in the catalogs). */
export const GUIDE_STEP_COUNT: Readonly<Record<ProviderId, number>> = {
  supabase: 5,
  neon: 5,
  other: 4,
};
