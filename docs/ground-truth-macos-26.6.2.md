# Engine vs. `swcutil verify` (macOS 26.6.2)

This is a sanitized summary of a comparison run on **2026-11-12 (JST)** against Apple's `swcutil verify` on **macOS 26.6.2**. Raw `swcutil` output is not checked in (it can contain machine-local paths).

## Result

- Bundled fixtures: 21 files, 71 URL cases (`fixtures/unit/`, including `19-trailing-slash-edges.json` and `20-slash-discrimination.json`).
- Command used: `sudo swcutil verify -d <domain> -j <file> -u <url>`.
- Outcome: **71 of 71 agreed** (0 mismatches, 0 unknown), after the engine applied the path normalization described below.

This covers the bundled fixtures on that macOS version only. It is not a guarantee for other OS versions or untested patterns. `swcutil verify` checks a local JSON file; it does not involve a device, an installed app, or Apple's CDN.

## Observed, undocumented behaviour

The following was observed with that `swcutil verify` command and was not found in Apple's public documentation.

On both the URL path and the pattern, consecutive slashes are collapsed into one (anywhere in the string), and then all trailing slashes are removed. The root path `/` is kept.

As a result, a `*` between two segments can be empty: after collapsing, `/a/*/b` matches `/a/b`.

## How to reproduce

On a Mac, from a checkout with dependencies installed:

```sh
./collect-ground-truth.sh
```

If you are not root, the script prints the command to use and exits. Run:

```sh
sudo -E env PATH="$PATH" ./collect-ground-truth.sh --no-sudo --skip-dl
```

`--skip-dl` skips `swcutil dl` for `example.com`, which has no real AASA. Output goes to `ground-truth/` (gitignored). See `comparison.md` and `results.json` there.
