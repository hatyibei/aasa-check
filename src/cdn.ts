/**
 * Fetch a site's AASA and Apple's CDN copy and compare them.
 * The HTTP client is injectable (mocked in tests).
 */

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export const CDN_BASE = "https://app-site-association.cdn-apple.com/a/v1/";

export interface Redirect {
  from: string;
  to: string;
  status: number;
}

export interface FetchedDoc {
  ok: boolean;
  /** URL originally requested */
  requestedUrl: string;
  /** URL the body was taken from */
  finalUrl: string;
  status?: number;
  contentType?: string;
  redirects: Redirect[];
  body?: string;
  json?: unknown;
  error?: string;
}

const MAX_REDIRECTS = 5;
const TIMEOUT_MS = 15000;

/** Follow redirects manually and record them. */
export async function fetchFollow(url: string, fetchImpl: FetchLike): Promise<FetchedDoc> {
  const redirects: Redirect[] = [];
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    let res: Response;
    try {
      res = await fetchImpl(current, {
        redirect: "manual",
        headers: { accept: "application/json, */*" },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (e) {
      return { ok: false, requestedUrl: url, finalUrl: current, redirects, error: `request failed: ${(e as Error).message}` };
    }
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) {
        return { ok: false, requestedUrl: url, finalUrl: current, status: res.status, redirects, error: `redirect ${res.status} without Location` };
      }
      const next = new URL(loc, current).href;
      redirects.push({ from: current, to: next, status: res.status });
      current = next;
      continue;
    }
    const contentType = res.headers.get("content-type") ?? undefined;
    let body: string;
    try {
      body = await res.text();
    } catch (e) {
      return { ok: false, requestedUrl: url, finalUrl: current, status: res.status, contentType, redirects, error: `body read failed: ${(e as Error).message}` };
    }
    if (res.status < 200 || res.status >= 300) {
      return { ok: false, requestedUrl: url, finalUrl: current, status: res.status, contentType, redirects, body, error: `HTTP ${res.status}` };
    }
    let json: unknown;
    try {
      json = JSON.parse(body);
    } catch (e) {
      return { ok: false, requestedUrl: url, finalUrl: current, status: res.status, contentType, redirects, body, error: `invalid JSON: ${(e as Error).message}` };
    }
    return { ok: true, requestedUrl: url, finalUrl: current, status: res.status, contentType, redirects, body, json };
  }
  return { ok: false, requestedUrl: url, finalUrl: current, redirects, error: `too many redirects (> ${MAX_REDIRECTS})` };
}

export interface SiteFetch {
  doc: FetchedDoc;
  attempts: FetchedDoc[];
  notes: string[];
}

/** Site AASA. Try /.well-known/ first; on 404 or failure, fall back to /apple-app-site-association. */
export async function fetchSiteAasa(domain: string, fetchImpl: FetchLike): Promise<SiteFetch> {
  const urls = [
    `https://${domain}/.well-known/apple-app-site-association`,
    `https://${domain}/apple-app-site-association`,
  ];
  const attempts: FetchedDoc[] = [];
  const notes: string[] = [];
  for (const u of urls) {
    const doc = await fetchFollow(u, fetchImpl);
    attempts.push(doc);
    if (doc.ok) {
      notes.push(...docNotes(doc, "site"));
      return { doc, attempts, notes };
    }
  }
  return { doc: attempts[attempts.length - 1]!, attempts, notes };
}

export async function fetchCdnAasa(domain: string, fetchImpl: FetchLike): Promise<FetchedDoc> {
  return fetchFollow(`${CDN_BASE}${domain}`, fetchImpl);
}

function docNotes(doc: FetchedDoc, label: string): string[] {
  const notes: string[] = [];
  if (doc.redirects.length > 0) {
    notes.push(
      `${label}: redirect(s) followed (${doc.redirects.map((r) => `${r.status} ${r.from} -> ${r.to}`).join(", ")}). ` +
        "Apple's CDN does not follow redirects. Comparison used the final body",
    );
  }
  if (doc.contentType && !/json/i.test(doc.contentType)) {
    notes.push(`${label}: Content-Type is ${doc.contentType} (application/json recommended)`);
  }
  return notes;
}

/** JSON with object keys sorted (whitespace differences are ignored). */
export function canonicalJson(v: unknown): string {
  return JSON.stringify(sortKeys(v));
}

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v !== null && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as object).sort()) out[k] = sortKeys((v as Record<string, unknown>)[k]);
    return out;
  }
  return v;
}

/** List JSON paths that differ, up to `limit` entries. */
export function jsonDiffPaths(a: unknown, b: unknown, limit = 20, path = "$"): string[] {
  const out: string[] = [];
  const walk = (x: unknown, y: unknown, p: string) => {
    if (out.length >= limit) return;
    if (canonicalJson(x) === canonicalJson(y)) return;
    const xo = x !== null && typeof x === "object";
    const yo = y !== null && typeof y === "object";
    if (Array.isArray(x) && Array.isArray(y)) {
      const n = Math.max(x.length, y.length);
      for (let i = 0; i < n; i++) walk(x[i], y[i], `${p}[${i}]`);
      return;
    }
    if (xo && yo && !Array.isArray(x) && !Array.isArray(y)) {
      const keys = new Set([...Object.keys(x as object), ...Object.keys(y as object)]);
      for (const k of [...keys].sort()) {
        walk((x as Record<string, unknown>)[k], (y as Record<string, unknown>)[k], `${p}.${k}`);
      }
      return;
    }
    out.push(p);
  };
  walk(a, b, path);
  return out;
}

export type CdnStatus = "match" | "mismatch" | "error";

export interface CdnComparison {
  status: CdnStatus;
  domain: string;
  /** Comparison source: "site" = fetched from the domain / "local" = --aasa file */
  sourceKind: "site" | "local";
  site?: SiteFetch;
  cdn?: FetchedDoc;
  notes: string[];
  errors: string[];
  diffPaths: string[];
}

export interface CompareOptions {
  domain: string;
  fetchImpl: FetchLike;
  /** When set, compare this JSON to the CDN instead of fetching the site. */
  localAasa?: unknown;
  /** Reuse an already-fetched site result. */
  site?: SiteFetch;
}

export async function compareCdn(opts: CompareOptions): Promise<CdnComparison> {
  const { domain, fetchImpl } = opts;
  const notes: string[] = [];
  const errors: string[] = [];
  let left: unknown;
  let site: SiteFetch | undefined;
  const sourceKind = opts.localAasa !== undefined ? "local" : "site";

  if (opts.localAasa !== undefined) {
    left = opts.localAasa;
  } else {
    site = opts.site ?? (await fetchSiteAasa(domain, fetchImpl));
    if (!site.doc.ok) {
      for (const a of site.attempts) errors.push(`site: ${a.requestedUrl}: ${a.error}`);
    } else {
      left = site.doc.json;
      notes.push(...site.notes);
    }
  }

  const cdn = await fetchCdnAasa(domain, fetchImpl);
  if (!cdn.ok) errors.push(`cdn: ${cdn.requestedUrl}: ${cdn.error}`);
  else notes.push(...docNotes(cdn, "cdn"));

  if (errors.length > 0) {
    return { status: "error", domain, sourceKind, site, cdn, notes, errors, diffPaths: [] };
  }
  const same = canonicalJson(left) === canonicalJson(cdn.json);
  return {
    status: same ? "match" : "mismatch",
    domain,
    sourceKind,
    site,
    cdn,
    notes,
    errors,
    diffPaths: same ? [] : jsonDiffPaths(left, cdn.json),
  };
}
