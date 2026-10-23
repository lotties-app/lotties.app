import { test, type Browser, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/*
 * The "Running now" layout of Now: what the first screen shows at 360, 390 and 430 px and on a
 * desktop window, light, dark and night, English and Portuguese, text at 100, 130 and 160 %; plus
 * the mini timer bar on Day with one and two timers, scrolled to the end (nothing may hide behind
 * it). `fold` shots are the first screen only; `full` shots the whole page.
 *
 * Narrow it with LAYOUT_ONLY=now|day LAYOUT_LOCALES=en LAYOUT_STATES=bottle,stack.
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

const WIDTHS = {
  w360: { width: 360, height: 780 },
  w390: { width: 390, height: 844 },
  w430: { width: 430, height: 932 },
  desk: { width: 1280, height: 800 },
} as const;
type Width = keyof typeof WIDTHS;
const STATES = [
  "empty",
  "awake",
  "bottle",
  "nap",
  "stack",
  "paused",
  "viewer",
  "caregiver",
];
const LOCALES = ["en", "pt-BR"] as const;
type Scheme = "light" | "dark" | "night";
const SCHEME_LABEL: Record<Scheme, RegExp> = {
  light: /^(Light|Claro)$/,
  dark: /^(Dark|Escuro)$/,
  night: /^(Night|Noite)$/,
};

const pick = <T extends string>(
  env: string | undefined,
  all: readonly T[],
): T[] =>
  env ? all.filter((value) => env.split(",").includes(value)) : [...all];

async function contextFor(browser: Browser, locale: string) {
  const context = await browser.newContext({
    viewport: WIDTHS.w390,
    deviceScaleFactor: 1,
    locale: locale === "en" ? "en-US" : "pt-BR",
    timezoneId: "America/Sao_Paulo",
  });
  await context.addInitScript((value) => {
    try {
      window.localStorage.setItem("baby-routine.locale", value);
      // Every shot starts from the default fold of the ring for its screen size.
      window.localStorage.removeItem("baby-routine.now-ring-open");
    } catch {
      /* ignore */
    }
  }, locale);
  return context;
}

async function scale(page: Page, percent: number) {
  await page.evaluate((value) => {
    document.documentElement.style.fontSize = `${value}%`;
  }, percent);
  await page.waitForTimeout(250);
}

async function openNow(
  page: Page,
  state: string,
  scheme: Scheme,
  percent = 100,
) {
  await page.goto(`/dev/now?state=${state}`);
  await page.getByRole("radio", { name: SCHEME_LABEL[scheme] }).click();
  await page.locator("h1").first().waitFor({ state: "attached" });
  await page.waitForTimeout(800);
  if (percent !== 100) await scale(page, percent);
  // The scheme switch sits at the end of the preview: back to the first screen.
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(150);
}

async function shoot(page: Page, name: string, fullPage: boolean) {
  await page.screenshot({
    path: path.join(SHOTS, `layout-${name}.png`),
    fullPage,
    animations: "disabled",
    caret: "hide",
  });
}

test("Now: first screen and full page per width, scheme and language", async ({
  browser,
}) => {
  if (process.env.LAYOUT_ONLY === "day") return;
  const states = pick(process.env.LAYOUT_STATES, STATES);
  for (const locale of pick(process.env.LAYOUT_LOCALES, LOCALES)) {
    const context = await contextFor(browser, locale);
    const page = await context.newPage();
    for (const width of Object.keys(WIDTHS) as Width[]) {
      await page.setViewportSize(WIDTHS[width]);
      for (const scheme of ["light", "dark"] as const) {
        for (const state of states) {
          await openNow(page, state, scheme);
          await shoot(
            page,
            `now-${state}-${width}-${scheme}-${locale}-fold`,
            false,
          );
          if (width === "w390")
            await shoot(
              page,
              `now-${state}-${width}-${scheme}-${locale}-full`,
              true,
            );
        }
      }
    }
    await context.close();
  }
});

test("Now: night scheme", async ({ browser }) => {
  if (process.env.LAYOUT_ONLY === "day") return;
  for (const locale of pick(process.env.LAYOUT_LOCALES, LOCALES)) {
    const context = await contextFor(browser, locale);
    const page = await context.newPage();
    for (const width of ["w360", "w390"] as const) {
      await page.setViewportSize(WIDTHS[width]);
      for (const state of [
        "awake",
        "bottle",
        "nap",
        "stack",
        "nursing",
        "paused",
      ]) {
        await openNow(page, state, "night");
        await shoot(page, `now-${state}-${width}-night-${locale}-fold`, false);
      }
    }
    await context.close();
  }
});

test("Now: larger text", async ({ browser }) => {
  if (process.env.LAYOUT_ONLY === "day") return;
  for (const locale of pick(process.env.LAYOUT_LOCALES, LOCALES)) {
    const context = await contextFor(browser, locale);
    const page = await context.newPage();
    for (const width of ["w360", "w430"] as const) {
      await page.setViewportSize(WIDTHS[width]);
      for (const percent of [130, 160]) {
        for (const state of ["awake", "bottle", "stack"]) {
          await openNow(page, state, "light", percent);
          await shoot(
            page,
            `now-${state}-${width}-text${percent}-${locale}-full`,
            true,
          );
        }
      }
    }
    await context.close();
  }
});

test("Now: the ring opened and the stack expanded", async ({ browser }) => {
  if (process.env.LAYOUT_ONLY === "day") return;
  for (const locale of pick(process.env.LAYOUT_LOCALES, LOCALES)) {
    const context = await contextFor(browser, locale);
    const page = await context.newPage();
    await page.setViewportSize(WIDTHS.w390);
    for (const scheme of ["light", "dark"] as const) {
      await openNow(page, "awake", scheme);
      await page
        .getByRole("button", { name: /^(Show the ring|Ver anel)$/ })
        .click();
      await page.waitForTimeout(400);
      await shoot(page, `now-ringopen-w390-${scheme}-${locale}-full`, true);
      await openNow(page, "stack", scheme);
      await page.getByRole("button", { name: /^(1 more|mais 1)$/ }).click();
      await page.waitForTimeout(400);
      await shoot(page, `now-stackopen-w390-${scheme}-${locale}-full`, true);
    }
    await context.close();
  }
});

test("Day: the mini timer bar with one and two timers, scrolled to the end", async ({
  browser,
}) => {
  if (process.env.LAYOUT_ONLY === "now") return;
  for (const locale of pick(process.env.LAYOUT_LOCALES, LOCALES)) {
    const context = await contextFor(browser, locale);
    const page = await context.newPage();
    for (const width of ["w360", "w390", "w430"] as const) {
      await page.setViewportSize(WIDTHS[width]);
      for (const scheme of ["light", "dark", "night"] as const) {
        for (const [name, state] of [
          ["one", "full"],
          ["two", "timers"],
        ] as const) {
          for (const percent of scheme === "light" ? [100, 160] : [100]) {
            await page.goto(
              `/dev/day?state=${state}&offset=0&scheme=${scheme}`,
            );
            await page
              .locator("main, h1, h2, p")
              .first()
              .waitFor({ state: "attached" });
            await page.waitForTimeout(900);
            if (percent !== 100) await scale(page, percent);
            await page.evaluate(() =>
              window.scrollTo(0, document.body.scrollHeight),
            );
            await page.waitForTimeout(300);
            await shoot(
              page,
              `day-bar-${name}-${width}-${scheme}-text${percent}-${locale}`,
              false,
            );
          }
        }
      }
    }
    await context.close();
  }
});
