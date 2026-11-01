import { test, type Browser, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/*
 * Captures the doctor's dashboard (`/dev/doctor-dashboard`) and the owner's side of doctor access
 * (`/dev/doctor`): Patients, the summary (every section, then some not shared), the timeline,
 * growth, medications, notes, the patient switcher open, the Doctor invite with its section
 * toggles, the "Doctor access" sheet and the screen after accepting. Light and dark, English and
 * Portuguese, on a phone (390x844) and a desktop (1280x800). Credential-free (see
 * doctor-dashboard-preview.config.ts).
 *
 * Narrow it with DASHBOARD_SCHEMES=dark DASHBOARD_LOCALES=en DASHBOARD_VIEWPORTS=phone.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const SHOTS = path.resolve(here, "..", "..", "..", "docs", "design", "screenshots");
fs.mkdirSync(SHOTS, { recursive: true });

const SCHEMES = ["light", "dark"] as const;
const LOCALES = ["en", "pt-BR"] as const;
const VIEWPORTS = {
  phone: { width: 390, height: 844 },
  desktop: { width: 1280, height: 800 },
} as const;
type Viewport = keyof typeof VIEWPORTS;
const PAGES = [
  "home",
  "summary",
  "partial",
  "timeline",
  "growth",
  "medications",
  "notes",
  "empty",
] as const;

const pick = <T extends string>(env: string | undefined, all: readonly T[]): T[] =>
  env ? all.filter((value) => env.split(",").includes(value)) : [...all];

const en = (locale: string) => locale === "en";

async function contextFor(browser: Browser, locale: string, viewport: Viewport) {
  const context = await browser.newContext({
    viewport: VIEWPORTS[viewport],
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

async function open(page: Page, route: string, scheme: string): Promise<void> {
  const separator = route.includes("?") ? "&" : "?";
  await page.goto(`${route}${separator}scheme=${scheme}`);
  await page.locator("h1, p").first().waitFor({ state: "attached" });
  await page.waitForTimeout(2000); // fonts, live queries, lazy chunks and the seed settle
}

const file = (name: string) => path.join(SHOTS, `${name}.png`);

async function shoot(page: Page, name: string, fullPage = true): Promise<void> {
  await page.screenshot({ path: file(name), fullPage, animations: "disabled", caret: "hide" });
}

function each(
  run: (page: Page, tag: string, ctx: { scheme: string; locale: string; viewport: Viewport }) => Promise<void>,
) {
  return async ({ browser }: { browser: Browser }) => {
    for (const viewport of pick(process.env.DASHBOARD_VIEWPORTS, Object.keys(VIEWPORTS) as Viewport[])) {
      for (const locale of pick(process.env.DASHBOARD_LOCALES, LOCALES)) {
        const context = await contextFor(browser, locale, viewport);
        const page = await context.newPage();
        for (const scheme of pick(process.env.DASHBOARD_SCHEMES, SCHEMES)) {
          await run(page, `${scheme}-${locale}-${viewport}`, { scheme, locale, viewport });
        }
        await context.close();
      }
    }
  };
}

test(
  "Dashboard pages",
  each(async (page, tag, { scheme }) => {
    for (const state of PAGES) {
      await open(page, `/dev/doctor-dashboard?state=${state}`, scheme);
      await shoot(page, `doctor-dashboard-${state}-${tag}`);
    }
  }),
);

test(
  "The patient switcher",
  each(async (page, tag, { scheme }) => {
    await open(page, "/dev/doctor-dashboard?state=summary", scheme);
    await page.getByRole("button", { name: /Change patient|Trocar paciente/ }).click();
    await page.waitForTimeout(500);
    await shoot(page, `doctor-dashboard-switcher-${tag}`, false);
    await page.keyboard.type("t");
    await page.waitForTimeout(300);
    await shoot(page, `doctor-dashboard-switcher-search-${tag}`, false);
  }),
);

test(
  "The owner's doctor access",
  each(async (page, tag, { scheme, locale }) => {
    await open(page, "/dev/doctor?state=members", scheme);
    await page.getByRole("combobox", { name: en(locale) ? "Invite role" : "Papel do convite" }).click();
    await page.getByRole("option", { name: en(locale) ? /^Doctor/ : /^Médico/ }).click();
    await page.waitForTimeout(400);
    await shoot(page, `doctor-dashboard-invite-${tag}`);

    await open(page, "/dev/doctor?state=members", scheme);
    await page.getByRole("button", { name: en(locale) ? "Doctor access of ana.s" : "Acesso de ana.s" }).click();
    await page.waitForTimeout(600);
    await shoot(page, `doctor-dashboard-access-${tag}`, false);

    await open(page, "/dev/doctor?state=joined", scheme);
    await shoot(page, `doctor-dashboard-joined-${tag}`);
  }),
);
