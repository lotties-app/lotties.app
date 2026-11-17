"""Generate static community priors from synthetic study output (docs/design/34-community-insights.md).

Reads the results of ``python -m benchmark.community`` and writes
``code/api/data/community-priors.json``, an embedded resource validated at
startup alongside ``age-norms.json``. Only tier-A eligible statistics are
included: shares (cry_outcome_by_cause) and share_of_days_with_any
(tummy_minutes_per_day). Percentile-based statistics stay out until O2
tier-B epsilon approval.

Usage::

    python -m benchmark.generate_static_priors --input ml/benchmark/results/<run>.json

The input path must be under ``ml/benchmark/`` (build-time safety assertion).
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import date, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
BENCHMARK_DIR = REPO_ROOT / "ml" / "benchmark"
OUTPUT_PATH = REPO_ROOT / "code" / "api" / "data" / "community-priors.json"

# Tier-A eligible statistic keys: only share-based outputs qualify for Phase 0.
TIER_A_KEYS = frozenset({"cry_outcome_by_cause", "tummy_minutes_per_day"})


def _assert_safe_input(path: Path) -> None:
    """Refuse to read outside the benchmark directory."""
    resolved = path.resolve()
    assert str(resolved).startswith(str(BENCHMARK_DIR.resolve())), (
        f"Input path {resolved} is not under {BENCHMARK_DIR}; refusing to read."
    )


def _load_results(path: Path) -> dict:
    _assert_safe_input(path)
    with path.open(encoding="utf-8") as fh:
        return json.load(fh)


def _extract_norms(results: dict) -> list[dict]:
    """Pull tier-A norms from the synthetic study output.

    The community.py benchmark writes per-statistic summaries keyed by
    statistic key. We keep only those whose key is in TIER_A_KEYS and whose
    confidence is not low and needsReview is false.
    """
    norms: list[dict] = []
    statistics = results.get("statistics", {})
    for key, summary in statistics.items():
        if key not in TIER_A_KEYS:
            continue
        entries = summary.get("norms", [])
        for entry in entries:
            confidence = entry.get("confidence", "low")
            needs_review = entry.get("needsReview", False)
            if confidence == "low" or needs_review:
                continue
            norms.append(
                {
                    "metric": entry["metric"],
                    "ageBand": {"fromWeeks": entry["fromWeeks"], "toWeeks": entry["toWeeks"]},
                    "typical": entry["typical"],
                    "unit": entry["unit"],
                    "confidence": confidence,
                    "sourceIds": entry.get("sourceIds", ["synthetic-study"]),
                }
            )
    return norms


def write_priors(norms: list[dict]) -> None:
    payload = {
        "schemaVersion": 1,
        "generatedAt": date.today(timezone.utc).isoformat(),
        "purpose": (
            "Pre-computed community priors baked into the release for cold-start predictions. "
            "Only tier-A share-based statistics are included; percentile outputs wait for O2 "
            "tier-B epsilon approval. See docs/design/34-community-insights.md."
        ),
        "norms": norms,
    }
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with OUTPUT_PATH.open("w", encoding="utf-8") as fh:
        json.dump(payload, fh, indent=2, ensure_ascii=False)
        fh.write("\n")
    print(f"Wrote {len(norms)} norms to {OUTPUT_PATH}")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True, type=Path, help="Path to community.py results JSON under ml/benchmark/")
    args = parser.parse_args(argv)

    results = _load_results(args.input)
    norms = _extract_norms(results)
    write_priors(norms)
    return 0


if __name__ == "__main__":
    sys.exit(main())