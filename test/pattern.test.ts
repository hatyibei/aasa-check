import { test } from "node:test";
import assert from "node:assert/strict";
import { compilePattern, matchPattern, normalizePathPattern } from "../src/pattern.ts";
import { ISO_3166_ALPHA2, ISO_639_1, REGION_CODES, LANG_CODES } from "../src/variables.ts";

test("* matches zero or more characters, whole string", () => {
  assert.equal(matchPattern("/a/*", "/a/"), true);
  assert.equal(matchPattern("/a/*", "/a/b/c"), true);
  assert.equal(matchPattern("/a/*", "/a"), false);
  assert.equal(matchPattern("/a", "/a/b"), false, "does not match a substring");
  assert.equal(matchPattern("*", ""), true);
});

test("? is exactly one character, ?* is one or more", () => {
  assert.equal(matchPattern("??", "ab"), true);
  assert.equal(matchPattern("??", "a"), false);
  assert.equal(matchPattern("??", "abc"), false);
  assert.equal(matchPattern("x?*", "x"), false);
  assert.equal(matchPattern("x?*", "xy"), true);
  assert.equal(matchPattern("x?*", "xyz"), true);
});

test("regex metacharacters are literal", () => {
  assert.equal(matchPattern("/a.b", "/a.b"), true);
  assert.equal(matchPattern("/a.b", "/axb"), false);
  assert.equal(matchPattern("/(x)+[y]", "/(x)+[y]"), true);
  assert.equal(matchPattern("a|b", "a"), false);
});

test("built-in variables", () => {
  assert.equal(matchPattern("$(digit)", "7"), true);
  assert.equal(matchPattern("$(digit)", "a"), false);
  assert.equal(matchPattern("$(alpha)$(alpha)", "aZ"), true);
  assert.equal(matchPattern("$(upper)", "a"), false);
  assert.equal(matchPattern("$(lower)", "a"), true);
  assert.equal(matchPattern("$(alnum)", "_"), false);
  assert.equal(matchPattern("$(xdigit)$(xdigit)", "fA"), true);
  assert.equal(matchPattern("$(xdigit)", "g"), false);
  assert.equal(matchPattern("$(region)", "JP"), true);
  assert.equal(matchPattern("$(region)", "419"), true);
  assert.equal(matchPattern("$(region)", "XX"), false);
  assert.equal(matchPattern("$(region)", "jp"), false, "lowercase region codes fail when case-sensitive");
  assert.equal(matchPattern("$(region)", "jp", { caseSensitive: false }), true);
  assert.equal(matchPattern("$(lang)", "ja"), true);
  assert.equal(matchPattern("$(lang)", "zz"), false);
  assert.equal(matchPattern("$(lang)", "fil"), true);
  assert.equal(matchPattern("$(upper)", "a", { caseSensitive: false }), true);
});

test("size of the code sets", () => {
  assert.equal(ISO_3166_ALPHA2.length, 249);
  assert.equal(new Set(ISO_3166_ALPHA2).size, 249);
  assert.equal(ISO_639_1.length, 183);
  assert.equal(new Set(ISO_639_1).size, 183);
  assert.ok(!REGION_CODES.includes("XX") && !REGION_CODES.includes("ZZ"));
  assert.ok(!LANG_CODES.includes("zz"));
});

test("custom variables: ? and * in values work; $(...) in values is not expanded", () => {
  const vars = { v: ["a?c", "x*"], nest: ["$(digit)"] };
  assert.equal(matchPattern("/$(v)", "/abc", { substitutionVariables: vars }), true);
  assert.equal(matchPattern("/$(v)", "/xyz", { substitutionVariables: vars }), true);
  assert.equal(matchPattern("/$(v)", "/ab", { substitutionVariables: vars }), false);
  assert.equal(matchPattern("$(nest)", "1", { substitutionVariables: vars }), false);
  assert.equal(matchPattern("$(nest)", "$(digit)", { substitutionVariables: vars }), true);
});

test("variable names are case-sensitive; unknown variables never match", () => {
  const vars = { food: ["pizza"] };
  assert.equal(matchPattern("$(food)", "pizza", { substitutionVariables: vars }), true);
  assert.equal(matchPattern("$(Food)", "pizza", { substitutionVariables: vars }), false);
  assert.equal(matchPattern("$(Digit)", "1"), false);
  assert.equal(matchPattern("*$(nope)*", "anything"), false);
  assert.equal(compilePattern("$(nope)").regex, null);
});

test("an empty-array variable matches nothing", () => {
  assert.equal(matchPattern("$(e)", "", { substitutionVariables: { e: [] } }), false);
});

test("does not expand a cartesian product (stays fast with many variables)", () => {
  const pat = "/" + "$(lang)_$(region)/".repeat(8);
  const t0 = Date.now();
  assert.equal(matchPattern(pat, "/" + "en_US/".repeat(8)), true);
  assert.ok(Date.now() - t0 < 1000);
});

test("caseSensitive: false ignores case in literals, variable values, and the URL", () => {
  assert.equal(matchPattern("/A/$(f)", "/a/PIZZA", { caseSensitive: false, substitutionVariables: { f: ["pizza"] } }), true);
  assert.equal(matchPattern("/A/$(f)", "/a/PIZZA", { caseSensitive: true, substitutionVariables: { f: ["pizza"] } }), false);
});

test("leading-slash normalization", () => {
  assert.equal(normalizePathPattern("abc"), "/abc");
  assert.equal(normalizePathPattern("/abc"), "/abc");
  assert.equal(normalizePathPattern("*"), "*");
  assert.equal(normalizePathPattern("?bc"), "?bc");
  assert.equal(normalizePathPattern("$(lang)/x"), "$(lang)/x");
  assert.equal(normalizePathPattern("$x"), "/$x");
});
