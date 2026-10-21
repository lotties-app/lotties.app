import { test, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/*
 * Captures Settings > Notifications in every device state (off, explainer, on, granted-off,
 * denied, unsupported, iOS install guidance, iOS too old, offline), plus the reminder offer card
 * after a scheduled prescription, the dose reminder line in the Meds tray and the nap Why sheet
 * link (task N9). Light, dark and night, English
 * and Portuguese, 390x844 and 1280x800. Credential-free (see notifications-preview.config.ts).
 *
 * Narrow it with NOTIFICATIONS_VIEWPORTS=mobile NOTIFICATIONS_SCHEMES=dark
 * NOTIFICATIONS_LOCALES=en NOTIFICATIONS_STATES=on,explainer.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const SHOTS = path.resolve(here, "..", "..", "docs", "design", "screenshots");
fs.mkdirSync(SHOTS, { recursive: true });

const VIEWPORTS = {
  mobile: { width: 390, height: 844 },
  desktop: { width: 1280, height: 800 },
} as const;
const SCHEMES = ["light", "dark", "night"] as const;
const LOCALES = ["en", "pt-BR"] as const;
const STATES = [
  "off",
  "explainer",
  "on",
  "granted-off",
  "denied",
  "unsupported",
  "ios-needs-install",
  "ios-too-old",
  "offline",
  "prompt",
  "reminder",
  "why",
] as const;
/** Modal sheets: capture the viewport they cover. */
const SHEETS: readonly string[] = ["explainer", "reminder", "why"];

const pick = <T extends string>(
  env: string | undefined,
  all: readonly T[],
): T[] =>
  env ? all.filter((value) => env.split(",").includes(value)) : [...all];

async function open(page: Page, state: string, scheme: string): Promise<void> {
  await page.goto(`/dev/notifications?state=${state}&scheme=${scheme}`);
  await page.locator("h1").first().waitFor({ state: "attached" });
  await page.waitForTimeout(1200);
}

test("notifications settings in every state, scheme, language and viewport", async ({
  browser,
}) => {
  const viewports = pick(
    process.env.NOTIFICATIONS_VIEWPORTS,
    Object.keys(VIEWPORTS) as (keyof typeof VIEWPORTS)[],
  );
  const schemes = pick(process.env.NOTIFICATIONS_SCHEMES, SCHEMES);
  const locales = pick(process.env.NOTIFICATIONS_LOCALES, LOCALES);
  const states = pick(process.env.NOTIFICATIONS_STATES, STATES);

  for (const locale of locales) {
    const context = await browser.newContext({
      viewport: VIEWPORTS.mobile,
      deviceScaleFactor: 1,
      locale: locale === "en" ? "en-US" : "pt-BR",
      timezoneId: "America/Sao_Paulo",
    });
    await context.addInitScript((value) => {
      try {
        window.localStorage.setItem("baby-routine.locale", value);
      } catch {
        /* ignore */
      }
    }, locale);
    const page = await context.newPage();
    for (const viewport of viewports) {
      await page.setViewportSize(VIEWPORTS[viewport]);
      for (const scheme of schemes) {
        for (const state of states) {
          await open(page, state, scheme);
          await page.screenshot({
            path: path.join(
              SHOTS,
              `notifications-${state}-${viewport}-${scheme}-${locale}.png`,
            ),
            fullPage: !SHEETS.includes(state),
            animations: "disabled",
            caret: "hide",
          });
        }
      }
    }
    await context.close();
  }
});
