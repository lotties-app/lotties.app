/*
 * The setup SQL the person runs in her own database (docs/design/47-bring-your-own-database.md D6
 * and section 3.3): two login roles that own nothing outside one schema `lotties`, least privilege.
 * Built here in the browser only, like the self-host generator: nothing typed or generated is sent
 * anywhere until the person presses "Save and test". The generated passwords live only in the
 * wizard's memory (never in storage, the URL or a log).
 */

export const DEFAULT_APP_ROLE = 'lotties_app';
export const DEFAULT_MIGRATOR_ROLE = 'lotties_migrator';
export const STORE_SCHEMA = 'lotties';

/** A plain lower-case Postgres identifier: nothing to quote, nothing to inject. */
const ROLE_NAME = /^[a-z_][a-z0-9_]{0,62}$/;

export function isValidRoleName(name: string): boolean {
  return ROLE_NAME.test(name) && name !== 'public' && !name.startsWith('pg_');
}

const PASSWORD_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

/**
 * A random password from the browser's cryptographic generator: letters and digits only, so it
 * needs no escaping in SQL or in a form. 32 characters (about 186 bits).
 */
export function generatePassword(
  length = 32,
  random: (count: number) => Uint8Array = (count) => crypto.getRandomValues(new Uint8Array(count)),
): string {
  const out: string[] = [];
  // Rejection sampling keeps every character equally likely.
  const limit = 256 - (256 % PASSWORD_ALPHABET.length);
  while (out.length < length) {
    for (const byte of random(length * 2)) {
      if (byte < limit && out.length < length)
        out.push(PASSWORD_ALPHABET[byte % PASSWORD_ALPHABET.length]);
    }
  }
  return out.join('');
}

export interface SetupRoles {
  appRole: string;
  migratorRole: string;
  appPassword: string;
  migratorPassword: string;
}

/** Whether the role names can go into the SQL (and differ from each other). */
export const rolesValid = (roles: Pick<SetupRoles, 'appRole' | 'migratorRole'>) =>
  isValidRoleName(roles.appRole) &&
  isValidRoleName(roles.migratorRole) &&
  roles.appRole !== roles.migratorRole;

const PASSWORD = /^[A-Za-z0-9]{16,128}$/;

/**
 * The SQL script. Throws on a role name or password this generator would not produce (the wizard
 * validates the names first), so nothing typed can end up as SQL.
 */
export function buildSetupSql({
  appRole,
  migratorRole,
  appPassword,
  migratorPassword,
}: SetupRoles): string {
  if (!isValidRoleName(appRole) || !isValidRoleName(migratorRole) || appRole === migratorRole) {
    throw new Error('invalid role names');
  }
  if (!PASSWORD.test(appPassword) || !PASSWORD.test(migratorPassword)) {
    throw new Error('invalid generated password');
  }
  const s = STORE_SCHEMA;
  return [
    "-- Lotties: a place for your baby's records in your own database.",
    "-- Run once, as your database's admin user, in the database you will give to Lotties.",
    `-- Creates two roles that can only reach the schema "${s}". Never give Lotties your admin user.`,
    '',
    '-- 1. The roles: no superuser, no new databases or roles, few connections.',
    `CREATE ROLE ${migratorRole} LOGIN PASSWORD '${migratorPassword}'`,
    '  NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOINHERIT CONNECTION LIMIT 3;',
    `CREATE ROLE ${appRole} LOGIN PASSWORD '${appPassword}'`,
    '  NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOINHERIT CONNECTION LIMIT 5;',
    '',
    `-- 2. The schema, owned by ${migratorRole} (it creates and updates the tables).`,
    `GRANT ${migratorRole} TO CURRENT_USER;`,
    `CREATE SCHEMA ${s} AUTHORIZATION ${migratorRole};`,
    `REVOKE ${migratorRole} FROM CURRENT_USER;`,
    '',
    `-- 3. ${appRole} only reads and writes the tables of that schema.`,
    `GRANT USAGE ON SCHEMA ${s} TO ${appRole};`,
    `ALTER DEFAULT PRIVILEGES FOR ROLE ${migratorRole} IN SCHEMA ${s}`,
    `  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${appRole};`,
    `ALTER DEFAULT PRIVILEGES FOR ROLE ${migratorRole} IN SCHEMA ${s}`,
    `  GRANT USAGE, SELECT ON SEQUENCES TO ${appRole};`,
    `REVOKE ALL ON SCHEMA public FROM ${appRole}, ${migratorRole};`,
    '',
    '-- 4. Both roles see only that schema, and long or stuck queries stop on their own.',
    `ALTER ROLE ${migratorRole} SET search_path = ${s};`,
    `ALTER ROLE ${appRole} SET search_path = ${s};`,
    `ALTER ROLE ${appRole} SET statement_timeout = '15s';`,
    `ALTER ROLE ${appRole} SET idle_in_transaction_session_timeout = '60s';`,
    `ALTER ROLE ${migratorRole} SET statement_timeout = '5min';`,
    `ALTER ROLE ${migratorRole} SET idle_in_transaction_session_timeout = '60s';`,
    '',
  ].join('\n');
}
