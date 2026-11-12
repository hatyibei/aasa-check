/**
 * Compile the AASA pattern language (WWDC20 / applinks.Details.Components) to a regular expression.
 *
 * - Patterns match the whole string (^...$)
 * - `*` = zero or more characters (greedy), `?` = exactly one, `?*` = one or more
 * - `$(name)` = substitution variable. Values may contain `?` and `*`, but `$(...)` inside a value is not expanded
 * - A pattern that contains an unknown variable never matches
 * - Compiled to alternation / character classes; no cartesian expansion
 */
import { BUILTIN_VARIABLES, isBuiltinVariable } from "./variables.js";

export type SubstitutionVariables = Record<string, readonly string[]>;

export interface PatternOptions {
  caseSensitive?: boolean;
  substitutionVariables?: SubstitutionVariables;
  /**
   * For path matching. After collapsing consecutive slashes, a * between segments may be empty so /a/b still matches.
   * When the star is empty the slashes on both sides collapse into one (swcutil MATCHED /a//b/ against that pattern).
   */
  pathSlashCollapse?: boolean;
}

export interface CompiledPattern {
  /** null = cannot compile (unknown variable, etc.). Never matches. */
  regex: RegExp | null;
  error?: string;
}

const ANY_ONE = "[\\s\\S]";

function escapeRe(ch: string): string {
  return ch.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
}

/** Turn a variable value (wildcards only, no variable expansion) into a regex source. */
export function wildcardToRegexSource(value: string): string {
  let out = "";
  for (const ch of value) {
    if (ch === "*") out += `${ANY_ONE}*`;
    else if (ch === "?") out += ANY_ONE;
    else out += escapeRe(ch);
  }
  return out;
}

/** Is this a valid variable name (non-empty, no `$` `(` `)`)? */
export function isValidVariableName(name: string): boolean {
  return name.length > 0 && !/[$()]/.test(name);
}

/**
 * Variable name → regex source. null if unknown.
 * If a built-in and a custom variable share a name, the built-in wins (unverified guess; needs a swcutil check).
 */
export function resolveVariable(name: string, vars?: SubstitutionVariables): string | null {
  if (!isValidVariableName(name)) return null;
  if (isBuiltinVariable(name)) return BUILTIN_VARIABLES[name]!;
  if (vars && Object.prototype.hasOwnProperty.call(vars, name)) {
    const values = vars[name];
    if (!Array.isArray(values)) return null;
    const parts = values.filter((v): v is string => typeof v === "string").map(wildcardToRegexSource);
    if (parts.length === 0) return "(?!)"; // empty set = match nothing
    return parts.join("|");
  }
  return null;
}

/** List `$(name)` names in a pattern (used by validate). */
export function listVariableNames(pattern: string): string[] {
  const names: string[] = [];
  let i = 0;
  while (i < pattern.length) {
    if (pattern[i] === "$" && pattern[i + 1] === "(") {
      const end = pattern.indexOf(")", i + 2);
      if (end < 0) break;
      names.push(pattern.slice(i + 2, end));
      i = end + 1;
    } else i++;
  }
  return names;
}

/** Pattern → regex source (unanchored). null if it contains an unknown variable. */
export function patternToRegexSource(
  pattern: string,
  vars?: SubstitutionVariables,
  pathSlashCollapse = false,
): { source: string | null; error?: string } {
  let out = "";
  let i = 0;
  while (i < pattern.length) {
    const ch = pattern[i]!;
    if (ch === "$" && pattern[i + 1] === "(") {
      const end = pattern.indexOf(")", i + 2);
      if (end < 0) {
        // An unclosed `$(` is treated as a literal (unverified guess)
        out += escapeRe(pattern.slice(i));
        break;
      }
      const name = pattern.slice(i + 2, end);
      const src = resolveVariable(name, vars);
      if (src === null) return { source: null, error: `unknown substitution variable $(${name})` };
      out += `(?:${src})`;
      i = end + 1;
      continue;
    }
    if (
      ch === "*" &&
      pathSlashCollapse &&
      i > 0 &&
      pattern[i - 1] === "/" &&
      pattern[i + 1] === "/"
    ) {
      // `/ * /` matches both a collapsed `/` and `/…/`
      out += `(?:${ANY_ONE}*/)?`;
      i += 2; // skip * and the following /
      continue;
    }
    if (ch === "*") out += `${ANY_ONE}*`;
    else if (ch === "?") out += ANY_ONE;
    else out += escapeRe(ch);
    i++;
  }
  return { source: out };
}

const cache = new Map<string, CompiledPattern>();

export function compilePattern(pattern: string, opts: PatternOptions = {}): CompiledPattern {
  const caseSensitive = opts.caseSensitive ?? true;
  const vars = opts.substitutionVariables;
  const pathSlashCollapse = opts.pathSlashCollapse ?? false;
  const key = `${caseSensitive ? "s" : "i"}${pathSlashCollapse ? "c" : ""}\u0000${pattern}\u0000${vars ? JSON.stringify(vars) : ""}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const { source, error } = patternToRegexSource(pattern, vars, pathSlashCollapse);
  const compiled: CompiledPattern =
    source === null ? { regex: null, error } : { regex: new RegExp(`^(?:${source})$`, caseSensitive ? "" : "i") };
  if (cache.size > 5000) cache.clear();
  cache.set(key, compiled);
  return compiled;
}

export function matchPattern(pattern: string, value: string, opts: PatternOptions = {}): boolean {
  const { regex } = compilePattern(pattern, opts);
  return regex !== null && regex.test(value);
}

/**
 * Leading-slash normalization for path patterns.
 * If the pattern does not start with `/`, `*`, `?`, or `$(`, prepend `/` (`"abc"` → `"/abc"`).
 */
export function normalizePathPattern(pattern: string): string {
  if (pattern.startsWith("/") || pattern.startsWith("*") || pattern.startsWith("?") || pattern.startsWith("$(")) {
    return pattern;
  }
  return `/${pattern}`;
}
