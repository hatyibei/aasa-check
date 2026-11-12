/**
 * CLI. `run(argv, io)` returns an exit code (callable directly from tests).
 *
 * Exit codes: 0 = OK, 1 = match failure (or error), 2 = CDN mismatch (warning).
 * If both a match failure and a CDN mismatch occur, the exit code is 1.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { compareCdn, fetchSiteAasa, canonicalJson, type CdnComparison, type FetchLike, type SiteFetch } from "./cdn.js";
import { matchUniversalLink, parseExpect } from "./engine.js";
import { runFixtureDir, type FixtureResult } from "./fixtures.js";
import { parseLinkTestFile } from "./testfile.js";
import type { AasaFile, MatchResult } from "./types.js";
import { validateAasa } from "./validate.js";

export const EXIT_OK = 0;
export const EXIT_FAIL = 1;
export const EXIT_CDN_MISMATCH = 2;

export interface Io {
  stdout: (s: string) => void;
  stderr: (s: string) => void;
  fetch: FetchLike;
  cwd: string;
}

export const USAGE = `aasa-check

Usage:
  aasa-check match  --aasa <file.json> --url <url> [--app-id TEAM.com.bundle] [--expect app|web]
  aasa-check check  --test-file links.test.yml [--aasa file.json] [--domain example.com] [--app-id ID] [--no-cdn]
  aasa-check compare-cdn --domain example.com [--aasa file.json]
  aasa-check validate --aasa file.json
  aasa-check fixtures [--dir fixtures/unit]

Common flags: --json for machine-readable output, -h/--help for this message
Exit codes: 0 = OK / 1 = match failure or error / 2 = CDN mismatch (warning; 1 wins if a match also failed)
`;

const VALUE_FLAGS = new Set(["--aasa", "--url", "--app-id", "--test-file", "--domain", "--dir", "--expect"]);
const BOOL_FLAGS = new Set(["--no-cdn", "--json", "--help", "-h"]);

interface ParsedArgs {
  command?: string;
  values: Record<string, string>;
  flags: Set<string>;
  positionals: string[];
}

export function parseArgs(argv: string[]): ParsedArgs {
  const values: Record<string, string> = {};
  const flags = new Set<string>();
  const positionals: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    let a = argv[i]!;
    let inline: string | undefined;
    if (a.startsWith("--") && a.includes("=")) {
      inline = a.slice(a.indexOf("=") + 1);
      a = a.slice(0, a.indexOf("="));
    }
    if (VALUE_FLAGS.has(a)) {
      const v = inline ?? argv[++i];
      if (v === undefined) throw new UsageError(`${a} requires a value`);
      values[a.slice(2)] = v;
    } else if (BOOL_FLAGS.has(a)) {
      flags.add(a === "-h" ? "--help" : a);
    } else if (a.startsWith("-")) {
      throw new UsageError(`unknown option: ${a}`);
    } else positionals.push(a);
  }
  return { command: positionals.shift(), values, flags, positionals };
}

class UsageError extends Error {}

function readJsonFile(path: string, cwd: string): unknown {
  const text = readFileSync(resolve(cwd, path), "utf8");
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error(`${path}: not valid JSON: ${(e as Error).message}`);
  }
}

function describeRule(r: MatchResult): string {
  if (!r.matchedRule) return "Matched rule: none";
  const m = r.matchedRule;
  return `Matched rule: details[${m.detailIndex}].${m.source}[${m.index}] ${JSON.stringify(m.pattern)} exclude=${m.exclude}`;
}

const label = (b: boolean) => (b ? "app" : "web");

export async function run(argv: string[], io: Io): Promise<number> {
  let args: ParsedArgs;
  try {
    args = parseArgs(argv);
  } catch (e) {
    io.stderr(`error: ${(e as Error).message}\n\n${USAGE}`);
    return EXIT_FAIL;
  }
  if (!args.command || args.flags.has("--help")) {
    io.stdout(USAGE);
    return args.command || args.flags.has("--help") ? EXIT_OK : EXIT_FAIL;
  }
  const json = args.flags.has("--json");
  try {
    switch (args.command) {
      case "match":
        return cmdMatch(args, io, json);
      case "check":
        return await cmdCheck(args, io, json);
      case "compare-cdn":
        return await cmdCompareCdn(args, io, json);
      case "validate":
        return cmdValidate(args, io, json);
      case "fixtures":
        return cmdFixtures(args, io, json);
      default:
        io.stderr(`error: unknown command: ${args.command}\n\n${USAGE}`);
        return EXIT_FAIL;
    }
  } catch (e) {
    if (json) io.stdout(JSON.stringify({ error: (e as Error).message, exitCode: EXIT_FAIL }, null, 2) + "\n");
    else io.stderr(`error: ${(e as Error).message}\n`);
    return EXIT_FAIL;
  }
}

function need(args: ParsedArgs, key: string): string {
  const v = args.values[key];
  if (v === undefined) throw new UsageError(`--${key} is required`);
  return v;
}

function cmdMatch(args: ParsedArgs, io: Io, json: boolean): number {
  const aasa = readJsonFile(need(args, "aasa"), io.cwd) as AasaFile;
  const url = need(args, "url");
  const appID = args.values["app-id"];
  const result = matchUniversalLink(aasa, url, appID ? { appID } : {});
  let exitCode = EXIT_OK;
  let expected: boolean | undefined;
  if (args.values.expect !== undefined) {
    expected = parseExpect(args.values.expect);
    if (expected === undefined) throw new UsageError("--expect must be app|open|true or web|exclude|false");
    if (expected !== result.opens) exitCode = EXIT_FAIL;
  }
  if (json) {
    io.stdout(JSON.stringify({ url, appID, ...result, expected: expected === undefined ? undefined : label(expected), exitCode }, null, 2) + "\n");
  } else {
    io.stdout(
      `${url}\n  Result: ${label(result.opens)}${result.appIDs.length ? ` (${result.appIDs.join(", ")})` : ""}\n` +
        `  Reason: ${result.reason}\n  ${describeRule(result)}\n` +
        (expected !== undefined ? `  Expected: ${label(expected)} → ${expected === result.opens ? "OK" : "FAIL"}\n` : ""),
    );
  }
  return exitCode;
}

function cmdValidate(args: ParsedArgs, io: Io, json: boolean): number {
  const path = need(args, "aasa");
  const v = validateAasa(readJsonFile(path, io.cwd));
  if (json) io.stdout(JSON.stringify({ file: path, ...v, exitCode: v.ok ? EXIT_OK : EXIT_FAIL }, null, 2) + "\n");
  else {
    io.stdout(`${path}: ${v.ok ? "OK" : "FAIL"} (errors ${v.errors.length} / warnings ${v.warnings.length})\n`);
    for (const e of v.errors) io.stdout(`  error: ${e}\n`);
    for (const w of v.warnings) io.stdout(`  warning: ${w}\n`);
  }
  return v.ok ? EXIT_OK : EXIT_FAIL;
}

function cmdFixtures(args: ParsedArgs, io: Io, json: boolean): number {
  const dir = args.values.dir ?? "fixtures/unit";
  const results: FixtureResult[] = runFixtureDir(resolve(io.cwd, dir));
  const total = results.reduce((n, r) => n + r.cases.length, 0);
  const passed = results.reduce((n, r) => n + r.cases.filter((c) => c.pass).length, 0);
  const ok = results.length > 0 && passed === total;
  if (json) {
    io.stdout(
      JSON.stringify(
        {
          dir,
          fixtures: results.map((r) => ({
            name: r.name,
            file: r.file,
            pass: r.pass,
            cases: r.cases.map((c) => ({
              url: c.url,
              appID: c.appID,
              expected: c.expected === undefined ? null : label(c.expected),
              actual: label(c.actual),
              pass: c.pass,
              reason: c.result.reason,
              matchedRule: c.result.matchedRule ?? null,
            })),
          })),
          total,
          passed,
          exitCode: ok ? EXIT_OK : EXIT_FAIL,
        },
        null,
        2,
      ) + "\n",
    );
  } else {
    for (const r of results) {
      io.stdout(`${r.pass ? "PASS" : "FAIL"} ${r.name} (${r.cases.filter((c) => c.pass).length}/${r.cases.length})\n`);
      for (const c of r.cases.filter((c) => !c.pass)) {
        io.stdout(
          `  FAIL ${c.url}\n    Expected: ${c.expected === undefined ? "(invalid expect)" : label(c.expected)} / actual: ${label(c.actual)}\n` +
            `    ${describeRule(c.result)}\n    Reason: ${c.result.reason}\n`,
        );
      }
    }
    io.stdout(`\nFixtures: ${results.length}, cases: ${passed}/${total} passed\n`);
  }
  return ok ? EXIT_OK : EXIT_FAIL;
}

function cdnSummaryJson(c: CdnComparison) {
  return {
    status: c.status,
    domain: c.domain,
    source: c.sourceKind,
    siteUrl: c.site?.doc.finalUrl,
    siteRedirects: c.site?.doc.redirects ?? [],
    cdnUrl: c.cdn?.requestedUrl,
    notes: c.notes,
    errors: c.errors,
    diffPaths: c.diffPaths,
  };
}

function printCdn(c: CdnComparison, io: Io) {
  const head =
    c.status === "match" ? "match" : c.status === "mismatch" ? "mismatch (warning)" : "fetch failed (error)";
  io.stdout(`CDN comparison (${c.domain}, source=${c.sourceKind === "site" ? "site" : "local file"}): ${head}\n`);
  if (c.site?.doc.ok) io.stdout(`  site: ${c.site.doc.finalUrl}\n`);
  if (c.cdn) io.stdout(`  CDN: ${c.cdn.requestedUrl}\n`);
  for (const n of c.notes) io.stdout(`  note: ${n}\n`);
  for (const e of c.errors) io.stdout(`  error: ${e}\n`);
  if (c.diffPaths.length) io.stdout(`  differing keys: ${c.diffPaths.join(", ")}\n`);
}

function cdnExit(c: CdnComparison): number {
  if (c.status === "error") return EXIT_FAIL;
  if (c.status === "mismatch") return EXIT_CDN_MISMATCH;
  return EXIT_OK;
}

async function cmdCompareCdn(args: ParsedArgs, io: Io, json: boolean): Promise<number> {
  const domain = need(args, "domain");
  const localAasa = args.values.aasa !== undefined ? readJsonFile(args.values.aasa, io.cwd) : undefined;
  const c = await compareCdn({ domain, fetchImpl: io.fetch, localAasa });
  const exitCode = cdnExit(c);
  if (json) io.stdout(JSON.stringify({ cdn: cdnSummaryJson(c), exitCode }, null, 2) + "\n");
  else printCdn(c, io);
  return exitCode;
}

async function cmdCheck(args: ParsedArgs, io: Io, json: boolean): Promise<number> {
  const testPath = need(args, "test-file");
  const tf = parseLinkTestFile(readFileSync(resolve(io.cwd, testPath), "utf8"));
  // domain / appID in the file take precedence over --domain / --app-id
  const domain = tf.domain ?? args.values.domain;
  const appID = tf.appID ?? args.values["app-id"];
  const noCdn = args.flags.has("--no-cdn");
  const errors: string[] = [];
  const notes: string[] = [];

  let aasa: AasaFile | undefined;
  let aasaSource = "";
  let site: SiteFetch | undefined;
  if (args.values.aasa !== undefined) {
    aasa = readJsonFile(args.values.aasa, io.cwd) as AasaFile;
    aasaSource = args.values.aasa;
  } else if (domain) {
    site = await fetchSiteAasa(domain, io.fetch);
    if (site.doc.ok) {
      aasa = site.doc.json as AasaFile;
      aasaSource = site.doc.finalUrl;
      notes.push(...site.notes);
    } else {
      for (const a of site.attempts) errors.push(`site: ${a.requestedUrl}: ${a.error}`);
    }
  } else {
    throw new UsageError("--aasa or a domain (in the test file or --domain) is required");
  }

  const cases = aasa
    ? tf.cases.map((c) => {
        const r = matchUniversalLink(aasa!, c.url, appID ? { appID } : {});
        return { ...c, result: r, pass: r.opens === c.expect };
      })
    : [];
  if (domain) {
    for (const c of tf.cases) {
      try {
        const h = new URL(c.url).hostname;
        if (h !== domain) notes.push(`${c.url}: host ${h} differs from domain ${domain}`);
      } catch {
        /* invalid URLs are treated as web by the engine */
      }
    }
  }
  const failed = cases.filter((c) => !c.pass);

  let cdn: CdnComparison | undefined;
  if (!noCdn && domain) {
    // CDN comparison is between the deployed site and the CDN. The site is fetched even when --aasa is set.
    cdn = await compareCdn({ domain, fetchImpl: io.fetch, site });
    if (aasa && args.values.aasa !== undefined && cdn.site?.doc.ok && canonicalJson(aasa) !== canonicalJson(cdn.site.doc.json)) {
      notes.push(`the --aasa file differs from the site AASA (does not affect the exit code)`);
    }
  }

  let exitCode = EXIT_OK;
  if (errors.length > 0 || failed.length > 0 || cdn?.status === "error") exitCode = EXIT_FAIL;
  else if (cdn?.status === "mismatch") exitCode = EXIT_CDN_MISMATCH;

  if (json) {
    io.stdout(
      JSON.stringify(
        {
          testFile: testPath,
          domain: domain ?? null,
          appID: appID ?? null,
          aasaSource,
          total: tf.cases.length,
          passed: cases.length - failed.length,
          failed: failed.length,
          cases: cases.map((c) => ({
            url: c.url,
            expected: label(c.expect),
            actual: label(c.result.opens),
            pass: c.pass,
            reason: c.result.reason,
            matchedRule: c.result.matchedRule ?? null,
            exclude: c.result.matchedRule?.exclude ?? false,
          })),
          cdn: cdn ? cdnSummaryJson(cdn) : null,
          notes,
          errors,
          exitCode,
        },
        null,
        2,
      ) + "\n",
    );
  } else {
    io.stdout(`AASA: ${aasaSource || "(could not fetch)"}${appID ? `  appID: ${appID}` : ""}\n`);
    for (const c of cases) {
      if (c.pass) {
        io.stdout(`PASS ${c.url} → ${label(c.result.opens)}\n`);
      } else {
        io.stdout(
          `FAIL ${c.url}\n  Expected: ${label(c.expect)} / actual: ${label(c.result.opens)}\n` +
            `  ${describeRule(c.result)}\n  exclude: ${c.result.matchedRule?.exclude ? "yes" : "no"}\n  Reason: ${c.result.reason}\n`,
        );
      }
    }
    io.stdout(`Matching: ${cases.length - failed.length}/${tf.cases.length} passed\n`);
    for (const n of notes) io.stdout(`note: ${n}\n`);
    for (const e of errors) io.stdout(`error: ${e}\n`);
    if (cdn) printCdn(cdn, io);
    else if (noCdn) io.stdout("CDN comparison: skipped (--no-cdn)\n");
    else io.stdout("CDN comparison: skipped (no domain)\n");
    io.stdout(`Exit code: ${exitCode}\n`);
  }
  return exitCode;
}
