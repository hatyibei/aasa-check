import { test } from "node:test";
import assert from "node:assert/strict";
import { validateAasa } from "../src/validate.ts";

test("fails without applinks", () => {
  const v = validateAasa({ webcredentials: {} });
  assert.equal(v.ok, false);
  assert.match(v.errors.join("\n"), /applinks/);
});

test("a valid file is OK", () => {
  const v = validateAasa({ applinks: { details: [{ appIDs: ["ABCD123456.com.example.app"], components: [{ "/": "/x" }] }] } });
  assert.equal(v.ok, true);
  assert.deepEqual(v.errors, []);
});

test("mixing components and paths is a warning", () => {
  const v = validateAasa({ applinks: { details: [{ appIDs: ["ABCD123456.com.example.app"], components: [], paths: ["*"] }] } });
  assert.equal(v.ok, true);
  assert.match(v.warnings.join("\n"), /mixes components and paths/);
});

test("type errors and unknown variables", () => {
  const v = validateAasa({
    applinks: {
      substitutionVariables: { "a$b": ["x"], ok: "notarray" },
      details: [{ appIDs: "nope", components: [{ "/": 1, exclude: "yes", "?": 3 }, { "/": "/$(unknown)" }] }],
    },
  });
  assert.equal(v.ok, false);
  const all = v.errors.join("\n");
  assert.match(all, /a\$b/);
  assert.match(all, /array of strings/);
  assert.match(all, /appIDs/);
  assert.match(all, /exclude/);
  assert.match(v.warnings.join("\n"), /\$\(unknown\)/);
});

test("details without appIDs warn that they apply to all apps", () => {
  const v = validateAasa({ applinks: { details: [{ components: [{}] }] } });
  assert.equal(v.ok, true);
  assert.match(v.warnings.join("\n"), /all apps/);
});
