import { test, type Browser, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/*
 * Captures the doctor's prescription proposals (`/dev/proposals`): the Doctor's Prescribe sheet
 * (blank, with the chooser typing, and prefilled to propose a change) and My proposals; the parents'
 * Now inbox, the details sheet (and its decline step), "From your doctor", the Meds tray with the
 * provenance line and the read-only original; the verified badge. Light and dark, English and
 * Portuguese, on a phone (390x844). Credential-free (see proposals-preview.config.ts).
 *
 * Narrow it with PROPOSALS_SCHEMES=dark PROPOSALS_LOCALES=en.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const SHOTS = path.resolve(
  here,
  "..",
  "..",
  "..",
  "docs",
  "design",
  "screenshots",
);
fs.mkdirSync(SHOTS, { recursive: true });

const SCHEMES = ["light", "dark"] as const;
const LOCALES = ["en", "pt-BR"] as const;
const PAGES = ["proposals", "inbox", "fromDoctor", "verified"] as const;

const pick = <T extends string>(
  env: string | undefined,
  all: readonly T[],
): T[] =>
  env ? all.filter((value) => env.split(",").includes(value)) : [...all];

async function contextFor(browser: Browser, locale: string) {
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

async function open(page: Page, state: string, scheme: string): Promise<void> {
  await page.goto(`/dev/proposals?state=${state}&scheme=${scheme}`);
  await page.locator("h1, p").first().waitFor({ state: "attached" });
  await page.waitForTimeout(1800); // fonts, live queries and the seed settle
}

const file = (name: string) => path.join(SHOTS, `${name}.png`);

async function shoot(page: Page, name: string, fullPage = true): Promise<void> {
  await page.screenshot({
    path: file(name),
    fullPage,
    animations: "disabled",
    caret: "hide",
  });
}

const en = (locale: string) => locale === "en";

test("Proposals pages", async ({ browser }) => {
  for (const locale of pick(process.env.PROPOSALS_LOCALES, LOCALES)) {
    const context = await contextFor(browser, locale);
    const page = await context.newPage();
    for (const scheme of pick(process.env.PROPOSALS_SCHEMES, SCHEMES)) {
      for (const state of PAGES) {
        await open(page, state, scheme);
        await shoot(page, `proposals-${state}-${scheme}-${locale}`);
      }
    }
    await context.close();
  }
});

test("The Doctor sheets", async ({ browser }) => {
  for (const locale of pick(process.env.PROPOSALS_LOCALES, LOCALES)) {
    const context = await contextFor(browser, locale);
    const page = await context.newPage();
    for (const scheme of pick(process.env.PROPOSALS_SCHEMES, SCHEMES)) {
      const tag = `${scheme}-${locale}`;
      await open(page, "prescribe", scheme);
      await shoot(page, `proposals-prescribe-${tag}`, false);

      // The chooser: typing finds the baby's medicine and offers the name as typed.
      await page
        .getByRole("searchbox", {
          name: en(locale) ? "Find or add a medication" : /Buscar|Procurar/,
        })
        .fill("col");
      await page.waitForTimeout(400);
      await shoot(page, `proposals-chooser-${tag}`, false);

      await open(page, "change", scheme);
      await shoot(page, `proposals-change-${tag}`, false);
      // The sheet's body scrolls: look at its end (schedule, dates, instructions, footer).
      await page.evaluate(() => {
        const scrollers = [
          ...document.querySelectorAll(".MuiDrawer-paper *"),
        ].filter(
          (el) =>
            getComputedStyle(el).overflowY === "auto" &&
            el.scrollHeight > el.clientHeight,
        );
        scrollers.at(-1)?.scrollTo(0, 99_999);
      });
      await page.waitForTimeout(300);
      await shoot(page, `proposals-change-end-${tag}`, false);
    }
    await context.close();
  }
});

test("The parents sheets", async ({ browser }) => {
  for (const locale of pick(process.env.PROPOSALS_LOCALES, LOCALES)) {
    const context = await contextFor(browser, locale);
    const page = await context.newPage();
    for (const scheme of pick(process.env.PROPOSALS_SCHEMES, SCHEMES)) {
      const tag = `${scheme}-${locale}`;
      await open(page, "details", scheme);
      await shoot(page, `proposals-details-${tag}`, false);

      await page
        .getByRole("button", {
          name: en(locale) ? "Decline" : "Recusar",
          exact: true,
        })
        .click();
      await page.waitForTimeout(500);
      await shoot(page, `proposals-declining-${tag}`, false);

      await open(page, "original", scheme);
      await shoot(page, `proposals-original-${tag}`, false);

      await open(page, "provenance", scheme);
      await page
        .getByRole("button", { name: en(locale) ? /^Meds/ : /^Remédios/ })
        .click();
      await page.waitForTimeout(600);
      await shoot(page, `proposals-provenance-${tag}`, false);
      await page
        .getByRole("button", { name: en(locale) ? /See what/ : /Ver o que/ })
        .first()
        .click();
      await page.waitForTimeout(600);
      await shoot(page, `proposals-provenance-original-${tag}`, false);
    }
    await context.close();
  }
});
