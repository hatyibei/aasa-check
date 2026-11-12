/** Loose types for an AASA (apple-app-site-association) file. Input is untrusted. */

export type QueryPattern = string | Record<string, string>;

export interface AasaComponent {
  "/"?: string;
  "?"?: QueryPattern;
  "#"?: string;
  exclude?: boolean;
  comment?: string;
  caseSensitive?: boolean;
  percentEncoded?: boolean;
  [key: string]: unknown;
}

export interface AasaDetail {
  appIDs?: string[];
  /** Legacy form */
  appID?: string;
  components?: AasaComponent[];
  /** Legacy form */
  paths?: string[];
  [key: string]: unknown;
}

export interface AasaDefaults {
  caseSensitive?: boolean;
  percentEncoded?: boolean;
}

export interface AasaApplinks {
  apps?: string[];
  details?: AasaDetail[];
  defaults?: AasaDefaults;
  substitutionVariables?: Record<string, string[]>;
  [key: string]: unknown;
}

export interface AasaFile {
  applinks?: AasaApplinks;
  [key: string]: unknown;
}

export interface MatchedRule {
  source: "components" | "paths";
  /** Index in the components / paths array */
  index: number;
  /** Index in the applinks.details array */
  detailIndex: number;
  exclude: boolean;
  pattern: unknown;
}

export interface MatchResult {
  opens: boolean;
  appIDs: string[];
  reason: string;
  matchedRule?: MatchedRule;
}

export interface MatchOptions {
  appID?: string;
}
