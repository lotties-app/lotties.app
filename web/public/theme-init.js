/*
 * Pre-paint theme: runs synchronously from <head> (an external file, because the CSP allows no
 * inline scripts) so the first frame already has the right colours. It mirrors the rules in
 * src/theme/nightFeed.ts and src/theme/themeStorage.ts; keep them in sync (storage keys, the
 * 22:00-05:00 window, the period key). Failures are ignored: the app sets the scheme itself.
 */
(function () {
  try {
    var root = document.documentElement;
    var store = window.localStorage;
    var mode = store.getItem('baby-routine.theme');
    var prefersLight =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-color-scheme: light)').matches;
    var scheme = mode === 'light' || (mode !== 'dark' && prefersLight) ? 'light' : 'dark';

    var now = new Date();
    var hour = now.getHours();
    var inWindow = hour >= 22 || hour < 5;
    var start = new Date(now.getTime());
    if (inWindow && hour < 22) start.setDate(start.getDate() - 1);
    var pad = function (n) {
      return (n < 10 ? '0' : '') + n;
    };
    var date = start.getFullYear() + '-' + pad(start.getMonth() + 1) + '-' + pad(start.getDate());
    var key = (inWindow ? 'n:' : 'd:') + date;

    var setting = store.getItem('baby-routine.nightFeed');
    var state = JSON.parse(store.getItem('baby-routine.nightFeed.state') || 'null');
    var override = state && state.override;
    var explicit =
      override && override.key === key && typeof override.on === 'boolean'
        ? override.on
        : undefined;
    var night = explicit !== undefined ? explicit : setting === 'auto' && inWindow;
    if (night) scheme = 'night';

    root.setAttribute('data-' + scheme, '');
    var colors = { light: '#f5efe4', dark: '#1b1814', night: '#0d0906' };
    var metas = document.querySelectorAll('meta[name="theme-color"]');
    for (var i = 0; i < metas.length; i++) {
      metas[i].removeAttribute('media');
      metas[i].setAttribute('content', colors[scheme]);
    }
  } catch (e) {
    /* storage or matchMedia unavailable */
  }
})();
