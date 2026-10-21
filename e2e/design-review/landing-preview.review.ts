import { test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/*
 * Captures the landing page (`/dev/landing`) in light, dark and night, English and Portuguese, at
 * 390x844, 320x568 and 1280x800, plus the error and ended-session cards, and runs axe on each.
 * Narrow it with LANDING_SCHEMES=light LANDING_LOCALES=en LANDING_VIEWPORTS=mobile.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const SHOTS = path.resolve(here, "..", "..", "docs", "design", "screenshots");
fs.mkdirSync(SHOTS, { recursive: true });

const VIEWPORTS = {
  mobile: { width: 390, height: 844 },
  small: { width: 320, height: 568 },
  desktop: { width: 1280, height: 800 },
} as const;
const SCHEMES = ["light", "dark", "night"] as const;
const LOCALES = ["en", "pt-BR"] as const;

const pick = <T extends string>(
  env: string | undefined,
  all: readonly T[],
): T[] =>
  env ? all.filter((value) => env.split(",").includes(value)) : [...all];

async function open(page: Page, query: string): Promise<void> {
  await page.goto(`/dev/landing?${query}`);
  await page.locator("h1").first().waitFor({ state: "attached" });
  await page.waitForTimeout(600); // fonts settle
}

test("landing page in every scheme, language and viewport", async ({
  browser,
}) => {
  const viewports = pick(
    process.env.LANDING_VIEWPORTS,
    Object.keys(VIEWPORTS) as (keyof typeof VIEWPORTS)[],
  );
  const schemes = pick(process.env.LANDING_SCHEMES, SCHEMES);
  const locales = pick(process.env.LANDING_LOCALES, LOCALES);

  for (const locale of locales) {
    for (const viewport of viewports) {
      const context = await browser.newContext({
        viewport: VIEWPORTS[viewport],
        locale: locale === "en" ? "en-US" : "pt-BR",
      });
      await context.addInitScript((value) => {
        try {
          window.localStorage.setItem("baby-routine.locale", value);
        } catch {
          // ignore
        }
      }, locale);
      const page = await context.newPage();
      for (const scheme of schemes) {
        const name = `landing-${locale}-${scheme}-${viewport}`;
        await open(page, `scheme=${scheme}`);
        const overflow = await page.evaluate(
          () =>
            document.documentElement.scrollWidth -
            document.documentElement.clientWidth,
        );
        const axe = await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa"])
          .analyze();
        console.log(
          `${name}: overflow=${overflow} axe=${axe.violations.map((v) => `${v.id}(${v.nodes.length})`).join(",") || "none"}`,
        );
        await page.screenshot({
          path: path.join(SHOTS, `${name}.png`),
          fullPage: true,
          animations: "disabled",
        });
      }
      if (viewport === "mobile") {
        for (const state of ["failed", "ended&unsynced=3"]) {
          await open(page, `scheme=light&state=${state}`);
          await page.screenshot({
            path: path.join(
              SHOTS,
              `landing-${locale}-${state.split("&")[0]}-${viewport}.png`,
            ),
            animations: "disabled",
          });
        }
      }
      await context.close();
    }
  }
});
