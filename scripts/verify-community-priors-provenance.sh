#!/usr/bin/env bash
# verify-community-priors-provenance.sh
#
# CI build-time guard: ensures code/api/data/community-priors.json was generated
# exclusively from synthetic fixtures. Fails the build if any source is not
# synthetic, if any source URL points outside the repository, or if the purpose
# field does not mention "synthetic".
#
# Exit codes:
#   0 - all provenance checks pass
#   1 - one or more checks failed (descriptive message on stderr)

set -euo pipefail

PRIORS_FILE="code/api/data/community-priors.json"

if [ ! -f "$PRIORS_FILE" ]; then
  echo "FAIL: $PRIORS_FILE not found." >&2
  exit 1
fi

ERRORS=0

# Check 1: every entry in sources[] must have kind == "synthetic"
NON_SYNTHETIC=$(jq -r '.sources[] | select(.kind != "synthetic") | .id // (.kind // "unknown")' "$PRIORS_FILE")
if [ -n "$NON_SYNTHETIC" ]; then
  echo "FAIL: non-synthetic source(s) found in $PRIORS_FILE:" >&2
  echo "$NON_SYNTHETIC" >&2
  ERRORS=$((ERRORS + 1))
fi

# Check 2: no source may carry a URL pointing outside the repository.
# Allowed: null, empty string, or a relative path (no scheme). Blocked: anything with ://
EXTERNAL_URLS=$(jq -r '.sources[] | .url // empty | select(test("://"))' "$PRIORS_FILE")
if [ -n "$EXTERNAL_URLS" ]; then
  echo "FAIL: external URL(s) found in sources of $PRIORS_FILE:" >&2
  echo "$EXTERNAL_URLS" >&2
  ERRORS=$((ERRORS + 1))
fi

# Check 3: the top-level purpose field must mention "synthetic" (case-insensitive)
PURPOSE_MATCH=$(jq -r '.purpose // "" | test("(?i)synthetic")' "$PRIORS_FILE")
if [ "$PURPOSE_MATCH" != "true" ]; then
  echo "FAIL: purpose field in $PRIORS_FILE does not mention 'synthetic'." >&2
  ERRORS=$((ERRORS + 1))
fi

if [ "$ERRORS" -gt 0 ]; then
  echo "community-priors provenance check failed ($ERRORS error(s))." >&2
  exit 1
fi

echo "OK: community-priors.json provenance verified (all sources synthetic, no external URLs, purpose mentions synthetic)."
exit 0