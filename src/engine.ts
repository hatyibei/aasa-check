/**
 * Universal Links matching engine (pure functions).
 *
 * Follows Apple's public docs (WWDC20 "What's new in Universal Links", applinks.Details.Components,
 * substitutionVariables) and the query-dictionary behaviour described at WWDC.
 * Places marked "unverified guess" still need a check with swcutil or a device.
 */
import { matchPattern, normalizePathPattern, type SubstitutionVariables } from "./pattern.js";
import { parseQueryItems, safeDecode, splitUrl, type UrlParts } from "./url.js";
import type { AasaComponent, AasaDefaults, AasaDetail, AasaFile, MatchOptions, MatchResult } from "./types.js";

interface Ctx {
  defaults: AasaDefaults;
  vars: SubstitutionVariables | undefined;
  url: UrlParts;
}

/** appIDs of a details entry (including legacy appID). [] if neither is present = applies to all apps. */
export function detailAppIDs(detail: AasaDetail): string[] {
  const ids: string[] = [];
  if (Array.isArray(detail.appIDs)) ids.push(...detail.appIDs.filter((x): x is string => typeof x === "string"));
  if (typeof detail.appID === "string" && !ids.includes(detail.appID)) ids.push(detail.appID);
  return ids;
}

function hasAppIDKey(detail: AasaDetail): boolean {
  return detail.appIDs !== undefined || detail.appID !== undefined;
}

/**
 * appID filter. Only details that contain the given ID as an exact match are evaluated.
 * Details with neither appIDs nor appID are treated as applying to all apps, so they are still evaluated under the filter (unverified guess).
 */
function detailApplies(detail: AasaDetail, appID: string | undefined): boolean {
  if (appID === undefined) return true;
  if (!hasAppIDKey(detail)) return true;
  return detailAppIDs(detail).includes(appID);
}

function boolOr(v: unknown, fallback: boolean): boolean {
  return typeof v === "boolean" ? v : fallback;
}

function effectiveFlags(comp: { caseSensitive?: unknown; percentEncoded?: unknown } | undefined, ctx: Ctx) {
  const caseSensitive = boolOr(comp?.caseSensitive, boolOr(ctx.defaults.caseSensitive, true));
  const percentEncoded = boolOr(comp?.percentEncoded, boolOr(ctx.defaults.percentEncoded, true));
  return { caseSensitive, percentEncoded };
}

/** percentEncoded=true: leave encoded / false: decode first (unverified guess). */
function urlValue(raw: string, percentEncoded: boolean): string {
  return percentEncoded ? raw : safeDecode(raw);
}

/**
 * Strip every trailing `/`. Input that is only slashes (`/` or `//`) keeps `"/"`.
 */
export function stripTrailingSlashes(s: string): string {
  if (!s) return "/";
  let i = s.length;
  while (i > 1 && s.charAt(i - 1) === "/") i--;
  return s.slice(0, i);
}

/**
 * Collapse consecutive slashes to one, then strip all trailing `/`. The root stays `"/"`.
 * Confirmed with swcutil (macOS 26.6.2, third run): mid-path and leading `//` are also collapsed (undocumented).
 */
export function normalizePathSlashes(s: string): string {
  return stripTrailingSlashes((s || "/").replace(/\/+/g, "/"));
}

/**
 * Path matching. Consecutive slashes are collapsed anywhere; any number of trailing `/` is optional.
 * Observed (`sudo swcutil verify -d -j -u` on macOS 26.6.2; undocumented):
 *   Pattern `/buy` matches `/buy/` and `/buy//`
 *   Pattern `/buy/*` matches `/buy`
 *   Pattern `/$(food)/` matches `/pizza`
 *   exclude `/help/website/*` blocks `/help/website`
 *   Pattern `/a/b` matches `/a//b` and `/a//b/`
 *   Pattern `/buy` matches `//buy`
 *   Pattern `/p/????` matches `/p//1234`
 * The 71 bundled cases agreed with swcutil under this normalization.
 *
 * Implementation:
 *   - Normalize the pattern and URL path (collapse consecutive slashes, then strip trailing `/`) before matching
 *   - If the pattern ends with `/*`, also try it with the `/*` removed
 * Do not try appending `/` to the URL (`?` would consume that slash and `/p/????` would falsely match `/p/123`).
 */
function matchPath(pattern: unknown, ctx: Ctx, caseSensitive: boolean, percentEncoded: boolean): boolean {
  if (typeof pattern !== "string") return false;
  const pat = normalizePathSlashes(normalizePathPattern(pattern));
  const value = normalizePathSlashes(urlValue(ctx.url.rawPath, percentEncoded));
  const opts = { caseSensitive, substitutionVariables: ctx.vars, pathSlashCollapse: true };
  const patterns = [pat];
  if (pat.endsWith("/*") && pat.length > 2) patterns.push(normalizePathSlashes(pat.slice(0, -2)));
  return patterns.some((p) => matchPattern(p, value, opts));
}

function matchQuery(pattern: unknown, ctx: Ctx, caseSensitive: boolean, percentEncoded: boolean): boolean {
  const opts = { caseSensitive, substitutionVariables: ctx.vars };
  if (typeof pattern === "string") {
    return matchPattern(pattern, urlValue(ctx.url.rawQuery, percentEncoded), opts);
  }
  if (pattern === null || typeof pattern !== "object" || Array.isArray(pattern)) return false;
  // Dictionary form (WWDC20): for each key, every query item of that name must match the pattern.
  // Missing items and valueless items are treated as "". Items not in the dictionary are ignored.
  // Key case follows caseSensitive (unverified guess).
  const items = parseQueryItems(ctx.url.rawQuery, !percentEncoded);
  for (const [key, valuePattern] of Object.entries(pattern as Record<string, unknown>)) {
    if (typeof valuePattern !== "string") return false;
    const same = (n: string) => (caseSensitive ? n === key : n.toLowerCase() === key.toLowerCase());
    const values = items.filter((it) => same(it.name)).map((it) => it.value);
    if (values.length === 0) values.push("");
    for (const v of values) {
      if (!matchPattern(valuePattern, v, opts)) return false;
    }
  }
  return true;
}

function matchFragment(pattern: unknown, ctx: Ctx, caseSensitive: boolean, percentEncoded: boolean): boolean {
  if (typeof pattern !== "string") return false;
  return matchPattern(pattern, urlValue(ctx.url.rawFragment, percentEncoded), {
    caseSensitive,
    substitutionVariables: ctx.vars,
  });
}

/** Does a component match the URL? Omitted parts are ignored. */
export function componentMatches(comp: AasaComponent, ctx: Ctx): boolean {
  if (comp === null || typeof comp !== "object") return false;
  const { caseSensitive, percentEncoded } = effectiveFlags(comp, ctx);
  if (comp["/"] !== undefined && !matchPath(comp["/"], ctx, caseSensitive, percentEncoded)) return false;
  if (comp["?"] !== undefined && !matchQuery(comp["?"], ctx, caseSensitive, percentEncoded)) return false;
  if (comp["#"] !== undefined && !matchFragment(comp["#"], ctx, caseSensitive, percentEncoded)) return false;
  return true;
}

/** Parse one legacy paths entry. A leading `NOT ` means exclude. */
export function parseLegacyPath(entry: string): { exclude: boolean; pattern: string } {
  if (entry.startsWith("NOT ")) return { exclude: true, pattern: entry.slice(4) };
  return { exclude: false, pattern: entry };
}

export function matchUniversalLink(aasa: AasaFile, url: string, opts: MatchOptions = {}): MatchResult {
  let parts: UrlParts;
  try {
    parts = splitUrl(url);
  } catch {
    return { opens: false, appIDs: [], reason: `invalid URL: ${url}` };
  }
  const applinks = aasa?.applinks;
  if (!applinks || typeof applinks !== "object") {
    return { opens: false, appIDs: [], reason: "AASA has no applinks" };
  }
  const details = Array.isArray(applinks.details) ? applinks.details : [];
  const defaults: AasaDefaults =
    applinks.defaults && typeof applinks.defaults === "object" ? applinks.defaults : {};
  const vars =
    applinks.substitutionVariables && typeof applinks.substitutionVariables === "object"
      ? (applinks.substitutionVariables as SubstitutionVariables)
      : undefined;
  const ctx: Ctx = { defaults, vars, url: parts };

  let evaluated = 0;
  for (let di = 0; di < details.length; di++) {
    const detail = details[di];
    if (!detail || typeof detail !== "object") continue;
    if (!detailApplies(detail, opts.appID)) continue;
    evaluated++;
    const appIDs = detailAppIDs(detail);
    const appLabel = appIDs.length ? appIDs.join(", ") : "(all apps)";

    if (Array.isArray(detail.components)) {
      // On iOS 13+, paths is ignored when components is present
      for (let ci = 0; ci < detail.components.length; ci++) {
        const comp = detail.components[ci]!;
        if (!componentMatches(comp, ctx)) continue;
        const exclude = comp.exclude === true;
        return {
          opens: !exclude,
          appIDs: exclude ? [] : appIDs,
          reason: exclude
            ? `excluded by details[${di}].components[${ci}] (${appLabel})`
            : `matched details[${di}].components[${ci}] (${appLabel})`,
          matchedRule: { source: "components", index: ci, detailIndex: di, exclude, pattern: comp },
        };
      }
      continue;
    }

    if (Array.isArray(detail.paths)) {
      // Legacy: look at the path only. Query and fragment are ignored.
      // Also apply defaults caseSensitive / percentEncoded and substitution variables (unverified guess; needs a swcutil check)
      const { caseSensitive, percentEncoded } = effectiveFlags(undefined, ctx);
      for (let pi = 0; pi < detail.paths.length; pi++) {
        const entry = detail.paths[pi];
        if (typeof entry !== "string") continue;
        const { exclude, pattern } = parseLegacyPath(entry);
        if (!matchPath(pattern, ctx, caseSensitive, percentEncoded)) continue;
        return {
          opens: !exclude,
          appIDs: exclude ? [] : appIDs,
          reason: exclude
            ? `excluded by details[${di}].paths[${pi}] "${entry}" (${appLabel})`
            : `matched details[${di}].paths[${pi}] "${entry}" (${appLabel})`,
          matchedRule: { source: "paths", index: pi, detailIndex: di, exclude, pattern: entry },
        };
      }
    }
  }

  if (opts.appID !== undefined && evaluated === 0) {
    return { opens: false, appIDs: [], reason: `no details for appID ${opts.appID}` };
  }
  return { opens: false, appIDs: [], reason: "no component or path matched" };
}

/** Coerce an expect value to boolean. app/open/true = true, web/exclude/false = false. */
export function parseExpect(v: unknown): boolean | undefined {
  if (v === true || v === false) return v;
  if (typeof v !== "string") return undefined;
  const s = v.trim().toLowerCase();
  if (s === "app" || s === "open" || s === "true") return true;
  if (s === "web" || s === "exclude" || s === "false") return false;
  return undefined;
}
