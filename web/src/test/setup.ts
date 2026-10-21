import 'fake-indexeddb/auto';
import { cleanup, configure } from '@testing-library/react';
import { afterEach } from 'vitest';
import { i18n } from '../i18n/i18n';

// Screens with a date field import the date pickers on first render (hundreds of modules), which
// keeps the event loop busy for a few seconds on a cold run: waits must outlast that.
configure({ asyncUtilTimeout: 8000 });

afterEach(async () => {
  cleanup();
  window.localStorage.clear();
  // Every test starts in English, whatever language the previous one switched to.
  await i18n.changeLanguage('en');
  document.documentElement.lang = '';
});
