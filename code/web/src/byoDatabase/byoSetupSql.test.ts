import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildSetupSql } from './setupSql';

/*
 * docs/sql/byo-setup.sql is the psql copy of the setup SQL the wizard builds (docs/BYO-DATABASE.md):
 * the same statements, with psql variables for the role names and passwords. This keeps the two equal.
 */

const ROLES = {
  appRole: 'lotties_app',
  migratorRole: 'lotties_migrator',
  appPassword: 'AppPassword234567',
  migratorPassword: 'MigratorPassword234',
};

/** The SQL statements only: no comments, no psql meta-commands or variable checks, no blank lines. */
const statements = (sql: string): string[] =>
  sql
    .split('\n')
    .map((line) => line.trimEnd())
    .filter(
      (line) =>
        line.trim() !== '' &&
        !line.startsWith('--') &&
        !line.startsWith('\\') &&
        !line.trimStart().startsWith('DO $$'),
    );

function fromPsqlFile(): string[] {
  const file = readFileSync('../../docs/sql/byo-setup.sql', 'utf-8');
  const substituted = file
    .replaceAll(':"app_role"', ROLES.appRole)
    .replaceAll(':"migrator_role"', ROLES.migratorRole)
    .replaceAll(":'app_password'", `'${ROLES.appPassword}'`)
    .replaceAll(":'migrator_password'", `'${ROLES.migratorPassword}'`);
  return statements(substituted);
}

describe('docs/sql/byo-setup.sql', () => {
  it('runs the same statements as the setup SQL the app builds', () => {
    expect(fromPsqlFile()).toEqual(statements(buildSetupSql(ROLES)));
  });

  it('holds no password of its own', () => {
    const file = readFileSync('../../docs/sql/byo-setup.sql', 'utf-8');
    expect(file).not.toMatch(/PASSWORD '/);
  });
});
