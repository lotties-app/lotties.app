import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  buildComposeFile,
  buildEnvFile,
  DEFAULT_INPUT,
  envValue,
  identityProviderSettings,
  validateInput,
  type SelfHostInput,
} from './generate';
import { base64Url, generateVapidPair, randomPassword } from './secrets';

// vitest runs from code/web; the documents live at the repository root.
const repoFile = (path: string) => readFileSync(resolve(process.cwd(), '../..', path), 'utf8');
const deployDoc = repoFile('docs/DEPLOY.md');
const rootCompose = repoFile('docker-compose.yml');

const PASSWORD = 'Pw0rdPw0rdPw0rdPw0rdPw0rdPw0rdAB';
const VAPID_PRIVATE = 'PrivateKeyPrivateKeyPrivateKeyPrivateKey1';

const valid: SelfHostInput = {
  ...DEFAULT_INPUT,
  publicUrl: 'https://baby.example.com',
  oidcAuthority: 'https://id.example.com/realms/home',
  oidcClientId: 'lotties-web',
  apiAudience: 'lotties-api',
  dbPassword: PASSWORD,
};

const envLines = (text: string) =>
  text.split('\n').filter((l) => l && !l.startsWith('#') && l.includes('='));
const envNames = (text: string) => envLines(text).map((l) => l.slice(0, l.indexOf('=')));
const composeVars = (text: string) => [...text.matchAll(/\$\{([A-Z_]+)[:}-]/g)].map((m) => m[1]);

describe('validateInput', () => {
  it('accepts the minimal valid input', () => {
    expect(validateInput(valid)).toEqual({});
  });

  it('asks for the required fields', () => {
    expect(Object.keys(validateInput(DEFAULT_INPUT)).sort()).toEqual(
      ['apiAudience', 'dbPassword', 'oidcAuthority', 'oidcClientId', 'publicUrl'].sort(),
    );
  });

  it('requires https except for a local machine', () => {
    expect(validateInput({ ...valid, publicUrl: 'http://baby.example.com' }).publicUrl).toBe(
      'invalidHttpsUrl',
    );
    expect(validateInput({ ...valid, publicUrl: 'http://localhost:8080' })).toEqual({});
    expect(validateInput({ ...valid, oidcAuthority: 'ftp://id.example.com' }).oidcAuthority).toBe(
      'invalidUrl',
    );
    expect(validateInput({ ...valid, publicUrl: 'not a url' }).publicUrl).toBe('invalidUrl');
    expect(validateInput({ ...valid, publicUrl: 'https://u:p@baby.example.com' }).publicUrl).toBe(
      'invalidUrl',
    );
  });

  it('checks ports, database names and hosts', () => {
    expect(validateInput({ ...valid, webPort: '0' }).webPort).toBe('invalidPort');
    expect(validateInput({ ...valid, webPort: '65536' }).webPort).toBe('invalidPort');
    expect(validateInput({ ...valid, webPort: '80a' }).webPort).toBe('invalidPort');
    expect(validateInput({ ...valid, dbName: 'a-b' }).dbName).toBe('invalidIdentifier');
    expect(validateInput({ ...valid, dbUser: '' }).dbUser).toBe('required');
    const external = { ...valid, dbMode: 'external' as const };
    expect(validateInput(external).dbHost).toBe('required');
    expect(validateInput({ ...external, dbHost: 'db host' }).dbHost).toBe('invalidHost');
    expect(validateInput({ ...external, dbHost: 'db.internal', dbPort: 'x' }).dbPort).toBe(
      'invalidPort',
    );
    expect(validateInput({ ...external, dbHost: 'db.internal' })).toEqual({});
  });

  it('checks the optional fields only when filled', () => {
    expect(validateInput({ ...valid, privacyContactEmail: 'nope' }).privacyContactEmail).toBe(
      'invalidEmail',
    );
    expect(validateInput({ ...valid, privacyContactEmail: 'me@example.com' })).toEqual({});
    expect(validateInput({ ...valid, repoUrl: 'javascript:alert(1)' }).repoUrl).toBe('invalidUrl');
    expect(validateInput({ ...valid, corsOrigins: 'https://a.example.com/path' }).corsOrigins).toBe(
      'invalidOrigins',
    );
    expect(
      validateInput({ ...valid, corsOrigins: 'https://a.example.com, capacitor://localhost' }),
    ).toEqual({});
  });

  it('rejects control characters and long text', () => {
    expect(validateInput({ ...valid, privacyDpo: 'a\nb' }).privacyDpo).toBe('controlCharacters');
    expect(
      validateInput({ ...valid, privacyControllerName: 'x'.repeat(201) }).privacyControllerName,
    ).toBe('tooLong');
    expect(validateInput({ ...valid, oidcClientId: 'a b' }).oidcClientId).toBe('controlCharacters');
  });

  it('needs the whole VAPID set when push is on', () => {
    const errors = validateInput({ ...valid, pushEnabled: true });
    expect(Object.keys(errors).sort()).toEqual([
      'vapidPrivateKey',
      'vapidPublicKey',
      'vapidSubject',
    ]);
    const on = { ...valid, pushEnabled: true, vapidPublicKey: 'pub', vapidPrivateKey: 'priv' };
    expect(validateInput({ ...on, vapidSubject: 'me@example.com' }).vapidSubject).toBe(
      'invalidSubject',
    );
    expect(validateInput({ ...on, vapidSubject: 'mailto:me@example.com' })).toEqual({});
    expect(validateInput({ ...on, vapidSubject: 'https://baby.example.com' })).toEqual({});
  });
});

describe('envValue', () => {
  it('keeps plain values bare', () => {
    expect(envValue('https://id.example.com/realms/home')).toBe(
      'https://id.example.com/realms/home',
    );
    expect(envValue('')).toBe('');
  });

  it('single-quotes values with spaces, hashes or dollars', () => {
    expect(envValue('Ana & Beto')).toBe("'Ana & Beto'");
    expect(envValue('a # b')).toBe("'a # b'");
    expect(envValue('pa$word')).toBe("'pa$word'");
  });

  it('double-quotes a value holding a single quote and escapes backslash, quote and dollar', () => {
    expect(envValue("O'Neil")).toBe('"O\'Neil"');
    expect(envValue('it\'s "x" $y \\z')).toBe('"it\'s \\"x\\" $$y \\\\z"');
  });

  it('refuses a newline', () => {
    expect(() => envValue('a\nb')).toThrow();
  });
});

describe('buildEnvFile', () => {
  it('writes the bundled-database setup', () => {
    const env = buildEnvFile({ ...valid, privacyControllerName: 'Ana & Beto', sendAudience: true });
    expect(env).toContain('DB_HOST=postgres\n');
    expect(env).toContain(`DB_APP_PASSWORD=${PASSWORD}\n`);
    expect(env).toContain(`POSTGRES_PASSWORD=${PASSWORD}\n`);
    expect(env).toContain('DB_AUTO_MIGRATE=true\n');
    expect(env).toContain('AUTH_AUTHORITY=https://id.example.com/realms/home\n');
    expect(env).toContain('VITE_OIDC_AUTHORITY=https://id.example.com/realms/home\n');
    expect(env).toContain('VITE_OIDC_AUDIENCE=lotties-api\n');
    expect(env).toContain("VITE_PRIVACY_CONTROLLER_NAME='Ana & Beto'\n");
    expect(env).toContain('WEB_PORT=8080\n');
    expect(env).not.toContain('PUSH_VAPID');
  });

  it('writes an external database without POSTGRES_PASSWORD and keeps the audience out of the build when unticked', () => {
    const env = buildEnvFile({
      ...valid,
      dbMode: 'external',
      dbHost: 'db.internal',
      dbPort: '5433',
    });
    expect(env).toContain('DB_HOST=db.internal\n');
    expect(env).toContain('DB_PORT=5433\n');
    expect(env).not.toContain('POSTGRES_PASSWORD');
    expect(env).toContain('VITE_OIDC_AUDIENCE=\n');
    expect(env).toContain('AUTH_AUDIENCE=lotties-api\n');
  });

  it('includes the push settings, with the private key marked secret, only when push is on', () => {
    const env = buildEnvFile({
      ...valid,
      pushEnabled: true,
      vapidPublicKey: 'PublicKey',
      vapidPrivateKey: VAPID_PRIVATE,
      vapidSubject: 'mailto:me@example.com',
    });
    expect(env).toContain('PUSH_VAPID_PUBLIC_KEY=PublicKey\n');
    expect(env).toContain(`PUSH_VAPID_PRIVATE_KEY=${VAPID_PRIVATE}\n`);
    expect(env).toContain('PUSH_VAPID_SUBJECT=mailto:me@example.com\n');
    expect(env).toMatch(/# SECRET\nPUSH_VAPID_PRIVATE_KEY=/);
  });

  it('normalises the origin list', () => {
    const env = buildEnvFile({
      ...valid,
      corsOrigins: ' https://a.example.com , capacitor://localhost,',
    });
    expect(env).toContain('CORS_ALLOWED_ORIGINS=https://a.example.com,capacitor://localhost\n');
  });

  it('throws for invalid input', () => {
    expect(() => buildEnvFile(DEFAULT_INPUT)).toThrow();
    expect(() => buildComposeFile(DEFAULT_INPUT)).toThrow();
  });

  it('uses only variable names documented in docs/DEPLOY.md', () => {
    const full = buildEnvFile({
      ...valid,
      pushEnabled: true,
      vapidPublicKey: 'a',
      vapidPrivateKey: 'b',
      vapidSubject: 'mailto:me@example.com',
    });
    const undocumented = envNames(full).filter(
      (name) => !deployDoc.includes(`\`${name}\``) && !deployDoc.includes(`${name},`),
    );
    expect(undocumented).toEqual([]);
  });
});

describe('buildComposeFile', () => {
  const full: SelfHostInput = {
    ...valid,
    pushEnabled: true,
    vapidPublicKey: 'PublicKey',
    vapidPrivateKey: VAPID_PRIVATE,
    vapidSubject: 'mailto:me@example.com',
  };

  it('holds no secret and no typed value, only references', () => {
    const compose = buildComposeFile({ ...full, privacyControllerName: 'Ana & Beto' });
    for (const secret of [
      PASSWORD,
      VAPID_PRIVATE,
      'PublicKey',
      'Ana & Beto',
      'id.example.com',
      'lotties-web',
    ]) {
      expect(compose).not.toContain(secret);
    }
  });

  it('references only variables the repository compose file also uses', () => {
    const known = new Set(composeVars(rootCompose));
    expect(composeVars(buildComposeFile(full)).filter((v) => !known.has(v))).toEqual([]);
    expect(
      composeVars(buildComposeFile({ ...valid, dbMode: 'external', dbHost: 'db' })).filter(
        (v) => !known.has(v),
      ),
    ).toEqual([]);
  });

  it('passes through every variable the env file defines for the api and the web build', () => {
    const compose = new Set(composeVars(buildComposeFile(full)));
    for (const name of envNames(buildEnvFile(full))) {
      if (name === 'DB_MIGRATOR_USER') continue;
      expect(compose.has(name), name).toBe(true);
    }
  });

  it('keeps the healthcheck of the repository compose file', () => {
    const wanted = rootCompose
      .split('\n')
      .find((l) => l.includes('test: ["CMD", "bash"'))!
      .trim();
    expect(buildComposeFile(valid)).toContain(wanted);
  });

  it('adds the database service and waits for it only in bundled mode', () => {
    const bundled = buildComposeFile(valid);
    expect(bundled).toContain('  postgres:\n    image: postgres:16');
    expect(bundled).toContain('condition: service_healthy');
    expect(bundled).toContain('pg_isready -U $${POSTGRES_USER}');
    expect(bundled).toContain('volumes:\n  pgdata:');
    expect(bundled).not.toContain('127.0.0.1:5432');
    const external = buildComposeFile({ ...valid, dbMode: 'external', dbHost: 'db.internal' });
    expect(external).not.toContain('postgres');
    expect(external).not.toContain('service_healthy');
  });

  it('leaves the push variables out when push is off', () => {
    expect(buildComposeFile(valid)).not.toContain('PUSH_VAPID');
    expect(buildComposeFile(full)).toContain('PUSH_VAPID_PRIVATE_KEY: ${PUSH_VAPID_PRIVATE_KEY:-}');
  });

  it('is deterministic', () => {
    expect(buildComposeFile(valid)).toBe(buildComposeFile({ ...valid }));
  });
});

describe('identityProviderSettings', () => {
  it('derives the redirect addresses', () => {
    expect(identityProviderSettings('https://baby.example.com/some/path')).toEqual({
      callback: 'https://baby.example.com/auth/callback',
      logout: 'https://baby.example.com/login',
      webOrigin: 'https://baby.example.com',
    });
    expect(identityProviderSettings('nope')).toBeNull();
  });
});

describe('secrets', () => {
  it('makes letters-and-digits passwords of the asked length', () => {
    const a = randomPassword();
    expect(a).toMatch(/^[A-Za-z0-9]{32}$/);
    expect(randomPassword(48)).toHaveLength(48);
    expect(randomPassword()).not.toBe(a);
  });

  it('rejects biased bytes', () => {
    // 248 and above would favour the first characters, so they are skipped.
    const values = [255, 250, 248, 0, 1, 2, 3];
    let i = 0;
    const fill = (array: Uint8Array) => {
      array.forEach((_, k) => (array[k] = values[i++ % values.length]));
      return array;
    };
    expect(randomPassword(3, fill)).toBe('ABC');
  });

  it('encodes base64url without padding', () => {
    expect(base64Url(new Uint8Array([251, 255, 254]))).toBe('-__-');
    expect(base64Url(new Uint8Array([1]))).toBe('AQ');
  });

  it('makes a VAPID pair in the API format: 65-byte point and 32-byte scalar', async () => {
    const pair = await generateVapidPair();
    const decode = (s: string) =>
      Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
    expect(pair.publicKey).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(pair.privateKey).toMatch(/^[A-Za-z0-9_-]+$/);
    const publicBytes = decode(pair.publicKey);
    expect(publicBytes).toHaveLength(65);
    expect(publicBytes[0]).toBe(4);
    expect(decode(pair.privateKey)).toHaveLength(32);
    expect((await generateVapidPair()).privateKey).not.toBe(pair.privateKey);
  });
});
