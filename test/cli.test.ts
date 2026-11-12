import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { run, type Io } from "../src/main.ts";
import type { FetchLike } from "../src/cdn.ts";
import { CDN, WK, mockFetch } from "./helpers/mock-fetch.ts";

const ROOT_DIR = fileURLToPath(new URL("..", import.meta.url));
const tmp = mkdtempSync(join(tmpdir(), "aasa-check-test-"));
const D = "example.com";
const ID = "ABCD123456.com.example.app";
const aasa = {
  applinks: {
    details: [{ appIDs: [ID], components: [{ "/": "/help/website/*", exclude: true }, { "/": "/buy/*" }, { "/": "/help/*" }] }],
  },
};
const aasaChanged = { applinks: { details: [{ appIDs: [ID], components: [{ "/": "/buy/*" }] }] } };
writeFileSync(join(tmp, "aasa.json"), JSON.stringify(aasa));
writeFileSync(join(tmp, "bad.json"), JSON.stringify({ nope: 1 }));
writeFileSync(
  join(tmp, "ok.yml"),
  `domain: ${D}\nappID: ${ID}\ncases:\n  - url: https://${D}/buy/123\n    expect: app\n  - url: https://${D}/help/website/x\n    expect: web\n  - url: https://${D}/other\n    expect: false\n`,
);
writeFileSync(
  join(tmp, "fail.yml"),
  `domain: ${D}\ncases:\n  - url: https://${D}/help/website/x\n    expect: app\n  - url: https://${D}/buy/1\n    expect: open\n`,
);
writeFileSync(join(tmp, "nodomain.yml"), `cases:\n  - url: https://${D}/buy/1\n    expect: app\n`);

function io(fetchImpl: FetchLike = mockFetch({})) {
  let out = "";
  let err = "";
  const i: Io = { stdout: (s) => (out += s), stderr: (s) => (err += s), fetch: fetchImpl, cwd: tmp };
  return { i, out: () => out, err: () => err };
}
const same = () => mockFetch({ [WK(D)]: { status: 200, body: aasa }, [CDN(D)]: { status: 200, body: aasa } });
const differ = () => mockFetch({ [WK(D)]: { status: 200, body: aasa }, [CDN(D)]: { status: 200, body: aasaChanged } });
const cdnDown = () => mockFetch({ [WK(D)]: { status: 200, body: aasa }, [CDN(D)]: { throws: "offline" } });

test("check: matching OK + CDN match → 0", async () => {
  const x = io(same());
  assert.equal(await run(["check", "--test-file", "ok.yml"], x.i), 0);
  assert.match(x.out(), /Matching: 3\/3 passed/);
  assert.match(x.out(), /CDN comparison.*match/);
});

test("check: match using the AASA fetched from the site (no --aasa)", async () => {
  const f = same();
  const x = io(f);
  assert.equal(await run(["check", "--test-file", "ok.yml"], x.i), 0);
  // Fetch the site once and reuse it for the CDN comparison
  assert.deepEqual(f.calls, [WK(D), CDN(D)]);
});

test("check: match failure → 1, failed case shows expected, actual, rule, exclude", async () => {
  const x = io(same());
  assert.equal(await run(["check", "--test-file", "fail.yml", "--aasa", "aasa.json"], x.i), 1);
  assert.match(x.out(), /FAIL https:\/\/example\.com\/help\/website\/x/);
  assert.match(x.out(), /Expected: app \/ actual: web/);
  assert.match(x.out(), /components\[0\]/);
  assert.match(x.out(), /exclude: yes/);
});

test("check: CDN mismatch only → 2", async () => {
  const x = io(differ());
  assert.equal(await run(["check", "--test-file", "ok.yml", "--aasa", "aasa.json"], x.i), 2);
  assert.match(x.out(), /mismatch/);
});

test("check: match failure + CDN mismatch → 1 (match takes priority)", async () => {
  const x = io(differ());
  assert.equal(await run(["check", "--test-file", "fail.yml"], x.i), 1);
});

test("check: CDN fetch failure → 1", async () => {
  const x = io(cdnDown());
  assert.equal(await run(["check", "--test-file", "ok.yml"], x.i), 1);
});

test("check: site fetch failure and no --aasa → 1", async () => {
  const x = io(mockFetch({}));
  assert.equal(await run(["check", "--test-file", "ok.yml", "--no-cdn"], x.i), 1);
});

test("check: --no-cdn does not touch the network", async () => {
  const f = mockFetch({});
  const x = io(f);
  assert.equal(await run(["check", "--test-file", "ok.yml", "--aasa", "aasa.json", "--no-cdn"], x.i), 0);
  assert.deepEqual(f.calls, []);
});

test("check: no CDN comparison without a domain", async () => {
  const f = mockFetch({});
  const x = io(f);
  assert.equal(await run(["check", "--test-file", "nodomain.yml", "--aasa", "aasa.json"], x.i), 0);
  assert.deepEqual(f.calls, []);
});

test("check: --domain is used when the file has no domain", async () => {
  const x = io(differ());
  assert.equal(await run(["check", "--test-file", "nodomain.yml", "--aasa", "aasa.json", "--domain", D], x.i), 2);
});

test("check --json", async () => {
  const x = io(differ());
  assert.equal(await run(["check", "--test-file", "fail.yml", "--aasa", "aasa.json", "--json"], x.i), 1);
  const j = JSON.parse(x.out());
  assert.equal(j.exitCode, 1);
  assert.equal(j.failed, 1);
  assert.equal(j.cdn.status, "mismatch");
  const failed = j.cases.find((c: { pass: boolean }) => !c.pass);
  assert.equal(failed.expected, "app");
  assert.equal(failed.actual, "web");
  assert.equal(failed.exclude, true);
  assert.equal(failed.matchedRule.index, 0);
});

test("compare-cdn: 0 / 2 / 1", async () => {
  assert.equal(await run(["compare-cdn", "--domain", D], io(same()).i), 0);
  assert.equal(await run(["compare-cdn", "--domain", D], io(differ()).i), 2);
  assert.equal(await run(["compare-cdn", "--domain", D], io(cdnDown()).i), 1);
  const f = mockFetch({ [CDN(D)]: { status: 200, body: aasa } });
  assert.equal(await run(["compare-cdn", "--domain", D, "--aasa", "aasa.json"], io(f).i), 0);
  assert.deepEqual(f.calls, [CDN(D)]);
});

test("match: --expect controls the exit code", async () => {
  const x = io();
  assert.equal(await run(["match", "--aasa", "aasa.json", "--url", `https://${D}/buy/1`], x.i), 0);
  assert.match(x.out(), /Result: app/);
  assert.equal(await run(["match", "--aasa", "aasa.json", "--url", `https://${D}/buy/1`, "--expect", "web"], io().i), 1);
  assert.equal(await run(["match", "--aasa", "aasa.json", "--url", `https://${D}/x`, "--expect", "web", "--app-id", ID], io().i), 0);
});

test("validate: 0 / 1", async () => {
  assert.equal(await run(["validate", "--aasa", "aasa.json"], io().i), 0);
  assert.equal(await run(["validate", "--aasa", "bad.json"], io().i), 1);
});

test("usage errors → 1", async () => {
  assert.equal(await run(["bogus"], io().i), 1);
  assert.equal(await run(["match", "--aasa"], io().i), 1);
  assert.equal(await run(["match", "--url", "x"], io().i), 1);
  assert.equal(await run(["--help"], io().i), 0);
});

// Real-process exit codes (commands that need no network)
function spawnCli(args: string[], entry = ["--import", "tsx", "src/cli.ts"]) {
  return spawnSync(process.execPath, [...entry, ...args], { cwd: ROOT_DIR, encoding: "utf8" });
}

test("process: all fixtures → 0", () => {
  const r = spawnCli(["fixtures", "--dir", "fixtures/unit"]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /Fixtures: 21/);
});

test("process: match / check --no-cdn exit 0 and 1", () => {
  assert.equal(spawnCli(["match", "--aasa", join(tmp, "aasa.json"), "--url", `https://${D}/buy/1`, "--expect", "app"]).status, 0);
  assert.equal(spawnCli(["match", "--aasa", join(tmp, "aasa.json"), "--url", `https://${D}/nope`, "--expect", "app"]).status, 1);
  assert.equal(spawnCli(["check", "--test-file", join(tmp, "ok.yml"), "--aasa", join(tmp, "aasa.json"), "--no-cdn"]).status, 0);
  assert.equal(spawnCli(["check", "--test-file", join(tmp, "fail.yml"), "--aasa", join(tmp, "aasa.json"), "--no-cdn"]).status, 1);
});

test("process: can be launched from dist/cli.cjs", () => {
  const r = spawnCli(["validate", "--aasa", join(tmp, "aasa.json")], ["dist/cli.cjs"]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

test("process: run links.example.yml with --no-cdn", () => {
  const r = spawnCli(["check", "--test-file", "links.example.yml", "--aasa", "examples/apple-app-site-association.json", "--no-cdn"]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
});
