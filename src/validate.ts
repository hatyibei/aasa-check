/** Structural checks for an AASA file. errors fail the check; warnings are informational. */
import { isValidVariableName, listVariableNames, resolveVariable, type SubstitutionVariables } from "./pattern.js";
import { isBuiltinVariable } from "./variables.js";

export interface ValidationResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

const COMPONENT_KEYS = new Set(["/", "?", "#", "exclude", "comment", "caseSensitive", "percentEncoded"]);
const APP_ID_RE = /^[A-Z0-9]{10}\.[A-Za-z0-9.\-*]+$/;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

export function validateAasa(input: unknown): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const done = (): ValidationResult => ({ ok: errors.length === 0, errors, warnings });

  if (!isPlainObject(input)) {
    errors.push("top-level value is not a JSON object");
    return done();
  }
  const applinks = input.applinks;
  if (applinks === undefined) {
    errors.push("missing top-level `applinks`");
    return done();
  }
  if (!isPlainObject(applinks)) {
    errors.push("`applinks` is not an object");
    return done();
  }

  if (applinks.apps !== undefined) {
    if (!Array.isArray(applinks.apps)) errors.push("`applinks.apps` is not an array");
    else if (applinks.apps.length > 0) warnings.push("`applinks.apps` is conventionally an empty array (unnecessary on iOS 13+)");
  }

  // defaults
  if (applinks.defaults !== undefined) {
    if (!isPlainObject(applinks.defaults)) errors.push("`applinks.defaults` is not an object");
    else {
      for (const [k, v] of Object.entries(applinks.defaults)) {
        if (k === "caseSensitive" || k === "percentEncoded") {
          if (typeof v !== "boolean") errors.push(`\`applinks.defaults.${k}\` is not a boolean`);
        } else warnings.push(`\`applinks.defaults.${k}\` is an unknown key`);
      }
    }
  }

  // substitutionVariables
  let vars: SubstitutionVariables | undefined;
  if (applinks.substitutionVariables !== undefined) {
    const sv = applinks.substitutionVariables;
    if (!isPlainObject(sv)) errors.push("`applinks.substitutionVariables` is not an object");
    else {
      vars = {};
      for (const [name, values] of Object.entries(sv)) {
        if (!isValidVariableName(name)) errors.push(`substitution variable name "${name}" must be non-empty and must not contain \`$\`, \`(\`, or \`)\``);
        if (isBuiltinVariable(name)) warnings.push(`substitution variable "${name}" has the same name as a built-in (built-ins are assumed to win; unverified)`);
        if (!Array.isArray(values) || !values.every((x) => typeof x === "string")) {
          errors.push(`substitution variable "${name}" is not an array of strings`);
          continue;
        }
        if (values.length === 0) warnings.push(`substitution variable "${name}" is an empty array (matches nothing)`);
        for (const v of values) {
          if (v.includes("$(")) warnings.push(`$(...) inside substitution variable "${name}" value "${v}" is not expanded`);
        }
        vars[name] = values as string[];
      }
    }
  }

  const checkPattern = (where: string, pattern: string) => {
    for (const name of listVariableNames(pattern)) {
      if (resolveVariable(name, vars) === null) {
        warnings.push(`${where}: unknown substitution variable $(${name}); this pattern will never match`);
      }
    }
  };

  const details = applinks.details;
  if (details === undefined) {
    errors.push("missing `applinks.details`");
    return done();
  }
  if (!Array.isArray(details)) {
    errors.push("`applinks.details` is not an array");
    return done();
  }
  if (details.length === 0) warnings.push("`applinks.details` is empty (nothing will open)");

  details.forEach((d, di) => {
    const at = `details[${di}]`;
    if (!isPlainObject(d)) {
      errors.push(`${at} is not an object`);
      return;
    }
    // appIDs / appID
    if (d.appIDs !== undefined) {
      if (!Array.isArray(d.appIDs) || !d.appIDs.every((x) => typeof x === "string")) {
        errors.push(`${at}.appIDs is not an array of strings`);
      } else {
        for (const id of d.appIDs as string[]) {
          if (!APP_ID_RE.test(id)) warnings.push(`${at}.appIDs: "${id}" does not look like TEAMID.bundle.id`);
        }
      }
    }
    if (d.appID !== undefined) {
      if (typeof d.appID !== "string") errors.push(`${at}.appID is not a string`);
      else if (!APP_ID_RE.test(d.appID)) warnings.push(`${at}.appID: "${d.appID}" does not look like TEAMID.bundle.id`);
    }
    if (d.appIDs !== undefined && d.appID !== undefined) warnings.push(`${at} has both appIDs and legacy appID`);
    if (d.appIDs === undefined && d.appID === undefined) {
      warnings.push(`${at} has no appIDs / appID; treated as applying to all apps`);
    }

    const hasComponents = d.components !== undefined;
    const hasPaths = d.paths !== undefined;
    if (hasComponents && hasPaths) {
      warnings.push(`${at} mixes components and paths; on iOS 13+ only components is used and paths is ignored`);
    }
    if (!hasComponents && !hasPaths) warnings.push(`${at} has neither components nor paths (nothing will open)`);

    if (hasComponents) {
      if (!Array.isArray(d.components)) errors.push(`${at}.components is not an array`);
      else {
        d.components.forEach((c, ci) => {
          const cat = `${at}.components[${ci}]`;
          if (!isPlainObject(c)) {
            errors.push(`${cat} is not an object`);
            return;
          }
          for (const k of Object.keys(c)) if (!COMPONENT_KEYS.has(k)) warnings.push(`${cat}: unknown key "${k}"`);
          for (const k of ["/", "#", "comment"] as const) {
            if (c[k] !== undefined && typeof c[k] !== "string") errors.push(`${cat}["${k}"] is not a string`);
          }
          for (const k of ["exclude", "caseSensitive", "percentEncoded"] as const) {
            if (c[k] !== undefined && typeof c[k] !== "boolean") errors.push(`${cat}.${k} is not a boolean`);
          }
          const q = c["?"];
          if (q !== undefined) {
            if (typeof q === "string") checkPattern(`${cat}["?"]`, q);
            else if (isPlainObject(q)) {
              for (const [qk, qv] of Object.entries(q)) {
                if (typeof qv !== "string") errors.push(`${cat}["?"]["${qk}"] is not a string`);
                else checkPattern(`${cat}["?"]["${qk}"]`, qv);
              }
            } else errors.push(`${cat}["?"] should be a string or a dictionary`);
          }
          if (typeof c["/"] === "string") checkPattern(`${cat}["/"]`, c["/"]);
          if (typeof c["#"] === "string") checkPattern(`${cat}["#"]`, c["#"]);
        });
      }
    }
    if (hasPaths) {
      if (!Array.isArray(d.paths)) errors.push(`${at}.paths is not an array`);
      else {
        d.paths.forEach((p, pi) => {
          if (typeof p !== "string") errors.push(`${at}.paths[${pi}] is not a string`);
          else if (!hasComponents) checkPattern(`${at}.paths[${pi}]`, p.startsWith("NOT ") ? p.slice(4) : p);
        });
      }
    }
  });

  return done();
}
