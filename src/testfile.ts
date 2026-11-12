/** Load a links.test.yml file. */
import { parse } from "yaml";
import { parseExpect } from "./engine.js";

export interface LinkTestCase {
  url: string;
  expect: boolean;
  /** Original spelling (app / web, etc.) */
  expectRaw: string;
}

export interface LinkTestFile {
  domain?: string;
  appID?: string;
  cases: LinkTestCase[];
}

export function parseLinkTestFile(text: string): LinkTestFile {
  const doc = parse(text) as unknown;
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) throw new Error("test file: top level must be a mapping");
  const d = doc as Record<string, unknown>;
  if (d.domain !== undefined && d.domain !== null && typeof d.domain !== "string") throw new Error("test file: domain must be a string");
  if (d.appID !== undefined && d.appID !== null && typeof d.appID !== "string") throw new Error("test file: appID must be a string");
  if (!Array.isArray(d.cases)) throw new Error("test file: cases must be a list");
  const cases = d.cases.map((c, i): LinkTestCase => {
    if (!c || typeof c !== "object") throw new Error(`test file: cases[${i}] must be a mapping`);
    const cc = c as Record<string, unknown>;
    if (typeof cc.url !== "string") throw new Error(`test file: cases[${i}].url must be a string`);
    const exp = parseExpect(cc.expect);
    if (exp === undefined) {
      throw new Error(`test file: cases[${i}].expect must be app|open|true or web|exclude|false (got ${JSON.stringify(cc.expect)})`);
    }
    return { url: cc.url, expect: exp, expectRaw: String(cc.expect) };
  });
  return {
    domain: typeof d.domain === "string" && d.domain ? d.domain : undefined,
    appID: typeof d.appID === "string" && d.appID ? d.appID : undefined,
    cases,
  };
}
