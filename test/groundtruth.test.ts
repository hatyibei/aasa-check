import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildReport, exportFixtures, looksLikeUsageError, parseSwcutilVerdict } from "../src/groundtruth.ts";

const FX = fileURLToPath(new URL("../fixtures/unit/", import.meta.url));

test("best-effort parse of swcutil output", () => {
  assert.equal(parseSwcutilVerdict("Pattern matched: /buy/*"), "matched");
  assert.equal(parseSwcutilVerdict("URL does not match any pattern"), "blocked");
  assert.equal(parseSwcutilVerdict("Blocked by exclusion rule"), "blocked");
  assert.equal(parseSwcutilVerdict("usage: swcutil verify ..."), "unknown");
  assert.equal(parseSwcutilVerdict(""), "unknown");
  assert.ok(looksLikeUsageError("swcutil: unrecognized option `-j'"));
});

test("export and report (synthetic swcutil results)", () => {
  const out = mkdtempSync(join(tmpdir(), "gt-"));
  const rows = exportFixtures(FX, out);
  assert.ok(rows.length >= 50);
  assert.ok(readFileSync(rows[0]!.aasaPath, "utf8").includes("applinks"));
  mkdirSync(join(out, "raw"));
  const r0 = rows[0]!;
  const raw = join(out, "raw", "a.txt");
  writeFileSync(raw, "matched");
  writeFileSync(join(out, "verify.tsv"), `${r0.fixture}\t${r0.index}\t${r0.url}\t1\t0\t${raw}\n`);
  const s = buildReport(FX, out);
  assert.equal(s.total, rows.length);
  assert.equal(s.agree, 1);
  const j = JSON.parse(readFileSync(join(out, "results.json"), "utf8"));
  assert.equal(j.results[0].swcutil, "matched");
  assert.match(readFileSync(join(out, "comparison.md"), "utf8"), /\| fixture \|/);
});
