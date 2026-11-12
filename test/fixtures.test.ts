import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { loadFixtureDir, runFixture } from "../src/fixtures.ts";

const dir = fileURLToPath(new URL("../fixtures/unit/", import.meta.url));
const fixtures = loadFixtureDir(dir);

test("required spec fixtures are present", () => {
  const names = new Set(fixtures.map((f) => f.name));
  for (const n of [
    "exact-path", "wildcard-prefix", "single-char", "one-or-more", "exclude-order", "query-string",
    "query-dict", "fragment-exclude", "case-sensitive", "case-insensitive", "defaults-case", "subst-food",
    "subst-lang-region", "subst-digit", "legacy-paths", "components-win-over-paths", "no-slash-pattern",
    "empty-component", "first-match-wins-exclude-later",
  ]) assert.ok(names.has(n), `missing fixture ${n}`);
});

for (const fx of fixtures) {
  test(`fixture: ${fx.name}`, () => {
    const r = runFixture(fx);
    for (const c of r.cases) {
      assert.ok(
        c.pass,
        `${c.url}: expected ${c.expected ? "app" : "web"}, got ${c.actual ? "app" : "web"} (${c.result.reason})`,
      );
    }
  });
}
