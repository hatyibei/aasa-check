import type { FetchLike } from "../../src/cdn.ts";

export type MockRoute =
  | { status: number; body?: string | object; headers?: Record<string, string> }
  | { throws: string };

/** Mock fetch driven by a URL → response table. Unregistered URLs are network errors. */
export function mockFetch(routes: Record<string, MockRoute>): FetchLike & { calls: string[] } {
  const calls: string[] = [];
  const fn = (async (url: string) => {
    calls.push(url);
    const r = routes[url];
    if (!r) throw new Error(`mock: no route for ${url}`);
    if ("throws" in r) throw new Error(r.throws);
    const body = r.body === undefined ? null : typeof r.body === "string" ? r.body : JSON.stringify(r.body);
    const headers = { "content-type": "application/json", ...(r.headers ?? {}) };
    return new Response(r.status >= 300 && r.status < 400 ? null : body, { status: r.status, headers });
  }) as FetchLike & { calls: string[] };
  fn.calls = calls;
  return fn;
}

export const WK = (d: string) => `https://${d}/.well-known/apple-app-site-association`;
export const ROOT = (d: string) => `https://${d}/apple-app-site-association`;
export const CDN = (d: string) => `https://app-site-association.cdn-apple.com/a/v1/${d}`;
