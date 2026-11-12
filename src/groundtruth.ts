/**
 * Helpers for collect-ground-truth.sh. Best-effort parse of raw swcutil output, then compare with the engine.
 * swcutil's output format is undocumented and can change across versions, so the parse is a guess (unverified).
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { loadFixtureDir, runFixture } from "./fixtures.js";

export type SwcVerdict = "matched" | "blocked" | "unknown";

/** Does the output look like a usage or argument error? */
export function looksLikeUsageError(output: string): boolean {
  return /\busage\b|unrecognized option|unknown option|invalid option|illegal option|unknown (sub)?command|missing (required )?argument/i.test(output);
}

export function parseSwcutilVerdict(output: string, exitCode?: number): SwcVerdict {
  if (!output.trim() || looksLikeUsageError(output)) return "unknown";
  if (/\b(not\s+matched|not\s+match(es)?|does\s*n[o']?t\s+match|no\s+match|unmatched|blocked|excluded|denied)\b/i.test(output)) {
    return "blocked";
  }
  if (/\b(matched|matches|match|allowed|approved)\b/i.test(output)) return "matched";
  if (exitCode !== undefined && exitCode !== 0) return "unknown";
  return "unknown";
}

export interface ExportRow {
  fixture: string;
  index: number;
  url: string;
  domain: string;
  aasaPath: string;
  expected: string;
  unverified?: boolean;
}

/** Write each fixture's AASA to <out>/aasa/<name>.json and return a TSV of cases. */
export function exportFixtures(fixturesDir: string, outDir: string): ExportRow[] {
  const aasaDir = join(outDir, "aasa");
  mkdirSync(aasaDir, { recursive: true });
  const rows: ExportRow[] = [];
  for (const fx of loadFixtureDir(fixturesDir)) {
    const aasaPath = join(aasaDir, `${fx.name}.json`);
    writeFileSync(aasaPath, JSON.stringify(fx.aasa, null, 2) + "\n");
    fx.cases.forEach((c, i) => {
      rows.push({
        fixture: fx.name,
        index: i,
        url: c.url,
        domain: new URL(c.url).hostname,
        aasaPath,
        expected: String(c.expect),
        unverified: c.unverified === true,
      });
    });
  }
  return rows;
}

export interface SwcRecord {
  fixture: string;
  index: number;
  url: string;
  form: string;
  exitCode: number | null;
  rawFile: string;
}

/** Read verify.tsv written by collect-ground-truth.sh (fixture, index, url, form, exit, rawfile). */
export function readVerifyTsv(file: string): SwcRecord[] {
  let text = "";
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return [];
  }
  return text
    .split("\n")
    .filter((l) => l.trim() && !l.startsWith("#"))
    .map((l) => {
      const [fixture = "", index = "0", url = "", form = "", exit = "", rawFile = ""] = l.split("\t");
      return { fixture, index: Number(index), url, form, exitCode: exit === "" ? null : Number(exit), rawFile };
    });
}

export function buildReport(fixturesDir: string, outDir: string) {
  const records = readVerifyTsv(join(outDir, "verify.tsv"));
  const byKey = new Map(records.map((r) => [`${r.fixture}#${r.index}`, r]));
  const results: Array<Record<string, unknown>> = [];
  const lines: string[] = [
    "# Engine vs. swcutil",
    "",
    "swcutil verdicts are a best-effort parse of raw output (unverified). Inspect raw/ by hand when the verdict is `unknown`.",
    "",
    "| fixture | # | URL | expected | unverified | engine | swcutil | agree | verify form | raw |",
    "|---|---|---|---|---|---|---|---|---|---|",
  ];
  let agree = 0;
  let disagree = 0;
  let unknown = 0;
  for (const fx of loadFixtureDir(fixturesDir)) {
    const r = runFixture(fx);
    r.cases.forEach((c, i) => {
      const rec = byKey.get(`${fx.name}#${i}`);
      let raw = "";
      if (rec?.rawFile) {
        try {
          // Drop annotation lines the script added, such as "# command:"
          raw = readFileSync(rec.rawFile, "utf8")
            .split("\n")
            .filter((l) => !l.startsWith("# "))
            .join("\n");
        } catch {
          raw = "";
        }
      }
      const verdict: SwcVerdict = rec ? parseSwcutilVerdict(raw, rec.exitCode ?? undefined) : "unknown";
      const engine = c.actual ? "matched" : "blocked";
      const same = verdict === "unknown" ? null : verdict === engine;
      if (same === null) unknown++;
      else if (same) agree++;
      else disagree++;
      results.push({
        fixture: fx.name,
        index: i,
        url: c.url,
        expected: c.expected === undefined ? null : c.expected ? "app" : "web",
        unverified: c.unverified === true,
        engine,
        swcutil: verdict,
        agree: same,
        verifyForm: rec?.form ?? null,
        exitCode: rec?.exitCode ?? null,
        rawFile: rec?.rawFile ? relative(outDir, rec.rawFile) : null,
      });
      lines.push(
        `| ${fx.name} | ${i} | \`${c.url}\` | ${c.expected ? "app" : "web"} | ${c.unverified ? "unverified" : ""} | ${engine} | ${verdict} | ${same === null ? "?" : same ? "○" : "**×**"} | ${rec?.form ?? "-"} | ${rec?.rawFile ? relative(outDir, rec.rawFile) : "-"} |`,
      );
    });
  }
  lines.push("", `agree ${agree} / disagree ${disagree} / unknown ${unknown}`, "");
  const resultsPath = join(outDir, "results.json");
  mkdirSync(dirname(resultsPath), { recursive: true });
  writeFileSync(resultsPath, JSON.stringify({ generatedAt: new Date().toISOString(), agree, disagree, unknown, results }, null, 2) + "\n");
  writeFileSync(join(outDir, "comparison.md"), lines.join("\n"));
  return { agree, disagree, unknown, total: results.length };
}
