#!/usr/bin/env bash
# Writes a fresh synthetic demo backup (a month of invented events for a made-up baby, ending now, one running sleep) for the Alexa
# reviewers' demo account (docs/ALEXA-SUBMISSION.md step 2). Run it as many times as needed, right before importing the file.
# Usage: scripts/generate-demo-backup.sh [output-file]   (default docs/samples/lotties-demo-backup-lia.json, gitignored)
set -euo pipefail
ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
OUT=${1:-$ROOT/docs/samples/lotties-demo-backup-lia.json}
mkdir -p "$(dirname "$OUT")"
LOTTIES_DEMO_BACKUP_OUT=$OUT dotnet test "$ROOT/code/api/tests/Lotties.Api.Tests" --filter DemoBackupGenerator --nologo -v q
echo "Demo backup written: $OUT"
echo "Next: delete the demo baby in the demo account (Hub > Settings > Baby), then Hub > Import backup with this file."
