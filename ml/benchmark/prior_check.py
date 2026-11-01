"""Before/after of the age-band priors (``priors.LEGACY_PRIORS`` vs ``priors.PRIORS``) on synthetic cohorts.

``python -m benchmark.prior_check --out out``. The priors are what the benchmark predicts with no history (the
``age_band_prior`` baseline, the cold-start fallback and the shrinkage model's starting point). Only the bed-time and
night-length priors changed (docs/design/28-age-norms.md section 15.5), so only the ``bedtime`` and ``night_duration``
targets are scored: MAE in minutes of the prior's median against every valid outcome of 30 synthetic babies per cohort
(``synthetic.cohort_baby``). The Brazilian cohort is drawn from the same Pelotas medians as the new priors, so it is
expected to favour them; the Swiss-like control shows the cost for babies who sleep like the old priors assumed.
Synthetic data cannot prove a real-world gain.
"""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path

import numpy as np

from .data import local_date
from .features import evening_clock
from .heuristic import age_band
from .priors import LEGACY_PRIORS, PRIORS, lognormal_quantiles, truncated_clock_quantiles
from .synthetic import COHORTS, cohort_baby
from .targets import build_targets

TARGETS = {"bedtime": "bedtime", "night_duration": "night"}


def prior_median(table: dict, target: str, band: int, now_clock: float) -> float:
    center, spread = table[band][TARGETS[target]]
    if target == "bedtime":
        return float(truncated_clock_quantiles(center, spread, now_clock)[2])
    return float(lognormal_quantiles(center, spread)[2])


def errors_of(dataset, table: dict) -> dict[str, list[float]]:
    targets = build_targets(dataset)
    out: dict[str, list[float]] = {}
    for target in TARGETS:
        samples = targets[target]
        for t, y, valid in zip(samples.t, samples.y, samples.valid):
            if not valid:
                continue
            offset = dataset.offset_seconds(float(t))
            band = age_band(dataset.birth_date, local_date(float(t), offset))
            predicted = prior_median(table, target, band, evening_clock(float(t), offset))
            out.setdefault(target, []).append(abs(predicted - float(y)))
    return out


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--out", default=os.environ.get("BR_ML_OUT", "out"))
    parser.add_argument("--babies", type=int, default=30)
    parser.add_argument("--days", type=int, default=35)
    args = parser.parse_args(argv)
    report: dict = {"babies_per_cohort": args.babies, "days": args.days, "cohorts": {}}
    for name, cohort in COHORTS.items():
        babies = [cohort_baby(cohort, seed, args.days) for seed in range(args.babies)]
        result = {}
        for label, table in (("before", LEGACY_PRIORS), ("after", PRIORS)):
            pooled: dict[str, list[float]] = {}
            for baby in babies:
                for target, values in errors_of(baby, table).items():
                    pooled.setdefault(target, []).extend(values)
            result[label] = {target: {"n": len(values), "mae": float(np.mean(values))} for target, values in pooled.items()}
        report["cohorts"][name] = result
    lines = ["# Prior check (prior median vs outcome, MAE in minutes)", "", "| cohort | target | n | before | after |", "|---|---|---:|---:|---:|"]
    for name, result in report["cohorts"].items():
        for target in TARGETS:
            before, after = result["before"][target], result["after"][target]
            lines.append(f"| {name} | {target} | {before['n']} | {before['mae']:.1f} | {after['mae']:.1f} |")
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    (out / "prior_check.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    (out / "prior_check.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print("\n".join(lines), flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
