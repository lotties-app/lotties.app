import type { SaveDataStoreRequest } from './dataStoreApi';
import { PROVIDER_DEFAULTS, type ProviderId } from './providers';

/*
 * The connection step's fields (docs/design/47-bring-your-own-database.md D4: structured fields,
 * never a connection string). Held only in the wizard's React state: never written to storage,
 * Dexie, the URL or a log, and the passwords are cleared as soon as the server saved them.
 */

export interface ConnectionForm {
  appHost: string;
  appPort: string;
  appDatabase: string;
  appUsername: string;
  appPassword: string;
  migratorHost: string;
  migratorPort: string;
  migratorUsername: string;
  migratorPassword: string;
  caPem: string;
}

export type ConnectionField = keyof ConnectionForm;

/** The fields every save needs (the CA is optional). */
export const REQUIRED_FIELDS: readonly ConnectionField[] = [
  'appHost',
  'appPort',
  'appDatabase',
  'appUsername',
  'appPassword',
  'migratorHost',
  'migratorPort',
  'migratorUsername',
  'migratorPassword',
];

/** A new form: ports from the provider, user names from the roles of the setup SQL, no password. */
export function emptyConnectionForm(
  provider: ProviderId,
  roles: { appRole: string; migratorRole: string },
): ConnectionForm {
  const ports = PROVIDER_DEFAULTS[provider];
  return {
    appHost: '',
    appPort: String(ports.appPort),
    appDatabase: provider === 'neon' ? 'neondb' : 'postgres',
    appUsername: roles.appRole,
    appPassword: '',
    migratorHost: '',
    migratorPort: String(ports.migratorPort),
    migratorUsername: roles.migratorRole,
    migratorPassword: '',
    caPem: '',
  };
}

const isPort = (value: string) =>
  /^\d{1,5}$/.test(value) && Number(value) >= 1 && Number(value) <= 65535;

/** Fields that are missing or malformed (shape only; the server checks the rest). */
export function invalidFields(form: ConnectionForm): ConnectionField[] {
  return REQUIRED_FIELDS.filter((field) => {
    const value = form[field].trim();
    if (!value) return true;
    return (field === 'appPort' || field === 'migratorPort') && !isPort(value);
  });
}

/** The body of `PUT /data-store`; passwords are sent as typed (only control characters are refused). */
export function toSaveRequest(form: ConnectionForm, providerLabel: string): SaveDataStoreRequest {
  const ca = form.caPem.trim();
  return {
    providerLabel,
    app: {
      host: form.appHost.trim(),
      port: Number(form.appPort.trim()),
      database: form.appDatabase.trim(),
      username: form.appUsername.trim(),
      password: form.appPassword,
    },
    migrator: {
      host: form.migratorHost.trim(),
      port: Number(form.migratorPort.trim()),
      username: form.migratorUsername.trim(),
      password: form.migratorPassword,
    },
    tls: { sslMode: 'verify_full', ...(ca ? { caCertificatePem: ca } : {}) },
  };
}

/** The form after a save: everything secret gone. */
export const withoutPasswords = (form: ConnectionForm): ConnectionForm => ({
  ...form,
  appPassword: '',
  migratorPassword: '',
});
