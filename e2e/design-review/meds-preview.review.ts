import { test, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/*
 * Captures the medications M2 screens: Now with the Meds tile and the bedtime line, the Meds tray
 * (list, early + per-kg confirm), Settings > Medications, the prescription editor (new, per kg,
 * times, edit), the medication chooser with catalog results and the medication dialog. Light, dark
 * and night, English and Portuguese, 390x844 and 1280x800. Credential-free (see
 * meds-preview.config.ts).
 *
 * Narrow it with MEDS_VIEWPORTS=mobile MEDS_SCHEMES=dark MEDS_LOCALES=en MEDS_SHOTS=tray,editor-new.
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
const SHOT_NAMES = [
  "now",
  "tray",
  "tray-confirm",
  "settings",
  "editor-new",
  "editor-med",
  "editor-times",
  "editor-edit",
  "chooser",
  "dialog",
] as const;
type Scheme = (typeof SCHEMES)[number];
type ShotName = (typeof SHOT_NAMES)[number];

const pick = <T extends string>(
  env: string | undefined,
  all: readonly T[],
): T[] =>
  env ? all.filter((value) => env.split(",").includes(value)) : [...all];

const SCHEME_LABEL: Record<Scheme, string> = {
  light: "Light",
  dark: "Dark",
  night: "Night",
};

async function openNow(page: Page, scheme: Scheme): Promise<void> {
  await page.goto("/dev/now?state=meds");
  await page.getByRole("radio", { name: SCHEME_LABEL[scheme] }).click();
  await page.locator("h1").first().waitFor({ state: "attached" });
  await page.waitForTimeout(900);
}

async function openMeds(
  page: Page,
  state: string,
  scheme: Scheme,
  extra = "",
): Promise<void> {
  await page.goto(`/dev/meds?state=${state}&scheme=${scheme}${extra}`);
  await page.locator("h1").first().waitFor({ state: "attached" });
  await page.waitForTimeout(1200);
}

async function shoot(
  page: Page,
  name: string,
  fullPage: boolean,
): Promise<void> {
  await page.screenshot({
    path: path.join(SHOTS, `meds-${name}.png`),
    fullPage,
    animations: "disabled",
    caret: "hide",
  });
}

test("medications screens in every scheme, language and viewport", async ({
  browser,
}) => {
  const viewports = pick(
    process.env.MEDS_VIEWPORTS,
    Object.keys(VIEWPORTS) as (keyof typeof VIEWPORTS)[],
  );
  const schemes = pick(process.env.MEDS_SCHEMES, SCHEMES);
  const locales = pick(process.env.MEDS_LOCALES, LOCALES);
  const shots = pick<ShotName>(process.env.MEDS_SHOTS, SHOT_NAMES);

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
        const tag = `${viewport}-${scheme}-${locale}`;
        const has = (name: ShotName) => shots.includes(name);

        if (has("now")) {
          await openNow(page, scheme);
          await shoot(page, `now-${tag}`, true);
        }
        // The simple night layout has no Meds tile.
        if (scheme !== "night" && (has("tray") || has("tray-confirm"))) {
          await openNow(page, scheme);
          await page.getByRole("button", { name: /^(Meds|Remédios)/ }).click();
          await page.waitForTimeout(600);
          if (has("tray")) await shoot(page, `tray-${tag}`, false);
          if (has("tray-confirm")) {
            await page
              .getByRole("button", { name: /^(Log Colidis|Registrar Colidis)/ })
              .click();
            await page.waitForTimeout(500);
            await shoot(page, `tray-confirm-${tag}`, false);
          }
        }
        for (const state of [
          "settings",
          "editor-new",
          "editor-med",
          "editor-times",
          "editor-edit",
          "chooser",
          "dialog",
        ] as const) {
          if (!has(state)) continue;
          await openMeds(page, state, scheme);
          await shoot(
            page,
            `${state}-${tag}`,
            state === "settings" || state === "chooser",
          );
          if (state.startsWith("editor")) {
            // The editor scrolls inside its sheet: capture the bottom half as well.
            await page.evaluate(() => {
              const scrollers = Array.from(
                document.querySelectorAll('[role="dialog"] div'),
              ).filter(
                (el) =>
                  el.scrollHeight > el.clientHeight + 40 &&
                  getComputedStyle(el).overflowY === "auto",
              );
              scrollers.forEach((el) => (el.scrollTop = el.scrollHeight));
            });
            await page.waitForTimeout(400);
            await shoot(page, `${state}-bottom-${tag}`, false);
          }
        }
        if (has("chooser")) {
          await openMeds(page, "chooser", scheme);
          await page.getByRole("searchbox").fill("flygas");
          await page.waitForTimeout(2000);
          await shoot(page, `chooser-results-${tag}`, true);
        }
      }
    }
    await context.close();
  }
});
