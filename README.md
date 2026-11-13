# aasa-check

> [!NOTE]
> Licensed under Apache-2.0. Distributed through GitHub (Action and CLI); not published on npm.

[日本語版 README はこちら / Japanese README](README.ja.md)

Check iOS Universal Links in CI: match URLs against your `apple-app-site-association` (AASA) file, validate its structure, and compare your site's AASA with the copy Apple's CDN is serving.

`aasa-check` is a TypeScript CLI plus a composite GitHub Action.

## Why

Universal Links tend to break quietly. A rule order change, an `exclude` placed below a broader wildcard, a trailing slash, or a stale CDN copy can all send users to Safari instead of your app, and you usually find out from a bug report.

Apple's own checker, `swcutil verify`, only runs on a Mac and needs root, so it doesn't fit into a normal Linux CI job. What CI needs is:

- a matcher that scores a list of URLs and fails the build when a URL lands on the wrong side, and
- a check that the AASA on your site is the same as the one Apple's CDN hands out to devices.

`aasa-check` does both, and ships the fixtures and script used to compare its engine against `swcutil verify` on a Mac.

## What it does

1. **Compare site vs. Apple CDN.** Fetches
   - `https://<domain>/.well-known/apple-app-site-association`, falling back to `https://<domain>/apple-app-site-association`
   - `https://app-site-association.cdn-apple.com/a/v1/<domain>`

   and compares them. Redirects are recorded (Apple's CDN does not follow redirects, so a redirect on your site is worth knowing about). The comparison uses the final response body with JSON object key order normalized and whitespace ignored; array order is significant.
2. **Match URLs** against `applinks` `components` (modern) or `paths` (legacy) and report which rule decided the result.
3. **Validate** the structure of an AASA file.
4. **Run bundled fixtures** for the matching engine, plus `collect-ground-truth.sh` to re-check those fixtures against `swcutil verify` on a Mac.

JSON AASA only. The old signed (PKCS#7) format is out of scope.

## Quick start

### GitHub Action

```yaml
- uses: hatyibei/aasa-check@v1
  with:
    test-file: links.test.yml
    aasa-file: public/.well-known/apple-app-site-association
```

Inputs:

| Input | Default | Description |
|---|---|---|
| `domain` | `""` | Domain to check. Optional; `domain` in the test file takes precedence. |
| `test-file` | `links.test.yml` | Path to the test file, relative to the workspace. |
| `aasa-file` | `""` | Local AASA JSON. If omitted, the AASA is fetched from the domain. |
| `no-cdn` | `false` | Set to `true` to skip the Apple CDN comparison. |

Output:

| Output | Description |
|---|---|
| `exit-code` | `0`, `1`, or `2` (see [Exit codes](#exit-codes)). |

On exit code `2` (CDN mismatch) the action prints a `::warning::` and the step still fails. If you want CDN lag to be a warning only, use `continue-on-error: true` on the step and inspect `steps.<id>.outputs.exit-code`:

```yaml
- id: aasa
  uses: hatyibei/aasa-check@v1
  continue-on-error: true
  with:
    domain: example.com
    test-file: links.test.yml
    aasa-file: public/.well-known/apple-app-site-association
- if: steps.aasa.outputs.exit-code == '1'
  run: exit 1
```

The action runs a prebuilt bundle (`dist/index.cjs`) on Node 24. Callers do not need to install dependencies or compile TypeScript.

### CLI

Requires Node.js 20 or later. The package is not on npm; run it straight from GitHub (pin a tag for reproducible runs):

```sh
npx github:hatyibei/aasa-check#v1 check --test-file links.test.yml
# or
npm i -D github:hatyibei/aasa-check#v1
```

From a git checkout:

```sh
git clone https://github.com/hatyibei/aasa-check.git
cd aasa-check
npm ci
npm run build
npx aasa-check check \
  --test-file links.example.yml \
  --aasa examples/apple-app-site-association.json \
  --no-cdn
```

## Commands

```
aasa-check match       --aasa <file.json> --url <url> [--app-id TEAM.com.bundle] [--expect app|web]
aasa-check check       --test-file links.test.yml [--aasa file.json] [--domain example.com] [--app-id ID] [--no-cdn]
aasa-check compare-cdn --domain example.com [--aasa file.json]
aasa-check validate    --aasa file.json
aasa-check fixtures    [--dir fixtures/unit]
```

All commands accept `--json` for machine-readable output.

## Example output

`match`:

```
$ aasa-check match --aasa examples/apple-app-site-association.json --url https://example.com/buy/1
https://example.com/buy/1
  Result: app (ABCD123456.com.example.app)
  Reason: matched details[0].components[2] (ABCD123456.com.example.app)
  Matched rule: details[0].components[2] {"/":"/buy/*"} exclude=false
```

`check` with the bundled example files and `--no-cdn`:

```
$ aasa-check check --test-file links.example.yml --aasa examples/apple-app-site-association.json --no-cdn
AASA: examples/apple-app-site-association.json  appID: ABCD123456.com.example.app
PASS https://example.com/buy/123 → app
PASS https://example.com/help/website/x → web
PASS https://example.com/help/x?articleNumber=1234 → app
PASS https://example.com/help/x?articleNumber=12 → web
PASS https://example.com/buy/1#no_universal_links → web
PASS https://example.com/ja_JP/sushi/ → app
PASS https://example.com/about → web
Matching: 7/7 passed
CDN comparison: skipped (--no-cdn)
Exit code: 0
```

## Exit codes

| Code | Meaning |
|---|---|
| `0` | OK |
| `1` | Match failure, fetch failure, or usage error |
| `2` | Site AASA and Apple CDN AASA differ (warning). Only returned when there is no match failure. |

If there is both a match failure and a CDN mismatch, the exit code is `1`: match failures take priority.

## Test file: `links.test.yml`

```yaml
domain: example.com             # optional
appID: TEAMID.com.example.app   # optional; only details for this app ID are considered
cases:
  - url: https://example.com/buy/123
    expect: app                 # app | open | true  = should open in the app
  - url: https://example.com/help/website/x
    expect: web                 # web | exclude | false = should not open in the app
```

## How matching works

The engine (`src/engine.ts`) follows Apple's published rules for `applinks`, plus the observed path normalization described below:

- `applinks.details` is walked from the top, then each entry's `components` (or `paths`) from the top. **The first match wins.** `exclude: true` (or a `"NOT "` prefix in legacy `paths`) means "do not open".
- If a `details` entry has both `components` and `paths`, only `components` is used (iOS 13+ behaviour).
- `appIDs` is read first; if missing, the legacy `appID` is used. Entries with neither are treated as applying to all apps and are still evaluated when `--app-id` is set. The app ID filter is an exact match.
- A component matches when every part it specifies (`/`, `?`, `#`) matches. Parts it omits are ignored.
- `caseSensitive` and `percentEncoded` default to `true`; `applinks.defaults` overrides that, and a component overrides the defaults.
- Legacy `paths` look at the URL path only; query and fragment are ignored.
- Patterns are whole-string matches: `*` = zero or more characters, `?` = exactly one, `?*` = one or more. `$(name)` substitution variables are supported, including the built-ins `alpha`, `upper`, `lower`, `alnum`, `digit`, `xdigit`, `region`, `lang`. An unknown variable never matches.
- The URL path always starts with `/`. If a pattern does not start with `/`, `*`, `?`, or `$(`, a `/` is prepended before matching. The same applies to legacy `paths`.

### Observed, undocumented behaviour

> [!WARNING]
> The following was **observed** on macOS 26.6.2 with `sudo swcutil verify -d <domain> -j <file> -u <url>`. We could not find it in Apple's public documentation. It may change in other OS versions.

- **On both the URL path and the pattern, consecutive slashes are collapsed into one (anywhere in the string), and then all trailing slashes are removed.** The root path `/` is kept as is.
- As a result, a `*` between two segments can effectively be empty: after collapsing, `/a/*/b` matches `/a/b`. `/a//b/` against `/a/*/b` was reported as matched.
- The engine does **not** try appending a slash to the URL to find a match. Doing so would make `/p/????` falsely match `/p/123`.

`aasa-check` applies this normalization so that its results agree with `swcutil` on the bundled fixtures.

## Ground truth: comparison with `swcutil verify`

The repository ships 21 fixture files (71 URL cases) under `fixtures/unit/`, including `19-trailing-slash-edges.json` and `20-slash-discrimination.json`, which cover the slash behaviour above.

On **2026-11-12 (JST)**, all 71 cases were run through `swcutil verify` on a Mac with **macOS 26.6.2**, and the engine's results agreed on **71 of 71** (0 mismatches, 0 unknown). This run was made after the slash normalization described above was added to the engine. A sanitized summary is in [docs/ground-truth-macos-26.6.2.md](docs/ground-truth-macos-26.6.2.md).

What this does and does not mean:

- It covers the bundled fixtures, on that macOS version. It is not a guarantee for every future iOS/macOS release or for patterns the fixtures don't exercise.
- `swcutil verify` checks the rules against a local JSON file. It does not involve a device, an installed app, or Apple's CDN.

### Reproducing it

On a Mac (root is required for `swcutil`), from a checkout with dependencies installed:

```sh
./collect-ground-truth.sh
```

If you are not root, the script prints the command to use and exits. Run:

```sh
sudo -E env PATH="$PATH" ./collect-ground-truth.sh --no-sudo --skip-dl
```

`--skip-dl` skips `swcutil dl` for `example.com`, which has no real AASA. Output goes to `ground-truth/`:

| Path | Contents |
|---|---|
| `ground-truth/raw/` | Raw `swcutil` stdout / stderr |
| `ground-truth/verify.tsv` | The `verify` invocation used for each URL |
| `ground-truth/results.json` | Parsed results (matched / blocked / unknown) |
| `ground-truth/comparison.md` | Engine vs. `swcutil` comparison table |

The script only runs on macOS. On Linux, use `npm test` and `aasa-check fixtures` to run the engine against the recorded expectations.

## Limitations

- **Not affiliated with Apple.** This is an independent reimplementation of Apple's public rules plus behaviour observed from `swcutil`.
- **71/71 is for the bundled fixtures on macOS 26.6.2.** Other OS versions and untested patterns may behave differently.
- **CDN mismatches can be caching lag.** Apple's CDN caches AASA files, so a mismatch right after a deploy does not necessarily mean the deploy is wrong. That is why exit code `2` is a warning.
- **No device testing.** It does not prove that a link opens in the app rather than Safari on a real iPhone. Entitlements, whether the app is installed, user choices, and system caches all play a part.
- **iOS only.** Android App Links (`assetlinks.json`) are not covered.
- **JSON only.** Signed (PKCS#7) AASA files are not supported.
- **Not yet verified against `swcutil`:**
  - the interpretation of `percentEncoded`;
  - whether the `$(lang)` / `$(region)` sets exactly match Foundation's locale lists;
  - whether query-dictionary key matching follows `caseSensitive`;
  - a few other edge cases: a built-in and a custom variable with the same name, an unclosed `$(` treated as a literal, `defaults` applied to legacy `paths`, `details` without app IDs still being evaluated when filtering by app ID, and the words used when parsing `swcutil` output.

## See also

Other tools in this area, with different scopes (not reviewed in depth):

- [LinkForty/aasa-validator](https://github.com/LinkForty/aasa-validator): AASA hosting and structure validation
- [chayev/yurl](https://github.com/chayev/yurl): checks that AASA / `assetlinks.json` exist and are well-formed
- `blazingly-aasa` (npm): parse, lint, URL matching, origin vs. CDN comparison

## License

[Apache License 2.0](LICENSE)
