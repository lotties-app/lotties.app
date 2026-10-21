import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/*
 * Icon sets in the built app (see icons-dark.config.ts):
 *  1. For each OS colour scheme (and stored theme choices) it reports the manifest link href, the
 *     apple-touch-icon href and which tab icon the browser would pick (the icon links whose media
 *     query matches, plus the SVG that follows the scheme itself).
 *  2. Screenshots: favicons at 16/32 px (and 8x zoom) on light and dark tab strips, and the
 *     maskable icons of both sets through Android circle and squircle masks.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const SHOTS = path.resolve(here, "..", "..", "docs", "design", "screenshots");
fs.mkdirSync(SHOTS, { recursive: true });

interface Report {
  manifest: string | null;
  appleTouchIcon: string | null;
  tabIcons: string[];
  dataAttr: string;
}

async function inspect(page: Page): Promise<Report> {
  return page.evaluate(() => {
    const links = [
      ...document.querySelectorAll<HTMLLinkElement>('link[rel="icon"]'),
    ];
    const tabIcons = links
      .filter((l) => !l.media || matchMedia(l.media).matches)
      .map((l) => l.getAttribute("href") ?? "");
    const root = document.documentElement;
    return {
      manifest:
        document.querySelector('link[rel="manifest"]')?.getAttribute("href") ??
        null,
      appleTouchIcon:
        document
          .querySelector('link[rel="apple-touch-icon"]')
          ?.getAttribute("href") ?? null,
      tabIcons,
      dataAttr:
        ["data-light", "data-dark", "data-night"].find((a) =>
          root.hasAttribute(a),
        ) ?? "-",
    };
  });
}

const CASES = [
  {
    os: "dark",
    stored: undefined,
    manifest: "/manifest-dark.webmanifest",
    tab: "/favicon-dark.png",
  },
  {
    os: "light",
    stored: undefined,
    manifest: "/manifest.webmanifest",
    tab: "/favicon.png",
  },
  {
    os: "light",
    stored: "dark",
    manifest: "/manifest-dark.webmanifest",
    tab: "/favicon.png",
  },
  {
    os: "dark",
    stored: "light",
    manifest: "/manifest.webmanifest",
    tab: "/favicon-dark.png",
  },
] as const;

for (const c of CASES) {
  test(`links: OS ${c.os}, stored ${c.stored ?? "none"}`, async ({
    browser,
  }) => {
    const context = await browser.newContext({ colorScheme: c.os });
    if (c.stored) {
      await context.addInitScript((mode) => {
        window.localStorage.setItem("baby-routine.theme", mode);
      }, c.stored);
    }
    const page = await context.newPage();
    await page.goto("/");
    await page.waitForTimeout(1000); // let the app's theme provider run too
    const report = await inspect(page);
    console.log(
      `OS ${c.os}, stored ${c.stored ?? "none"}: ${JSON.stringify(report)}`,
    );
    const manifest = await (
      await page.request.get(report.manifest ?? "/")
    ).json();
    console.log(
      `  manifest icons: ${manifest.icons.map((i: { src: string }) => i.src).join(", ")}; ` +
        `theme ${manifest.theme_color}`,
    );
    expect(report.manifest).toBe(c.manifest);
    expect(report.appleTouchIcon).toBe(
      c.manifest.includes("dark")
        ? "/apple-touch-icon-dark.png"
        : "/apple-touch-icon.png",
    );
    // The PNG tab icon follows the OS (the browser UI), not the stored choice.
    expect(report.tabIcons).toContain(c.tab);
    await context.close();
  });
}

const sheet = (body: string, width: number, height: number) => `<!doctype html>
<meta charset="utf-8"><style>
  body{margin:0;font:13px system-ui;width:${width}px;height:${height}px}
  .row{display:flex;gap:24px;padding:16px 24px;align-items:center}
  .strip{display:flex;gap:12px;align-items:center;padding:8px 14px;border-radius:10px 10px 0 0;width:300px}
  .strip.light{background:#f1f3f4;color:#202124}.strip.dark{background:#35363a;color:#e8eaed}
  .strip span{font-size:12px}
  .zoom img{image-rendering:pixelated}
  .wall{display:flex;gap:28px;padding:24px;align-items:center}
  .wall.light{background:#d9d4c8}.wall.dark{background:#15130f}
  .mask{width:128px;height:128px;overflow:hidden}
  .circle{border-radius:50%}.squircle{border-radius:34%}
  .mask img{width:100%;height:100%;display:block}
  figure{margin:0;text-align:center;color:#888}
</style>${body}`;

async function shot(
  page: Page,
  html: string,
  name: string,
  w: number,
  h: number,
) {
  await page.setViewportSize({ width: w, height: h });
  await page.route("**/__sheet", (r) =>
    r.fulfill({ contentType: "text/html", body: sheet(html, w, h) }),
  );
  await page.goto("/__sheet");
  await page.waitForLoadState("load");
  await page.screenshot({ path: path.join(SHOTS, name) });
  await page.unroute("**/__sheet");
}

const FAVICONS = ["favicon.png", "favicon-dark.png"];
const MASKED = [
  ["icon-maskable-512.png", "circle"],
  ["icon-maskable-512.png", "squircle"],
  ["icon-maskable-dark-512.png", "circle"],
  ["icon-maskable-dark-512.png", "squircle"],
  ["icon-dark-512.png", "squircle"],
];

test("screenshots: favicons on tab strips and Android masks", async ({
  browser,
}) => {
  const context = await browser.newContext({ deviceScaleFactor: 1 });
  const page = await context.newPage();

  // A tab strip of each browser theme, with the favicon of each set at 16 and 32 px, and zoomed.
  const strips = ["light", "dark"]
    .map((strip) => {
      const cells = FAVICONS.map(
        (
          file,
        ) => `<div class="strip ${strip}"><img src="/${file}" width="16" height="16">
            <img src="/${file}" width="32" height="32"><span>${file} on ${strip} strip</span></div>
            <div class="zoom"><img src="/${file}" width="128" height="128"></div>`,
      ).join("");
      return `<div class="row">${cells}</div>`;
    })
    .join("");
  await shot(page, strips, "icons-dark-tabs.png", 1100, 330);

  const masks = ["light", "dark"]
    .map((wall) => {
      const cells = MASKED.map(
        ([file, shape]) =>
          `<figure><div class="mask ${shape}"><img src="/${file}"></div>${file}<br>${shape}</figure>`,
      ).join("");
      return `<div class="wall ${wall}">${cells}</div>`;
    })
    .join("");
  await shot(page, masks, "icons-dark-masks.png", 1100, 440);

  const apple = `<div class="wall dark"><figure><div class="mask squircle"><img src="/apple-touch-icon.png"></div>apple-touch-icon</figure>
    <figure><div class="mask squircle"><img src="/apple-touch-icon-dark.png"></div>apple-touch-icon-dark</figure>
    <figure><div class="mask squircle"><img src="/icon-monochrome-512.png" style="background:#ccc"></div>monochrome (alpha)</figure></div>`;
  await shot(page, apple, "icons-dark-apple.png", 700, 220);
  await context.close();
});
