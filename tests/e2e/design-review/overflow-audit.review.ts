import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/*
 * Mobile overflow audit (docs/design/30-mobile-overflow-audit.md; config: overflow-audit.config.ts).
 * For every preview scenario below, each language and colour scheme, the page is loaded once on a
 * touch phone (isMobile + hasTouch: coarse pointer, overlay scrollbars) and measured at every
 * width with the root text at 100 % and 160 %. A finding is one of:
 *   overflow       an element sticks out of the viewport sideways and no ancestor clips or
 *                  scrolls it (the outermost one is reported, with its width); `document` when the
 *                  page is wider than the screen without a single culprit
 *   hscroll        an element scrolls sideways with its scrollbar shown (intended carousels hide it)
 *   double-scroll  body and html both scroll, or a tall inner box scrolls while the page scrolls too
 *   under-dock     with the page scrolled to its end, a control sits under the fixed bottom dock
 *   vh-unit        a height/min-height/max-height in `vh` (hidden under the mobile browser toolbar;
 *                  use dvh/svh)
 *   input-font     a text input/select/textarea under 16 px (iOS zooms the page on focus)
 *   viewport-meta  the viewport meta caps zoom (maximum-scale / user-scalable=no)
 * The developer-only preview toolbar (the box around its `Scenario` select) is left out.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(here, "output", "overflow-audit");
fs.mkdirSync(OUT, { recursive: true });

const WIDTHS = [320, 360, 390, 430] as const;
const LOCALES = ["en", "pt-BR"] as const;
const SCHEMES = ["light", "dark"] as const;
const TEXT_SCALES = [100, 160] as const;
const HEIGHT = 740;

const states = (base: string, list: string[], extra = "") =>
  list.map((state) => `${base}?state=${state}${extra}`);

/** Every screen the previews reach with fixture data, by group (AUDIT_ROUTES filters groups). */
const ROUTES: Record<string, string[]> = {
  now: states("/dev/now", [
    "empty",
    "learning",
    "awake",
    "nap",
    "night",
    "waking",
    "nursing",
    "forgotten",
    "catchup",
    "viewer",
    "meds",
    "paused",
    "timers",
    "belly",
    "overtired",
    "fussy",
    "wet",
    "dirty",
    "bottle",
    "stack",
    "caregiver",
  ]),
  ring: states("/dev/ring", [
    "ahead",
    "inside",
    "asleep",
    "night",
    "empty",
    "busy",
  ]).concat(states("/dev/ring", ["ahead", "busy"], "&view=ruler")),
  day: states(
    "/dev/day",
    ["full", "empty", "busy", "viewer", "timers", "caregiver", "moretypes"],
    "&offset=1",
  ).concat(states("/dev/day", ["full"], "&offset=0")),
  sheet: states("/dev/sheet", [
    "bottle",
    "breast",
    "solid",
    "diaper",
    "sleep",
    "medication",
    "belly",
    "edit",
    "running",
    "finish",
    "bottlestop",
    "sleepdetails",
    "temperature",
    "teething",
    "milestone",
  ]),
  insights: states("/dev/insights", ["rich", "partial", "short", "empty"]),
  hub: states("/dev/hub", [
    "owner",
    "quiet",
    "caregiver",
    "viewer",
    "doctor",
    "timers",
    "updates",
    "about",
    "settings",
    "providers",
    "import",
    "export",
    "backup",
    "credits",
  ]),
  meds: states("/dev/meds", [
    "settings",
    "editor-new",
    "editor-med",
    "editor-times",
    "editor-edit",
    "chooser",
    "dialog",
  ]),
  formulas: states("/dev/formulas", [
    "settings",
    "caregiver",
    "sheet",
    "chips",
    "insights",
    "single",
  ]),
  appointments: states("/dev/appointments", [
    "month",
    "day",
    "sheet",
    "edit",
    "detail",
    "ask",
    "now",
    "daystrip",
    "caregiver",
    "caregiverDetail",
    "empty",
  ]),
  vaccines: states("/dev/vaccines", [
    "timeline",
    "record",
    "edit",
    "profile",
    "sources",
    "now",
    "card",
    "private",
    "caregiver",
    "empty",
  ]),
  doctor: states("/dev/doctor", [
    "profile",
    "accept",
    "members",
    "notes",
    "composer",
    "family",
    "growth",
    "joined",
  ]).concat(["/dev/roles"]),
  dashboard: states("/dev/doctor-dashboard", [
    "home",
    "summary",
    "partial",
    "timeline",
    "growth",
    "medications",
    "notes",
    "settings",
    "empty",
  ]),
  proposals: states("/dev/proposals", [
    "prescribe",
    "change",
    "proposals",
    "inbox",
    "details",
    "declining",
    "fromDoctor",
    "provenance",
    "original",
    "verified",
  ]),
  notifications: states("/dev/notifications", [
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
  ]),
  landing: states(
    "/dev/landing",
    ["default", "failed", "ended"],
    "&unsynced=3",
  ).concat(["/credits"]),
};

const pick = <T extends string | number>(
  env: string | undefined,
  all: readonly T[],
): T[] =>
  env
    ? all.filter((value) => env.split(",").includes(String(value)))
    : [...all];

export interface Finding {
  kind:
    | "overflow"
    | "hscroll"
    | "double-scroll"
    | "under-dock"
    | "vh-unit"
    | "input-font"
    | "viewport-meta";
  target: string;
  detail: string;
}

export interface Measured extends Finding {
  route: string;
  locale: string;
  scheme: string;
  width: number;
  text: number;
}

/** Runs in the page: every finding at the current size. Self-contained (serialised by Playwright). */
function measure(): Finding[] {
  const findings: Finding[] = [];
  const root = document.documentElement;
  const vw = root.clientWidth;
  const vh = window.innerHeight;
  const skip = (el: Element) =>
    !!el.closest(':has(> select[aria-label="Scenario"])');
  const visible = (el: Element) => {
    const style = getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") return false;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 1 || rect.height <= 1) return false;
    return !el.closest('[aria-hidden="true"]');
  };
  const describe = (el: Element): string => {
    const parts: string[] = [];
    let node: Element | null = el;
    for (let depth = 0; node && node !== document.body && depth < 4; depth++) {
      let part = node.tagName.toLowerCase();
      if (node.id) part += `#${node.id}`;
      const testId = node.getAttribute("data-testid");
      if (testId) part += `[data-testid=${testId}]`;
      const role = node.getAttribute("role");
      if (role) part += `[role=${role}]`;
      const classes = [...node.classList].filter(
        (c) => /^Mui[A-Z]/.test(c) && !/-root$|Mui-/.test(c),
      );
      const roots = [...node.classList].filter((c) =>
        /^Mui[A-Za-z]+-root$/.test(c),
      );
      part += [...roots, ...classes]
        .slice(0, 2)
        .map((c) => `.${c}`)
        .join("");
      parts.unshift(part);
      if (node.id || testId) break;
      node = node.parentElement;
    }
    const text = (el.textContent ?? "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 40);
    return `${parts.join(" > ")}${text ? ` "${text}"` : ""}`;
  };
  const all = [...document.body.querySelectorAll("*")].filter(
    (el) => !skip(el),
  );

  // overflow: outermost element out of the viewport sideways, not clipped by a scroller/hidden box.
  const clipped = (el: Element) => {
    for (
      let node = el.parentElement;
      node && node !== document.body;
      node = node.parentElement
    ) {
      const overflowX = getComputedStyle(node).overflowX;
      if (overflowX !== "visible") return true;
    }
    return false;
  };
  const sticksOut = (el: Element) => {
    const rect = el.getBoundingClientRect();
    return rect.right > vw + 1 || rect.left < -1;
  };
  const offenders = all.filter(
    (el) => visible(el) && sticksOut(el) && !clipped(el),
  );
  const outer = offenders.filter(
    (el) => !offenders.includes(el.parentElement as Element),
  );
  for (const el of outer) {
    const rect = el.getBoundingClientRect();
    // The likely cause: the deepest offender inside it (a long word, a nowrap label, a fixed width).
    const leaves = offenders.filter(
      (other) =>
        el.contains(other) &&
        !offenders.some((o) => o !== other && other.contains(o)),
    );
    const culprit =
      leaves.length && leaves[0] !== el
        ? `; culprit ${describe(leaves[0])}`
        : "";
    findings.push({
      kind: "overflow",
      target: describe(el),
      detail: `left ${Math.round(rect.left)} right ${Math.round(rect.right)} (viewport ${vw}, width ${Math.round(rect.width)})${culprit}`,
    });
  }
  if (root.scrollWidth > vw + 1 && outer.length === 0) {
    findings.push({
      kind: "overflow",
      target: "document",
      detail: `scrollWidth ${root.scrollWidth} > clientWidth ${vw}`,
    });
  }

  // hscroll: a sideways scroller with its scrollbar shown.
  for (const el of all) {
    const style = getComputedStyle(el);
    if (style.overflowX !== "auto" && style.overflowX !== "scroll") continue;
    if (
      el.scrollWidth <= el.clientWidth + 1 ||
      el.clientWidth === 0 ||
      !visible(el)
    )
      continue;
    if (style.scrollbarWidth === "none") continue;
    const edge = el.getBoundingClientRect().right;
    const inside = [...el.querySelectorAll("*")].filter(
      (child) =>
        visible(child) && child.getBoundingClientRect().right > edge + 1,
    );
    const leaf = inside.find(
      (child) => !inside.some((o) => o !== child && child.contains(o)),
    );
    findings.push({
      kind: "hscroll",
      target: describe(el),
      detail: `scrollWidth ${el.scrollWidth} > clientWidth ${el.clientWidth}${leaf ? `; culprit ${describe(leaf)}` : ""}`,
    });
  }

  // double-scroll: body scrolling on its own, or a tall inner scroller inside a scrolling page.
  const scrolls = (el: Element) => {
    const overflowY = getComputedStyle(el).overflowY;
    return (
      (overflowY === "auto" || overflowY === "scroll") &&
      el.scrollHeight > el.clientHeight + 1
    );
  };
  const pageLocked =
    getComputedStyle(document.body).overflow === "hidden" ||
    getComputedStyle(root).overflow === "hidden";
  const pageScrolls = !pageLocked && root.scrollHeight > root.clientHeight + 1;
  if (scrolls(document.body) && getComputedStyle(root).overflowY !== "hidden") {
    findings.push({
      kind: "double-scroll",
      target: "body",
      detail: "body scrolls on its own",
    });
  }
  if (pageScrolls) {
    for (const el of all) {
      if (!scrolls(el) || !visible(el)) continue;
      if (
        el.closest(
          '[role="dialog"], [role="presentation"], [role="listbox"], [role="menu"]',
        )
      )
        continue;
      if (el.getBoundingClientRect().height < vh * 0.5) continue;
      findings.push({
        kind: "double-scroll",
        target: describe(el),
        detail: `inner scroller ${el.clientHeight}px tall inside a scrolling page`,
      });
    }
  }

  // vh-unit: authored heights in vh on an element of this page.
  const VH = /(^|[^a-z])-?\d*\.?\d+vh\b/;
  const visit = (rules: CSSRuleList) => {
    for (const rule of [...rules]) {
      if (rule instanceof CSSStyleRule) {
        for (const prop of ["height", "min-height", "max-height"]) {
          const value = rule.style.getPropertyValue(prop);
          if (!value || !VH.test(value)) continue;
          let match: Element | null = null;
          try {
            match = document.querySelector(rule.selectorText);
          } catch {
            match = null;
          }
          if (match && !skip(match)) {
            findings.push({
              kind: "vh-unit",
              target: describe(match),
              detail: `${prop}: ${value}`,
            });
          }
        }
      } else if ("cssRules" in rule) {
        try {
          visit((rule as CSSGroupingRule).cssRules);
        } catch {
          /* ignore */
        }
      }
    }
  };
  for (const sheet of [...document.styleSheets]) {
    try {
      visit(sheet.cssRules);
    } catch {
      /* cross-origin sheet */
    }
  }

  // input-font: what iOS zooms into on focus.
  const TEXT_INPUT =
    'input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=hidden]):not([type=file]):not([type=button]):not([type=submit]):not([type=reset]):not([type=color]), select, textarea, [contenteditable="true"]';
  for (const el of document.querySelectorAll(TEXT_INPUT)) {
    // Not the hidden twins some widgets keep (TextareaAutosize's measuring textarea).
    if (skip(el) || !visible(el) || (el as HTMLElement).tabIndex < 0) continue;
    const size = parseFloat(getComputedStyle(el).fontSize);
    if (size < 16) {
      findings.push({
        kind: "input-font",
        target: describe(el),
        detail: `font-size ${size}px`,
      });
    }
  }

  // viewport-meta
  const meta =
    document.querySelector('meta[name="viewport"]')?.getAttribute("content") ??
    "";
  if (/maximum-scale|user-scalable\s*=\s*(no|0)/i.test(meta)) {
    findings.push({
      kind: "viewport-meta",
      target: "meta[name=viewport]",
      detail: meta,
    });
  }
  return findings;
}

/** Runs in the page: scrolls to the end and reports controls under the fixed bottom dock. */
async function underDock(): Promise<Finding[]> {
  const findings: Finding[] = [];
  const vh = window.innerHeight;
  const body = getComputedStyle(document.body);
  if (body.overflow === "hidden") return findings; // a modal is open: the page behind is inert
  const docks = [...document.querySelectorAll("body *")].filter((el) => {
    if (el.closest(':has(> select[aria-label="Scenario"])')) return false;
    const style = getComputedStyle(el);
    if (
      style.position !== "fixed" ||
      style.display === "none" ||
      style.visibility === "hidden"
    )
      return false;
    const rect = el.getBoundingClientRect();
    return (
      rect.bottom >= vh - 40 &&
      rect.top > vh * 0.6 &&
      rect.height > 20 &&
      rect.width > 40
    );
  });
  if (docks.length === 0) return findings;
  const scroller = document.scrollingElement ?? document.documentElement;
  const before = scroller.scrollTop;
  scroller.scrollTop = scroller.scrollHeight;
  await new Promise((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(resolve)),
  );
  const controls = document.querySelectorAll(
    'a[href], button, input, select, textarea, [role="button"], [role="tab"], [role="switch"], [tabindex="0"]',
  );
  for (const control of controls) {
    if (
      control.closest(':has(> select[aria-label="Scenario"])') ||
      control.closest('[aria-hidden="true"]')
    )
      continue;
    if (docks.some((dock) => dock.contains(control))) continue;
    let fixed = false;
    for (let node: Element | null = control; node; node = node.parentElement) {
      const position = getComputedStyle(node).position;
      if (position === "fixed" || position === "sticky") fixed = true;
    }
    if (fixed) continue;
    const rect = control.getBoundingClientRect();
    if (rect.width <= 1 || rect.height <= 1) continue;
    for (const dock of docks) {
      const d = dock.getBoundingClientRect();
      const overlapY =
        Math.min(rect.bottom, d.bottom) - Math.max(rect.top, d.top);
      const overlapX =
        Math.min(rect.right, d.right) - Math.max(rect.left, d.left);
      if (overlapY > 2 && overlapX > 2) {
        const label = (
          control.getAttribute("aria-label") ??
          control.textContent ??
          ""
        )
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 40);
        findings.push({
          kind: "under-dock",
          target: `${control.tagName.toLowerCase()} "${label}"`,
          detail: `control ${Math.round(rect.top)}-${Math.round(rect.bottom)} under fixed ${dock.tagName.toLowerCase()} ${Math.round(d.top)}-${Math.round(d.bottom)}`,
        });
        break;
      }
    }
  }
  scroller.scrollTop = before;
  return findings;
}

async function settle(page: Page, url: string): Promise<void> {
  await page.goto(url);
  await page
    .locator('main, h1, h2, p, [role="dialog"], [role="search"]')
    .first()
    .waitFor({ state: "attached", timeout: 30_000 });
  await page.waitForTimeout(1200); // fonts, live queries and the seed settle
}

async function setTextScale(page: Page, scale: number): Promise<void> {
  await page.evaluate((value) => {
    let tag = document.getElementById("audit-text-scale");
    if (!tag) {
      tag = document.createElement("style");
      tag.id = "audit-text-scale";
      document.head.appendChild(tag);
    }
    tag.textContent =
      value === 100 ? "" : `html { font-size: ${value}% !important; }`;
  }, scale);
}

const groups = pick(process.env.AUDIT_ROUTES, Object.keys(ROUTES));
const locales = pick(process.env.AUDIT_LOCALES, LOCALES);
const schemes = pick(process.env.AUDIT_SCHEMES, SCHEMES);
const widths = pick(process.env.AUDIT_WIDTHS, WIDTHS);
const scales = pick(process.env.AUDIT_TEXT, TEXT_SCALES);

for (const group of groups) {
  for (const locale of locales) {
    for (const scheme of schemes) {
      test(`overflow ${group} ${locale} ${scheme}`, async ({ browser }) => {
        const context = await browser.newContext({
          viewport: { width: widths[0], height: HEIGHT },
          deviceScaleFactor: 2,
          isMobile: true,
          hasTouch: true,
          locale: locale === "en" ? "en-US" : "pt-BR",
          timezoneId: "America/Sao_Paulo",
          colorScheme: scheme,
        });
        await context.addInitScript(
          ([lang, mode]) => {
            try {
              window.localStorage.setItem("baby-routine.locale", lang);
              window.localStorage.setItem("baby-routine.theme", mode);
              window.localStorage.setItem("baby-routine.nightFeed", "off");
            } catch {
              /* ignore */
            }
          },
          [locale, scheme],
        );
        const page = await context.newPage();
        const results: Measured[] = [];
        for (const route of ROUTES[group]) {
          const url = `${route}${route.includes("?") ? "&" : "?"}scheme=${scheme}`;
          await settle(page, url);
          // The timers pill opens a popover: audit it open too.
          const extraStates: (() => Promise<void>)[] = [async () => undefined];
          if (route.includes("/dev/hub?state=timers")) {
            extraStates.push(async () => {
              await page.getByTestId("timer-pill").click();
              await page.waitForTimeout(500);
            });
          }
          for (const [index, enter] of extraStates.entries()) {
            const label = index === 0 ? route : `${route} (pill open)`;
            if (index > 0) await settle(page, url);
            await enter();
            for (const width of widths) {
              await page.setViewportSize({ width, height: HEIGHT });
              for (const text of scales) {
                await setTextScale(page, text);
                await page.waitForTimeout(250);
                const found = [...(await page.evaluate(measure))];
                if (index === 0)
                  found.push(...(await page.evaluate(underDock)));
                for (const finding of found) {
                  results.push({
                    ...finding,
                    route: label,
                    locale,
                    scheme,
                    width,
                    text,
                  });
                }
              }
            }
            await setTextScale(page, 100);
          }
        }
        await context.close();
        fs.writeFileSync(
          path.join(OUT, `${group}-${locale}-${scheme}.json`),
          JSON.stringify(results, null, 2),
        );
        // One line per distinct finding (text and positions vary by width and language).
        const distinct = [
          ...new Set(
            results.map(
              (r) =>
                `${r.kind} ${r.route} :: ${r.target.replace(/ ".*"$/, "")}`,
            ),
          ),
        ];
        expect(distinct, `${results.length} overflow findings`).toEqual([]);
      });
    }
  }
}
