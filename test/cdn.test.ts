import { test } from "node:test";
import assert from "node:assert/strict";
import { canonicalJson, compareCdn, fetchSiteAasa, jsonDiffPaths } from "../src/cdn.ts";
import { CDN, ROOT, WK, mockFetch } from "./helpers/mock-fetch.ts";

const D = "example.com";
const aasa = { applinks: { details: [{ appIDs: ["ABCD123456.com.example.app"], components: [{ "/": "/x" }] }] } };
// Same content, different key order and whitespace
const aasaReordered = `{
  "applinks" : { "details" : [ { "components" : [ { "/" : "/x" } ], "appIDs" : [ "ABCD123456.com.example.app" ] } ] }
}`;

test("canonicalJson sorts object keys (array order is kept)", () => {
  assert.equal(canonicalJson({ b: 1, a: { d: 1, c: 2 } }), canonicalJson({ a: { c: 2, d: 1 }, b: 1 }));
  assert.notEqual(canonicalJson([1, 2]), canonicalJson([2, 1]));
});

test("match (key order and whitespace ignored)", async () => {
  const f = mockFetch({ [WK(D)]: { status: 200, body: aasa }, [CDN(D)]: { status: 200, body: aasaReordered } });
  const c = await compareCdn({ domain: D, fetchImpl: f });
  assert.equal(c.status, "match");
  assert.deepEqual(c.errors, []);
  assert.deepEqual(f.calls, [WK(D), CDN(D)]);
});

test("mismatch", async () => {
  const other = { applinks: { details: [{ appIDs: ["ABCD123456.com.example.app"], components: [{ "/": "/y" }] }] } };
  const f = mockFetch({ [WK(D)]: { status: 200, body: aasa }, [CDN(D)]: { status: 200, body: other } });
  const c = await compareCdn({ domain: D, fetchImpl: f });
  assert.equal(c.status, "mismatch");
  assert.deepEqual(c.diffPaths, ["$.applinks.details[0].components[0]./"]);
});

test("falls back to the root path if site .well-known is 404", async () => {
  const f = mockFetch({ [WK(D)]: { status: 404, body: "nf" }, [ROOT(D)]: { status: 200, body: aasa }, [CDN(D)]: { status: 200, body: aasa } });
  const c = await compareCdn({ domain: D, fetchImpl: f });
  assert.equal(c.status, "match");
  assert.equal(c.site?.doc.finalUrl, ROOT(D));
});

test("falls back to the root path if .well-known fails to connect", async () => {
  const f = mockFetch({ [WK(D)]: { throws: "ECONNRESET" }, [ROOT(D)]: { status: 200, body: aasa } });
  const s = await fetchSiteAasa(D, f);
  assert.equal(s.doc.ok, true);
  assert.equal(s.attempts.length, 2);
});

test("site fetch failure is an error", async () => {
  const f = mockFetch({ [WK(D)]: { status: 404 }, [ROOT(D)]: { status: 500 }, [CDN(D)]: { status: 200, body: aasa } });
  const c = await compareCdn({ domain: D, fetchImpl: f });
  assert.equal(c.status, "error");
  assert.equal(c.errors.length, 2);
});

test("CDN fetch failure is an error", async () => {
  const f = mockFetch({ [WK(D)]: { status: 200, body: aasa }, [CDN(D)]: { throws: "getaddrinfo ENOTFOUND" } });
  const c = await compareCdn({ domain: D, fetchImpl: f });
  assert.equal(c.status, "error");
  assert.match(c.errors.join(), /ENOTFOUND/);
});

test("non-JSON CDN body is an error", async () => {
  const f = mockFetch({ [WK(D)]: { status: 200, body: aasa }, [CDN(D)]: { status: 200, body: "<html>" } });
  const c = await compareCdn({ domain: D, fetchImpl: f });
  assert.equal(c.status, "error");
  assert.match(c.errors.join(), /invalid JSON/);
});

test("records redirects, compares the final body, and adds a note", async () => {
  const f = mockFetch({
    [WK(D)]: { status: 301, headers: { location: "https://www.example.com/.well-known/apple-app-site-association" } },
    ["https://www.example.com/.well-known/apple-app-site-association"]: { status: 200, body: aasa },
    [CDN(D)]: { status: 200, body: aasa },
  });
  const c = await compareCdn({ domain: D, fetchImpl: f });
  assert.equal(c.status, "match");
  assert.equal(c.site?.doc.redirects.length, 1);
  assert.equal(c.site?.doc.redirects[0]?.status, 301);
  assert.match(c.notes.join(), /does not follow redirects/);
});

test("redirect loops fail", async () => {
  const f = mockFetch({
    [WK(D)]: { status: 302, headers: { location: WK(D) } },
    [ROOT(D)]: { status: 302, headers: { location: ROOT(D) } },
    [CDN(D)]: { status: 200, body: aasa },
  });
  const c = await compareCdn({ domain: D, fetchImpl: f });
  assert.equal(c.status, "error");
  assert.match(c.errors.join(), /too many redirects/);
});

test("non-JSON Content-Type produces a note", async () => {
  const f = mockFetch({ [WK(D)]: { status: 200, body: aasa, headers: { "content-type": "text/plain" } }, [CDN(D)]: { status: 200, body: aasa } });
  const c = await compareCdn({ domain: D, fetchImpl: f });
  assert.equal(c.status, "match");
  assert.match(c.notes.join(), /Content-Type/);
});

test("localAasa compares to the CDN without fetching the site", async () => {
  const f = mockFetch({ [CDN(D)]: { status: 200, body: aasa } });
  const c = await compareCdn({ domain: D, fetchImpl: f, localAasa: JSON.parse(aasaReordered) });
  assert.equal(c.status, "match");
  assert.equal(c.sourceKind, "local");
  assert.deepEqual(f.calls, [CDN(D)]);
});

test("jsonDiffPaths", () => {
  assert.deepEqual(jsonDiffPaths({ a: 1, b: [1, 2] }, { a: 1, b: [1, 3], c: 0 }), ["$.b[1]", "$.c"]);
});
