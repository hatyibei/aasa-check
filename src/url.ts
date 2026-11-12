/** Split a URL into the parts used for AASA matching. */

export interface UrlParts {
  /** Path, still percent-encoded. An empty path is "/". */
  rawPath: string;
  /** Query without the leading `?` (or "" if none). */
  rawQuery: string;
  /** Fragment without the leading `#` (or "" if none). */
  rawFragment: string;
  hasQuery: boolean;
  hasFragment: boolean;
  host: string;
}

/** Return the original string if decodeURIComponent fails. */
export function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/**
 * Cut path, query, and fragment from `new URL(url).href` (normalized and encoded),
 * without relying on Node's URL.pathname.
 */
export function splitUrl(url: string): UrlParts {
  const u = new URL(url);
  const href = u.href;
  let rest = href.slice(u.protocol.length);
  if (rest.startsWith("//")) {
    rest = rest.slice(2);
    const idx = rest.search(/[/?#]/);
    rest = idx < 0 ? "" : rest.slice(idx);
  }
  let fragment = "";
  let hasFragment = false;
  const hashIdx = rest.indexOf("#");
  if (hashIdx >= 0) {
    fragment = rest.slice(hashIdx + 1);
    hasFragment = true;
    rest = rest.slice(0, hashIdx);
  }
  let query = "";
  let hasQuery = false;
  const qIdx = rest.indexOf("?");
  if (qIdx >= 0) {
    query = rest.slice(qIdx + 1);
    hasQuery = true;
    rest = rest.slice(0, qIdx);
  }
  const path = rest === "" ? "/" : rest.startsWith("/") ? rest : `/${rest}`;
  return { rawPath: path, rawQuery: query, rawFragment: fragment, hasQuery, hasFragment, host: u.hostname };
}

export interface QueryItem {
  name: string;
  value: string;
}

/**
 * Split a query string into items. A missing value (`foo` / `foo=`) is "".
 * When decode=true, percent-decode names and values (`+` is not treated as space; unverified guess).
 */
export function parseQueryItems(rawQuery: string, decode: boolean): QueryItem[] {
  if (rawQuery === "") return [];
  const items: QueryItem[] = [];
  for (const seg of rawQuery.split("&")) {
    if (seg === "") continue;
    const eq = seg.indexOf("=");
    const name = eq < 0 ? seg : seg.slice(0, eq);
    const value = eq < 0 ? "" : seg.slice(eq + 1);
    items.push(decode ? { name: safeDecode(name), value: safeDecode(value) } : { name, value });
  }
  return items;
}
