import 'fake-indexeddb/auto';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';
import { i18n } from '../i18n/i18n';

afterEach(async () => {
  cleanup();
  window.localStorage.clear();
  // Every test starts in English, whatever language the previous one switched to.
  await i18n.changeLanguage('en');
  document.documentElement.lang = '';
});
