import { describe, expect, it } from 'vitest';
import { ApiError } from '../api/ApiError';
import {
  emptyConnectionForm,
  invalidFields,
  toSaveRequest,
  withoutPasswords,
} from './connectionForm';
import { isDataStoreView } from './dataStoreApi';
import {
  buildSetupSql,
  DEFAULT_APP_ROLE,
  DEFAULT_MIGRATOR_ROLE,
  generatePassword,
  isValidRoleName,
} from './setupSql';
import {
  errorMessageOf,
  knownFindings,
  resultMessageOf,
  storeHealthOf,
  type ResultMessage,
  type StoreHealth,
} from './storeMessages';

const ROLES = {
  appRole: DEFAULT_APP_ROLE,
  migratorRole: DEFAULT_MIGRATOR_ROLE,
  appPassword: 'A'.repeat(32),
  migratorPassword: 'B'.repeat(32),
};

describe('setup SQL (built in the browser)', () => {
  it('creates two least-privilege roles that own only the lotties schema', () => {
    const sql = buildSetupSql(ROLES);
    expect(sql).toContain(`CREATE ROLE lotties_migrator LOGIN PASSWORD '${'B'.repeat(32)}'`);
    expect(sql).toContain(`CREATE ROLE lotties_app LOGIN PASSWORD '${'A'.repeat(32)}'`);
    expect(sql.match(/NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS/g)).toHaveLength(2);
    expect(sql).toContain('CREATE SCHEMA lotties AUTHORIZATION lotties_migrator;');
    expect(sql).toContain('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO lotties_app;');
    expect(sql).toContain('REVOKE ALL ON SCHEMA public FROM lotties_app, lotties_migrator;');
    expect(sql).toContain("ALTER ROLE lotties_app SET statement_timeout = '15s';");
    expect(sql).not.toMatch(/\bSUPERUSER\b(?<!NOSUPERUSER)|GRANT ALL|CREATEROLE(?<!NOCREATEROLE)/);
  });

  it('uses the chosen role names', () => {
    const sql = buildSetupSql({ ...ROLES, appRole: 'family_app', migratorRole: 'family_mig' });
    expect(sql).toContain('CREATE ROLE family_app');
    expect(sql).toContain('AUTHORIZATION family_mig');
    expect(sql).not.toContain('lotties_app');
  });

  it.each(['', 'Lotties', '1app', 'a-b', 'a;drop', 'public', 'pg_app', 'x'.repeat(64)])(
    'refuses the role name %j',
    (name) => {
      expect(isValidRoleName(name)).toBe(false);
      expect(() => buildSetupSql({ ...ROLES, appRole: name })).toThrow();
    },
  );

  it('refuses two equal role names and a password it would not generate', () => {
    expect(() => buildSetupSql({ ...ROLES, migratorRole: ROLES.appRole })).toThrow();
    expect(() => buildSetupSql({ ...ROLES, appPassword: "x'; DROP" })).toThrow();
  });

  it('generates letters and digits only, of the asked length, different each time', () => {
    const a = generatePassword();
    expect(a).toMatch(/^[A-Za-z0-9]{32}$/);
    expect(generatePassword()).not.toBe(a);
    expect(generatePassword(20)).toHaveLength(20);
  });
});

describe('connection form', () => {
  const filled = () => ({
    ...emptyConnectionForm('supabase', ROLES),
    appHost: ' aws-0-sa-east-1.pooler.supabase.com ',
    appPassword: 'p@ss word',
    migratorHost: 'db.example.supabase.co',
    migratorPassword: 'other',
  });

  it('starts with the provider ports, the SQL roles as user names and no password', () => {
    const form = emptyConnectionForm('supabase', ROLES);
    expect(form).toMatchObject({
      appPort: '6543',
      migratorPort: '5432',
      appUsername: 'lotties_app',
      migratorUsername: 'lotties_migrator',
      appPassword: '',
      migratorPassword: '',
    });
    expect(emptyConnectionForm('neon', ROLES).appDatabase).toBe('neondb');
  });

  it('lists missing and malformed fields', () => {
    expect(invalidFields(emptyConnectionForm('other', ROLES))).toEqual([
      'appHost',
      'appPassword',
      'migratorHost',
      'migratorPassword',
    ]);
    expect(invalidFields({ ...filled(), appPort: '70000' })).toEqual(['appPort']);
    expect(invalidFields(filled())).toEqual([]);
  });

  it('builds the typed request (never a connection string), passwords as typed', () => {
    expect(toSaveRequest({ ...filled(), caPem: '  ' }, 'Supabase')).toEqual({
      providerLabel: 'Supabase',
      app: {
        host: 'aws-0-sa-east-1.pooler.supabase.com',
        port: 6543,
        database: 'postgres',
        username: 'lotties_app',
        password: 'p@ss word',
      },
      migrator: {
        host: 'db.example.supabase.co',
        port: 5432,
        username: 'lotties_migrator',
        password: 'other',
      },
      tls: { sslMode: 'verify_full' },
    });
    expect(toSaveRequest({ ...filled(), caPem: 'PEM' }, 'X').tls).toEqual({
      sslMode: 'verify_full',
      caCertificatePem: 'PEM',
    });
  });

  it('forgets the passwords', () => {
    expect(withoutPasswords(filled())).toMatchObject({ appPassword: '', migratorPassword: '' });
  });
});

describe('server codes to plain messages', () => {
  it.each<[string, ResultMessage]>([
    ['ok', 'ok'],
    ['endpoint_invalid_field', 'checkFields'],
    ['endpoint_invalid_host', 'checkFields'],
    ['endpoint_port_not_allowed', 'port'],
    ['endpoint_unresolvable', 'unresolvable'],
    ['endpoint_blocked_address', 'blockedAddress'],
    ['endpoint_tls_failed', 'tls'],
    ['store_tls_failed', 'tls'],
    ['endpoint_invalid_ca', 'ca'],
    ['store_unavailable', 'unreachable'],
    ['store_paused_or_unreachable', 'unreachable'],
    ['store_timeout', 'timeout'],
    ['store_credentials_rejected', 'credentials'],
    ['store_role_too_powerful', 'roleTooPowerful'],
    ['store_schema_conflict', 'schemaConflict'],
    ['store_schema_ahead', 'schemaAhead'],
    ['store_quota_full', 'quotaFull'],
    ['store_rate_limited', 'busy'],
    ['store_migrating', 'migrating'],
    ['store_migration_failed', 'migrationFailed'],
    ['byo_consent_required', 'consent'],
    ['store_not_configured', 'notConfigured'],
    ['something_new', 'unknown'],
    ['__proto__', 'unknown'],
  ])('%s -> %s', (code, message) => {
    expect(resultMessageOf(code)).toBe(message);
  });

  it('maps failed requests by code, 429 by status, other errors to unknown', () => {
    expect(errorMessageOf(new ApiError(422, { code: 'endpoint_blocked_address' }))).toBe(
      'blockedAddress',
    );
    expect(errorMessageOf(new ApiError(429, { code: 'rate_limited' }))).toBe('rateLimited');
    expect(
      errorMessageOf(new ApiError(400, { code: 'validation_failed', field: 'app.host' })),
    ).toBe('checkFields');
    expect(errorMessageOf(new TypeError('Failed to fetch'))).toBe('unknown');
  });

  it('explains only the findings it knows', () => {
    expect(knownFindings(['owns_objects', 'mystery', 'superuser_like'])).toEqual([
      'superuser_like',
      'owns_objects',
    ]);
  });

  it.each<[string, string | null, StoreHealth]>([
    ['ready', null, 'ok'],
    ['migrating', null, 'checking'],
    ['pending', null, 'notTested'],
    ['pending', 'ok', 'checking'],
    ['pending', 'store_credentials_rejected', 'credentials'],
    ['pending', 'endpoint_unresolvable', 'unreachable'],
    ['unreachable', null, 'unreachable'],
    ['unreachable', 'store_paused_or_unreachable', 'unreachable'],
    ['unreachable', 'store_credentials_rejected', 'credentials'],
    ['unreachable', 'store_quota_full', 'quotaFull'],
    ['schema_ahead', null, 'schemaAhead'],
    ['role_too_powerful', null, 'roleTooPowerful'],
    ['schema_conflict', null, 'schemaConflict'],
    ['migration_failed', null, 'migrationFailed'],
    ['disabled', null, 'disabled'],
    ['brand_new_state', null, 'checking'],
  ])('store %s (last check %s) -> %s', (state, lastCheckResult, health) => {
    expect(storeHealthOf({ state, lastCheckResult })).toBe(health);
  });
});

describe('data-store answer', () => {
  it('accepts only this route answer (a fallback page or an array keeps the feature hidden)', () => {
    expect(isDataStoreView({ kind: 'hosted', store: null })).toBe(true);
    expect(isDataStoreView({ kind: 'own', store: { state: 'ready' } })).toBe(true);
    expect(isDataStoreView([])).toBe(false);
    expect(isDataStoreView('<html>')).toBe(false);
    expect(isDataStoreView({ kind: 'cloud', store: null })).toBe(false);
  });
});
