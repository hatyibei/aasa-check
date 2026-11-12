/**
 * Helpers called from collect-ground-truth.sh.
 *   tsx scripts/ground-truth.ts export <fixturesDir> <outDir>   → TSV on stdout
 *   tsx scripts/ground-truth.ts report <fixturesDir> <outDir>   → results.json / comparison.md
 */
import { buildReport, exportFixtures } from "../src/groundtruth.ts";

const [cmd, ...args] = process.argv.slice(2);
if (cmd === "export") {
  const [fixturesDir = "fixtures/unit", outDir = "ground-truth"] = args;
  for (const r of exportFixtures(fixturesDir, outDir)) {
    process.stdout.write([r.fixture, r.index, r.url, r.domain, r.aasaPath, r.expected].join("\t") + "\n");
  }
} else if (cmd === "report") {
  const [fixturesDir = "fixtures/unit", outDir = "ground-truth"] = args;
  const s = buildReport(fixturesDir, outDir);
  process.stdout.write(
    `wrote results.json / comparison.md: agree ${s.agree} / disagree ${s.disagree} / unknown ${s.unknown} (total ${s.total})\n`,
  );
} else {
  process.stderr.write("usage: tsx scripts/ground-truth.ts export|report <fixturesDir> <outDir>\n");
  process.exitCode = 1;
}
