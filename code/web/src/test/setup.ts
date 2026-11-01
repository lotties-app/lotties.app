import 'fake-indexeddb/auto';
import { cleanup, configure } from '@testing-library/react';
import { afterEach, beforeEach } from 'vitest';
import { resetHubPrefs } from '../hub/hubUsage';
import { i18n } from '../i18n/i18n';
import { resetUpdateStore } from '../pwa/updateStore';
import { setDeviceLocaleTag, setUnitSetting } from '../units/state';

// Screens with a date field import the date pickers on first render (hundreds of modules), which
// keeps the event loop busy for a few seconds on a cold run: waits must outlast that.
configure({ asyncUtilTimeout: 20000 });

// jsdom reports en-US, which `auto` reads as US customary: tests start metric (a device in en-GB)
// and say so when they need the other system.
beforeEach(() => {
  setDeviceLocaleTag('en-GB');
  setUnitSetting('auto');
});

afterEach(async () => {
  cleanup();
  window.localStorage.clear();
  // Module-level stores that mirror storage or the service worker start fresh in every test.
  resetHubPrefs();
  resetUpdateStore();
  // Every test starts in English, whatever language the previous one switched to.
  await i18n.changeLanguage('en');
  document.documentElement.lang = '';
});
