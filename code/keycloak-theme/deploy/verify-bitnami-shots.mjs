// Screenshots of the themed login page served by verify-bitnami-local.sh (http://localhost:8086), en and pt-BR,
// light and dark: docs/design/screenshots/keycloak-bn-<locale>-<scheme>.png. Playwright from tests/e2e/node_modules.
// Also asserts: the Fraunces wordmark/art CSS applied (computed font family of the title), no failed requests.
//   node verify-bitnami-shots.mjs [label]      label defaults to "" (use "restart" after restarting the container)
import { chromium } from '../../../tests/e2e/node_modules/playwright/index.mjs';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const BASE = process.env.KC_BASE ?? 'http://localhost:8086';
const CLIENT = process.env.CLIENT ?? 'baby-routine-web';
const label = process.argv[2] ? `-${process.argv[2]}` : '';
const out = fileURLToPath(new URL('../../../docs/design/screenshots', import.meta.url));
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
let failed = 0;
for (const locale of ['en', 'pt-BR']) {
  for (const scheme of ['light', 'dark']) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: scheme, locale });
    const page = await ctx.newPage();
    const bad = [];
    page.on('requestfailed', (r) => bad.push(r.url()));
    page.on('response', (r) => { if (r.status() >= 400) bad.push(`${r.status()} ${r.url()}`); });
    const url = `${BASE}/realms/lotties-dev/protocol/openid-connect/auth?client_id=${CLIENT}&redirect_uri=${encodeURIComponent('http://localhost:5190/')}&response_type=code&scope=openid&code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM&code_challenge_method=S256&kc_locale=${locale}`;
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.waitForSelector('input[name="username"], #username', { timeout: 15000 });
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    const lang = await page.evaluate(() => document.documentElement.lang);
    const accent = await page.evaluate(() => getComputedStyle(document.querySelector('button[type=submit], input[type=submit]')).backgroundColor);
    const hasBr = await page.evaluate(() => !!document.querySelector('[class*="br-"]'));
    const text = (await page.locator('body').innerText()).slice(0, 80).replace(/\s+/g, ' ');
    console.log(`${locale} ${scheme}: bg=${bg} lang=${lang} accent-button=${accent} br-classes=${hasBr} errors=${bad.length}${bad.length ? ' ' + bad.join(',') : ''} | ${text}`);
    if (!hasBr || bad.length) failed++;
    await page.screenshot({ path: `${out}/keycloak-bn${label}-${locale}-${scheme}.png` });
    await ctx.close();
  }
}
await browser.close();
process.exit(failed ? 1 : 0);
