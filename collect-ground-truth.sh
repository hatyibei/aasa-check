#!/usr/bin/env bash
# =============================================================================
# collect-ground-truth.sh — Run the bundled fixtures through swcutil on a Mac
# and compare the verdicts with the aasa-check engine.
#
# macOS only. Exits immediately on any other OS (swcutil is not available).
#
# swcutil verify requires root. The only supported form is:
#   swcutil verify -d <domain> -j <aasa.json> -u <url>
# If this script is not running as root, it prints the following and exits:
#   sudo -E env PATH="$PATH" ./collect-ground-truth.sh --no-sudo --skip-dl
#
# Root commands used here:
#   - swcutil dl -d <domain>     … download AASA from Apple into the system cache
#   - swcutil show -d <domain>   … show the cache
#   - swcutil verify -d <domain> -j <file> -u <url>
#
# The fixture domain (example.com) has no real AASA, so `dl` may fail. That is
# recorded and verify still uses the local JSON via -j.
#
# Output:
#   <out>/raw/          … raw swcutil stdout/stderr
#   <out>/verify.tsv    … which verify form was used for each URL
#   <out>/results.json  … matched / blocked / unknown (best-effort parse)
#   <out>/comparison.md … engine vs. swcutil table
#
# Usage (from this directory, on a Mac):
#   ./collect-ground-truth.sh
#   ./collect-ground-truth.sh --fixtures fixtures/unit --out ground-truth
#
# Options:
#   --fixtures <dir>  fixture directory (default fixtures/unit)
#   --out <dir>       output directory (default ground-truth)
#   --no-sudo         call swcutil without prefixing sudo
#   --skip-dl         skip swcutil dl / show
#   --skip-swcutil    skip the swcutil verify pass
#   -h, --help        this message
# =============================================================================
set -u

FIXTURES="fixtures/unit"
OUT="ground-truth"
SUDO="sudo"
SKIP_DL=0
SKIP_SWCUTIL=0

usage() {
  sed -n '2,/^# =====/p' "${0}" | sed -e '${d}' -e 's/^# \{0,1\}//'
}

while [ "${#}" -gt 0 ]; do
  case "${1}" in
    --fixtures) FIXTURES="${2:?--fixtures requires a value}"; shift 2 ;;
    --out) OUT="${2:?--out requires a value}"; shift 2 ;;
    --no-sudo) SUDO=""; shift ;;
    --skip-dl) SKIP_DL=1; shift ;;
    --skip-swcutil) SKIP_SWCUTIL=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "unknown argument: ${1}" >&2; usage >&2; exit 1 ;;
  esac
done

if [ "$(uname -s)" != "Darwin" ]; then
  echo "This script is macOS-only (swcutil is not available elsewhere)." >&2
  echo "Current OS: $(uname -s). Do not run this on Linux or in CI. Exiting." >&2
  exit 1
fi

cd "$(dirname "$0")" || exit 1

if ! command -v swcutil >/dev/null 2>&1; then
  echo "swcutil not found (/usr/bin/swcutil). Check the macOS version." >&2
  exit 1
fi
if [ ! -d node_modules/tsx ]; then
  echo "node_modules is missing. Run 'npm install' first." >&2
  exit 1
fi

RAW="${OUT}/raw"
mkdir -p "${RAW}"
TSX=(node --import tsx)

cat <<'EOS'
==============================================================================
 collect-ground-truth.sh

 swcutil verify requires root (form: verify -d <domain> -j <file> -u <url> only).
 If you are not root, run:
   sudo -E env PATH="$PATH" ./collect-ground-truth.sh --no-sudo --skip-dl
==============================================================================
EOS

if [ "${SKIP_SWCUTIL}" -eq 0 ] && [ "$(id -u)" -ne 0 ]; then
  echo "swcutil verify requires root. Not running as root, so stopping here." >&2
  echo "Run:" >&2
  echo '  sudo -E env PATH="$PATH" ./collect-ground-truth.sh --no-sudo --skip-dl' >&2
  exit 1
fi

swcutil -h >"${RAW}/help.txt" 2>&1 || true
swcutil verify -h >"${RAW}/help-verify.txt" 2>&1 || true

CASES="${OUT}/cases.tsv"
if ! "${TSX[@]}" scripts/ground-truth.ts export "${FIXTURES}" "${OUT}" >"${CASES}"; then
  echo "Failed to export fixtures." >&2
  exit 1
fi
echo "cases: $(wc -l <"${CASES}" | tr -d ' ')"

if [ "${SKIP_SWCUTIL}" -eq 0 ]; then

if [ "${SKIP_DL}" -eq 0 ]; then
  cut -f4 "${CASES}" | sort -u | while read -r domain; do
    [ -z "${domain}" ] && continue
    echo "swcutil dl -d ${domain} …"
    ${SUDO} swcutil dl -d "${domain}" >"${RAW}/dl-${domain}.txt" 2>&1
    echo "exit=$?" >>"${RAW}/dl-${domain}.txt"
    ${SUDO} swcutil show -d "${domain}" >"${RAW}/show-${domain}.txt" 2>&1
    echo "exit=$?" >>"${RAW}/show-${domain}.txt"
    if grep -q '^exit=0$' "${RAW}/dl-${domain}.txt"; then
      echo "  dl succeeded"
    else
      echo "  dl failed (recorded only; verify will use the local JSON): ${RAW}/dl-${domain}.txt"
    fi
  done
else
  echo "dl / show skipped (--skip-dl)"
fi

# The only form confirmed on macOS 26.6.2 is `verify -d <domain> -j <file> -u <url>`.
# Do not use positional arguments or omit -j.
VERIFY_TSV="${OUT}/verify.tsv"
printf '# fixture\tindex\turl\tform\texit\trawfile\n' >"${VERIFY_TSV}"

while IFS="$(printf '\t')" read -r fixture index url domain aasa expected; do
  [ -z "${fixture}" ] && continue
  raw="${RAW}/${fixture}__${index}__form1.txt"
  {
    echo "# command: ${SUDO} swcutil verify -d ${domain} -j ${aasa} -u ${url}"
    echo "# expected(engine fixture): ${expected}"
  } >"${raw}"
  ${SUDO} swcutil verify -d "${domain}" -j "${aasa}" -u "${url}" >>"${raw}" 2>&1
  code="${?}"
  echo "# exit=${code}" >>"${raw}"
  printf '%s\t%s\t%s\t%s\t%s\t%s\n' "${fixture}" "${index}" "${url}" "1" "${code}" "${raw}" >>"${VERIFY_TSV}"
  echo "verify [${fixture} #${index}] form=1 exit=${code} ${url}"
done <"${CASES}"

"${TSX[@]}" scripts/ground-truth.ts report "${FIXTURES}" "${OUT}"
  echo
  echo "Done (swcutil): see ${OUT}/results.json and ${OUT}/comparison.md."
  echo "Parsing swcutil verdicts is best-effort. Inspect ${RAW}/ by hand when a result is 'unknown'."
else
  echo "swcutil pass skipped (--skip-swcutil)"
fi
