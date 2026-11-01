import { test, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/*
 * Captures the Caregiver role: the Day list as a caregiver (someone else's rows read-only, "Given
 * by Ana" under a dose), the read-only sheet of someone else's entry, and Settings > Members &
 * invites as the owner (members with a caregiver, the invite role picker with descriptions).
 * Light and dark, English and Portuguese, phone size. Credential-free (see
 * caregiver-preview.config.ts).
 *
 * Narrow it with CAREGIVER_SCHEMES=dark CAREGIVER_LOCALES=en.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const SHOTS = path.resolve(here, "..", "..", "..", "docs", "design", "screenshots");
fs.mkdirSync(SHOTS, { recursive: true });

const SCHEMES = ["light", "dark"] as const;
const LOCALES = ["en", "pt-BR"] as const;

const pick = <T extends string>(env: string | undefined, all: readonly T[]): T[] =>
  env ? all.filter((value) => env.split(",").includes(value)) : [...all];

async function contextFor(browser: import("@playwright/test").Browser, locale: string) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
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
  return context;
}

async function open(page: Page, url: string): Promise<void> {
  await page.goto(url);
  await page.locator('main, [role="dialog"], h1, h2, p').first().waitFor({ state: "attached" });
  await page.waitForTimeout(900); // fonts, live queries and the seed settle
}

async function shoot(page: Page, name: string, fullPage = true): Promise<void> {
  await page.screenshot({
    path: path.join(SHOTS, `${name}.png`),
    fullPage,
    animations: "disabled",
    caret: "hide",
  });
}

test("Caregiver: Day list, read-only sheet, members and the invite role picker", async ({
  browser,
}) => {
  for (const locale of pick(process.env.CAREGIVER_LOCALES, LOCALES)) {
    const context = await contextFor(browser, locale);
    const page = await context.newPage();
    for (const scheme of pick(process.env.CAREGIVER_SCHEMES, SCHEMES)) {
      const tag = `${scheme}-${locale}`;
      await open(page, `/dev/day?state=caregiver&offset=1&scheme=${scheme}`);
      await page.getByText(/^(Given by|Dado por) Ana$/).first().waitFor();
      await shoot(page, `caregiver-day-${tag}`);
      const dose = page.locator("li", { hasText: /^.*(Given by|Dado por) Ana/ }).first();
      await dose.scrollIntoViewIfNeeded();
      await shoot(page, `caregiver-dose-row-${tag}`, false);

      await page
        .getByRole("button", { name: /(added by|registrado por) Ana/ })
        .first()
        .click();
      await page.getByRole("dialog").waitFor();
      await page.waitForTimeout(500);
      await shoot(page, `caregiver-readonly-${tag}`, false);
      await page.keyboard.press("Escape");

      await open(page, `/dev/roles?scheme=${scheme}`);
      await page.getByText("Lu (grandma)", { exact: true }).waitFor();
      await shoot(page, `caregiver-members-${tag}`);
      await page.getByRole("combobox", { name: /^(Invite role|Papel do convite)/ }).click();
      await page.getByRole("listbox").waitFor();
      await page.waitForTimeout(400);
      await shoot(page, `caregiver-invite-picker-${tag}`, false);
      await page.keyboard.press("Escape");
    }
    await context.close();
  }
});
