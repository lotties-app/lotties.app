import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/*
 * Global teardown of overflow-audit.config.ts: folds the per-test JSON files into one compact
 * Markdown report, output/overflow-audit.md (gitignored): findings by screen group and kind, then
 * each distinct finding once with the combinations it shows up in.
 */
interface Measured {
  kind: string;
  target: string;
  detail: string;
  route: string;
  locale: string;
  scheme: string;
  width: number;
  text: number;
}

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(here, "output", "overflow-audit");

export default function summarize(): void {
  if (!fs.existsSync(OUT)) return;
  // Only this run's files (a narrowed run leaves the other groups' older files alone).
  const started = Number(process.env.AUDIT_STARTED ?? 0) - 1000;
  const files = fs
    .readdirSync(OUT)
    .filter(
      (name) =>
        name.endsWith(".json") &&
        fs.statSync(path.join(OUT, name)).mtimeMs >= started,
    );
  const rows: (Measured & { group: string })[] = [];
  const groups = new Set<string>();
  for (const file of files) {
    const group = file.replace(/-(en|pt-BR)-(light|dark)\.json$/, "");
    groups.add(group);
    const list = JSON.parse(
      fs.readFileSync(path.join(OUT, file), "utf8"),
    ) as Measured[];
    rows.push(...list.map((row) => ({ ...row, group })));
  }
  const kinds = [...new Set(rows.map((row) => row.kind))].sort();
  const lines: string[] = [
    `# Overflow audit (${new Date().toISOString()})`,
    "",
    `${rows.length} measured findings over ${files.length} runs (group x language x scheme).`,
    "",
    `| Group | ${kinds.join(" | ")} | Distinct |`,
    `| --- | ${kinds.map(() => "---").join(" | ")} | --- |`,
  ];
  // Text inside a finding (`"..."`) and positions vary by language and width: grouped without them.
  const keyOf = (row: Measured) =>
    `${row.kind}|${row.route}|${row.target.replace(/ ".*"$/, "")}`;
  for (const group of [...groups].sort()) {
    const mine = rows.filter((row) => row.group === group);
    const distinct = new Set(mine.map(keyOf)).size;
    const counts = kinds.map(
      (kind) => mine.filter((row) => row.kind === kind).length,
    );
    lines.push(`| ${group} | ${counts.join(" | ")} | ${distinct} |`);
  }
  lines.push("", "## Distinct findings", "");
  const byKey = new Map<string, (Measured & { group: string })[]>();
  for (const row of rows)
    byKey.set(keyOf(row), [...(byKey.get(keyOf(row)) ?? []), row]);
  for (const [, list] of [...byKey].sort(([a], [b]) => a.localeCompare(b))) {
    const first = list[0];
    const widths = [...new Set(list.map((row) => row.width))]
      .sort((a, b) => a - b)
      .join("/");
    const texts = [...new Set(list.map((row) => `${row.text}%`))].join("/");
    const locales = [...new Set(list.map((row) => row.locale))].join("/");
    lines.push(
      `- **${first.kind}** \`${first.route}\` ${first.target} (${first.detail}; ${list.length}x, ${widths}px, text ${texts}, ${locales})`,
    );
  }
  fs.writeFileSync(
    path.join(here, "output", "overflow-audit.md"),
    `${lines.join("\n")}\n`,
  );
  console.log(
    `Overflow audit report: ${path.join(here, "output", "overflow-audit.md")}`,
  );
}
