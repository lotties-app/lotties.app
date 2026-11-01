import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  isEmailAddress,
  ISSUES_URL,
  missingPrivacySettings,
  privacyContacts,
  PRIVACY_SETTINGS,
  PRIVATE_REPORT_URL,
} from './privacyConfig';

/*
 * The controller, contact and encarregado come from build-time public values; unset, the page falls
 * back to its default text. These checks also keep the owner's checklist and the build wiring in step
 * with the list of settings.
 */

const root = resolve(import.meta.dirname, '..', '..', '..', '..');
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');

describe('privacy contacts from the build', () => {
  it('fall back to the defaults when nothing is set', () => {
    expect(privacyContacts({})).toEqual({ controllerName: null, contactEmail: null, dpo: null });
    expect(missingPrivacySettings({})).toEqual([...PRIVACY_SETTINGS]);
  });

  it('use the values the owner set, trimmed', () => {
    const env = {
      VITE_PRIVACY_CONTROLLER_NAME: '  Ana Souza ',
      VITE_PRIVACY_CONTACT_EMAIL: ' privacy@example.org ',
      VITE_PRIVACY_DPO: 'Ana Souza, dpo@example.org',
    };
    expect(privacyContacts(env)).toEqual({
      controllerName: 'Ana Souza',
      contactEmail: 'privacy@example.org',
      dpo: 'Ana Souza, dpo@example.org',
    });
    expect(missingPrivacySettings(env)).toEqual([]);
  });

  it.each([
    ['', 'empty'],
    ['   ', 'blank'],
    ['<owner name>', 'a placeholder'],
    ['Name\u0000', 'a control character'],
    ['x'.repeat(201), 'too long'],
  ])('ignores %j (%s)', (value) => {
    expect(privacyContacts({ VITE_PRIVACY_CONTROLLER_NAME: value }).controllerName).toBeNull();
    expect(privacyContacts({ VITE_PRIVACY_DPO: value }).dpo).toBeNull();
  });

  it.each(['not an email', 'a@b', 'mailto:a@b.org', 'a@b.org?subject=x', '<privacy@example.org>'])(
    'refuses %j as the contact email (it becomes a mailto link)',
    (value) => {
      expect(privacyContacts({ VITE_PRIVACY_CONTACT_EMAIL: value }).contactEmail).toBeNull();
    },
  );

  it('recognises plain email addresses', () => {
    expect(isEmailAddress('privacy@lotties.app')).toBe(true);
    expect(isEmailAddress('Ana <ana@lotties.app>')).toBe(false);
  });

  it('defaults the contact to the repository on GitHub', () => {
    expect(ISSUES_URL).toBe('https://github.com/dev-vinicius-andrade/lotties.app/issues');
    expect(PRIVATE_REPORT_URL).toBe(
      'https://github.com/dev-vinicius-andrade/lotties.app/security/advisories/new',
    );
  });
});

describe('the settings the owner must set before a store submission', () => {
  it.each([
    'docs/PRIVACY-OWNER-CHECKLIST.md',
    'docs/DEPLOY.md',
    'code/web/.env.example',
    '.env.example',
    'deploy/homelab/.env.example',
  ])('are all documented in %s', (path) => {
    const text = read(path);
    const missing = PRIVACY_SETTINGS.filter((setting) => !text.includes(setting));
    expect(missing, path).toEqual([]);
  });

  it.each(['code/web/Dockerfile', 'docker-compose.yml', 'deploy/homelab/deploy.sh'])(
    'reach the web build through %s',
    (path) => {
      const text = read(path);
      const missing = PRIVACY_SETTINGS.filter((setting) => !text.includes(setting));
      expect(missing, path).toEqual([]);
    },
  );
});
