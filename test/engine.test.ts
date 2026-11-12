import { test } from "node:test";
import assert from "node:assert/strict";
import { matchUniversalLink, parseExpect, stripTrailingSlashes, normalizePathSlashes } from "../src/engine.ts";
import type { AasaFile } from "../src/types.ts";

const A = "ABCD123456.com.example.app";
const B = "WXYZ987654.com.example.other";
const one = (components: unknown[], extra: Record<string, unknown> = {}): AasaFile =>
  ({ applinks: { ...extra, details: [{ appIDs: [A], components }] } }) as AasaFile;

test("returns matchedRule and appIDs", () => {
  const r = matchUniversalLink(one([{ "/": "/x" }, { "/": "/y/*" }]), "https://example.com/y/1");
  assert.equal(r.opens, true);
  assert.deepEqual(r.appIDs, [A]);
  assert.deepEqual(r.matchedRule, { source: "components", index: 1, detailIndex: 0, exclude: false, pattern: { "/": "/y/*" } });
});

test("exclude yields opens=false and matchedRule.exclude=true", () => {
  const r = matchUniversalLink(one([{ "/": "/x", exclude: true }]), "https://example.com/x");
  assert.equal(r.opens, false);
  assert.equal(r.matchedRule?.exclude, true);
});

test("matches nothing", () => {
  const r = matchUniversalLink(one([{ "/": "/x" }]), "https://example.com/y");
  assert.equal(r.opens, false);
  assert.equal(r.matchedRule, undefined);
});

test("first match wins across details", () => {
  const aasa: AasaFile = {
    applinks: {
      details: [
        { appIDs: [A], components: [{ "/": "/a/*", exclude: true }] },
        { appIDs: [B], components: [{ "/": "/a/*" }, { "/": "/b" }] },
      ],
    },
  };
  assert.equal(matchUniversalLink(aasa, "https://example.com/a/1").opens, false);
  const r = matchUniversalLink(aasa, "https://example.com/b");
  assert.equal(r.opens, true);
  assert.deepEqual(r.appIDs, [B]);
  assert.equal(r.matchedRule?.detailIndex, 1);
});

test("appID filter evaluates only exact-match details", () => {
  const aasa: AasaFile = {
    applinks: {
      details: [
        { appIDs: [A], components: [{ "/": "/a/*", exclude: true }] },
        { appIDs: [B], components: [{ "/": "/a/*" }] },
      ],
    },
  };
  assert.equal(matchUniversalLink(aasa, "https://example.com/a/1", { appID: B }).opens, true);
  assert.equal(matchUniversalLink(aasa, "https://example.com/a/1", { appID: A }).opens, false);
  const none = matchUniversalLink(aasa, "https://example.com/a/1", { appID: "ABCD123456.com.example" });
  assert.equal(none.opens, false);
  assert.match(none.reason, /no details for appID/);
});

test("reads legacy appID; details without an appID apply to all apps", () => {
  const legacy: AasaFile = { applinks: { details: [{ appID: A, paths: ["*"] }] } };
  assert.deepEqual(matchUniversalLink(legacy, "https://example.com/x", { appID: A }).appIDs, [A]);
  const all: AasaFile = { applinks: { details: [{ components: [{ "/": "*" }] }] } };
  assert.equal(matchUniversalLink(all, "https://example.com/x").opens, true);
  assert.equal(matchUniversalLink(all, "https://example.com/x", { appID: B }).opens, true);
});

test("legacy paths ignore query and fragment", () => {
  const aasa: AasaFile = { applinks: { details: [{ appIDs: [A], paths: ["/p/*", "NOT /q"] }] } };
  assert.equal(matchUniversalLink(aasa, "https://example.com/p/1?x=1#f").opens, true);
  const r = matchUniversalLink(aasa, "https://example.com/q?x=1");
  assert.equal(r.opens, false);
  assert.equal(r.matchedRule?.source, "paths");
  assert.equal(r.matchedRule?.exclude, true);
  // leading-slash normalization also applies to paths
  const ns: AasaFile = { applinks: { details: [{ appIDs: [A], paths: ["abc"] }] } };
  assert.equal(matchUniversalLink(ns, "https://example.com/abc").opens, true);
});

test("paths is ignored even when components is an empty array", () => {
  const aasa: AasaFile = { applinks: { details: [{ appIDs: [A], components: [], paths: ["*"] }] } };
  assert.equal(matchUniversalLink(aasa, "https://example.com/x").opens, false);
});

test("query string: missing query is the empty string", () => {
  assert.equal(matchUniversalLink(one([{ "?": "*" }]), "https://example.com/").opens, true);
  assert.equal(matchUniversalLink(one([{ "?": "?*" }]), "https://example.com/").opens, false);
  assert.equal(matchUniversalLink(one([{ "?": "a=1&b=2" }]), "https://example.com/?a=1&b=2").opens, true);
});

test("query dictionary: every item of that name must match; missing values are empty", () => {
  const aasa = one([{ "?": { id: "$(digit)*" } }]);
  assert.equal(matchUniversalLink(aasa, "https://example.com/?id=1&id=2").opens, true);
  assert.equal(matchUniversalLink(aasa, "https://example.com/?id=1&id=x").opens, false);
  const empty = one([{ "?": { flag: "" } }]);
  assert.equal(matchUniversalLink(empty, "https://example.com/?flag").opens, true);
  assert.equal(matchUniversalLink(empty, "https://example.com/?flag=").opens, true);
  assert.equal(matchUniversalLink(empty, "https://example.com/").opens, true);
  assert.equal(matchUniversalLink(empty, "https://example.com/?flag=1").opens, false);
});

test("query dictionary: key case follows caseSensitive (unverified guess)", () => {
  const cs = one([{ "?": { Id: "?*" } }]);
  assert.equal(matchUniversalLink(cs, "https://example.com/?id=1").opens, false);
  const ci = one([{ "?": { Id: "?*" }, caseSensitive: false }]);
  assert.equal(matchUniversalLink(ci, "https://example.com/?id=1").opens, true);
});

test("fragment: missing fragment is the empty string", () => {
  assert.equal(matchUniversalLink(one([{ "#": "" }]), "https://example.com/x").opens, true);
  assert.equal(matchUniversalLink(one([{ "#": "?*" }]), "https://example.com/x").opens, false);
  assert.equal(matchUniversalLink(one([{ "#": "sec-?" }]), "https://example.com/x#sec-1").opens, true);
});

test("percentEncoded: true uses the raw encoded form, false uses the decoded form (unverified guess)", () => {
  const url = "https://example.com/caf%C3%A9/a%20b";
  assert.equal(matchUniversalLink(one([{ "/": "/caf%C3%A9/*" }]), url).opens, true);
  assert.equal(matchUniversalLink(one([{ "/": "/café/*" }]), url).opens, false);
  assert.equal(matchUniversalLink(one([{ "/": "/café/a b", percentEncoded: false }]), url).opens, true);
  assert.equal(matchUniversalLink(one([{ "/": "/café/a b" }], { defaults: { percentEncoded: false } }), url).opens, true);
  // URLs with raw Unicode are also encoded via href
  assert.equal(matchUniversalLink(one([{ "/": "/caf%C3%A9" }]), "https://example.com/café").opens, true);
  // query-dictionary items are also decoded
  const q = one([{ "?": { q: "a b" }, percentEncoded: false }]);
  assert.equal(matchUniversalLink(q, "https://example.com/?q=a%20b").opens, true);
  assert.equal(matchUniversalLink(one([{ "?": { q: "a%20b" } }]), "https://example.com/?q=a%20b").opens, true);
});

test("a component caseSensitive overrides defaults", () => {
  const aasa = one([{ "/": "/A", caseSensitive: true }], { defaults: { caseSensitive: false } });
  assert.equal(matchUniversalLink(aasa, "https://example.com/a").opens, false);
});

test("an empty path is /", () => {
  assert.equal(matchUniversalLink(one([{ "/": "/" }]), "https://example.com").opens, true);
});

test("no applinks / invalid URL", () => {
  assert.equal(matchUniversalLink({} as AasaFile, "https://example.com/").opens, false);
  assert.match(matchUniversalLink(one([{}]), "not a url").reason, /invalid URL/);
});

test("parseExpect", () => {
  for (const v of ["app", "open", "true", true, "APP"]) assert.equal(parseExpect(v), true);
  for (const v of ["web", "exclude", "false", false]) assert.equal(parseExpect(v), false);
  assert.equal(parseExpect("maybe"), undefined);
});

test("a single trailing slash is optional (observed with swcutil, undocumented)", () => {
  const ID = "ABCD123456.com.example.app";
  const aasa = {
    applinks: {
      substitutionVariables: { food: ["pizza"] },
      details: [
        {
          appIDs: [ID],
          components: [
            { "/": "/help/website/*", exclude: true },
            { "/": "/buy" },
            { "/": "/food/$(food)/" },
            { "/": "/star/*" },
          ],
        },
      ],
    },
  };
  const hit = (url: string) => matchUniversalLink(aasa, url).opens;
  // observed
  assert.equal(hit("https://example.com/buy"), true);
  assert.equal(hit("https://example.com/buy/"), true);
  assert.equal(hit("https://example.com/star/"), true);
  assert.equal(hit("https://example.com/star"), true);
  assert.equal(hit("https://example.com/food/pizza/"), true);
  assert.equal(hit("https://example.com/food/pizza"), true);
  assert.equal(hit("https://example.com/help/website/x"), false);
  assert.equal(hit("https://example.com/help/website"), false); // exclude, not a later rule
  // 2nd/3rd swcutil run: collapse consecutive slashes, then strip all trailing
  assert.equal(hit("https://example.com/buy//"), true);
  assert.equal(hit("https://example.com/buy///"), true);
  assert.equal(hit("https://example.com//buy"), true);
  // still no match for extra segments
  assert.equal(hit("https://example.com/buy/x"), false);
});

test("stripTrailingSlashes strips only the end, leaving mid-path //", () => {
  assert.equal(stripTrailingSlashes("/buy"), "/buy");
  assert.equal(stripTrailingSlashes("/buy/"), "/buy");
  assert.equal(stripTrailingSlashes("/buy//"), "/buy");
  assert.equal(stripTrailingSlashes("/"), "/");
  assert.equal(stripTrailingSlashes("//"), "/");
  assert.equal(stripTrailingSlashes("/a//b"), "/a//b");
  assert.equal(stripTrailingSlashes("//buy"), "//buy");
});

test("normalizePathSlashes collapses consecutive slashes, then strips trailing ones", () => {
  assert.equal(normalizePathSlashes("/buy"), "/buy");
  assert.equal(normalizePathSlashes("/buy/"), "/buy");
  assert.equal(normalizePathSlashes("/buy//"), "/buy");
  assert.equal(normalizePathSlashes("/buy///"), "/buy");
  assert.equal(normalizePathSlashes("/"), "/");
  assert.equal(normalizePathSlashes("//"), "/");
  assert.equal(normalizePathSlashes("///"), "/");
  assert.equal(normalizePathSlashes("/a//b"), "/a/b");
  assert.equal(normalizePathSlashes("/a//b/"), "/a/b");
  assert.equal(normalizePathSlashes("//buy"), "/buy");
  assert.equal(normalizePathSlashes("/p//1234"), "/p/1234");
  assert.equal(normalizePathSlashes("/buy//"), "/buy");
});

