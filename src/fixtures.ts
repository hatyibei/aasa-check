/** Load and run fixtures (AASA + URL + expected). */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { matchUniversalLink, parseExpect } from "./engine.js";
import type { AasaFile, MatchResult } from "./types.js";

export interface FixtureCase {
  url: string;
  expect: string | boolean;
  appID?: string;
  note?: string;
  /** If true, expect is a best guess and has not been verified with swcutil. */
  unverified?: boolean;
}

export interface Fixture {
  name: string;
  description?: string;
  appID?: string;
  aasa: AasaFile;
  cases: FixtureCase[];
  /** File that was loaded */
  file?: string;
}

export interface CaseResult {
  url: string;
  appID?: string;
  expected: boolean | undefined;
  actual: boolean;
  pass: boolean;
  result: MatchResult;
  unverified?: boolean;
  note?: string;
}

export interface FixtureResult {
  name: string;
  file?: string;
  pass: boolean;
  cases: CaseResult[];
  error?: string;
}

export function loadFixtureFile(file: string): Fixture {
  const raw = JSON.parse(readFileSync(file, "utf8")) as Fixture;
  if (!raw || typeof raw !== "object") throw new Error(`${file}: not an object`);
  if (typeof raw.name !== "string") throw new Error(`${file}: "name" is required`);
  if (!raw.aasa || typeof raw.aasa !== "object") throw new Error(`${file}: "aasa" is required`);
  if (!Array.isArray(raw.cases)) throw new Error(`${file}: "cases" must be an array`);
  return { ...raw, file };
}

export function loadFixtureDir(dir: string): Fixture[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => loadFixtureFile(join(dir, f)));
}

export function runFixture(fx: Fixture): FixtureResult {
  const cases: CaseResult[] = fx.cases.map((c) => {
    const appID = c.appID ?? fx.appID;
    const expected = parseExpect(c.expect);
    const result = matchUniversalLink(fx.aasa, c.url, appID ? { appID } : {});
    return { url: c.url, appID, expected, actual: result.opens, pass: expected !== undefined && expected === result.opens, result, unverified: c.unverified === true, note: c.note };
  });
  return { name: fx.name, file: fx.file, pass: cases.every((c) => c.pass), cases };
}

export function runFixtureDir(dir: string): FixtureResult[] {
  return loadFixtureDir(dir).map(runFixture);
}
