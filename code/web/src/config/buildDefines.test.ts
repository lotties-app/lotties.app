import { describe, expect, it } from 'vitest';
import { buildCommit, buildDefines, buildTime, buildVersion } from '../../build-info';
import { displayVersion, shortCommit } from './versionInfo';

const NOW = new Date('2026-10-24T12:00:00.000Z');
const noGit = () => {
  throw new Error('no git');
};

describe('build defines (vite.config.ts)', () => {
  it('maps the deploy stamp to the bundle constants', () => {
    const defines = buildDefines(
      { APP_VERSION: '0.1.38', APP_COMMIT: 'abc1234', APP_BUILD_TIME: '2026-10-24T10:00:00Z' },
      noGit,
      NOW,
    );
    expect(defines).toEqual({
      __APP_VERSION__: '"0.1.38"',
      __APP_BUILT_AT__: '"2026-10-24T10:00:00.000Z"',
      __APP_COMMIT__: '"abc1234"',
    });
  });

  it('is dev without APP_VERSION (a local build), and for a value that is not a release', () => {
    expect(buildVersion({})).toBe('dev');
    expect(buildVersion({ APP_VERSION: '' })).toBe('dev');
    expect(buildVersion({ APP_VERSION: 'latest' })).toBe('dev');
    expect(buildVersion({ APP_VERSION: '"; alert(1); "' })).toBe('dev');
  });

  it('drops a leading v and keeps a pre-release suffix', () => {
    expect(buildVersion({ APP_VERSION: ' v0.1.38 ' })).toBe('0.1.38');
    expect(buildVersion({ APP_VERSION: '1.2.3-rc.1' })).toBe('1.2.3-rc.1');
  });

  it('takes the commit from APP_COMMIT, else git, else empty', () => {
    expect(buildCommit({ APP_COMMIT: 'abcdef0123456789' }, noGit)).toBe('abcdef012345');
    expect(buildCommit({}, () => 'fedcba9\n')).toBe('fedcba9');
    expect(buildCommit({}, noGit)).toBe('');
  });

  it('takes the build time from APP_BUILD_TIME when valid, else now', () => {
    expect(buildTime({ APP_BUILD_TIME: '2026-10-24T10:00:00Z' }, NOW)).toBe(
      '2026-10-24T10:00:00.000Z',
    );
    expect(buildTime({ APP_BUILD_TIME: 'yesterday' }, NOW)).toBe(NOW.toISOString());
    expect(buildTime({}, NOW)).toBe(NOW.toISOString());
  });
});

describe('version display', () => {
  it('prefixes a release with v and leaves dev alone', () => {
    expect(displayVersion('0.1.38')).toBe('v0.1.38');
    expect(displayVersion('dev')).toBe('dev');
    expect(shortCommit('abcdef012345')).toBe('abcdef0');
  });
});
