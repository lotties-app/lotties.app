"""Night-window evaluation: does a different day/night split improve the heuristic's next-feed and next-sleep predictions?

``python -m benchmark.night_window --out out`` (synthetic cohorts only, the default) or ``--data $BR_ML_DATA`` (the
owner's own export, kept outside the repository; only aggregates are written). docs/design/28-age-norms.md section 15.4.

The C# engine splits feed and sleep samples into day and night with a fixed clock window (``PredictionOptions``
``NightStartsAt`` 19:00, ``NightEndsAt`` 07:00). Published Brazilian data put the median bed time at 22:00, so for a
typical Brazilian baby the evening is classed as night. Variants compared, all with the faithful heuristic port:

- ``current``: 19:00-07:00 (what ships);
- ``norm_prior``: 22:00-08:00 (Pelotas medians: bed time 22:00 at 3, 12 and 24 months; wake time 07:30-08:30);
- ``norm_prior_m60``: 21:00-08:00 (the same, the night starting an hour before the median bed time);
- ``learned``: the baby's own window from the ``bed_time`` and ``woke_up`` markers of the look-back (median clocks,
  at least ``MIN_NIGHTS`` of each), else the norm prior;
- ``learned_m60``: the same, starting an hour before her median bed time, else ``norm_prior_m60``;
- ``learned_m60_or_current``: ``learned_m60`` falling back to 19:00-07:00 (a per-baby option without norms).

Scored: the expected start of the next feed (asked right after each feed) and of the next sleep (asked at each
wake-up), MAE in minutes over decision points where every variant predicts, after a 14-day warm-up. Babies are the
resampling unit of the paired bootstrap. Synthetic data cannot prove a real-world gain.
"""

from __future__ import annotations

import argparse
import json
import os
import time
from dataclasses import replace
from pathlib import Path

import numpy as np

from .data import SECONDS_PER_DAY, SECONDS_PER_HOUR, SECONDS_PER_MINUTE, Dataset, load_events, local_seconds_of_day
from .heuristic import BED_TIME, DEFAULT_OPTIONS, WOKE_UP, Insufficient, Options, predict
from .synthetic import COHORTS, cohort_baby
from .targets import build_targets

MIN_NIGHTS = 5
WARM_UP_DAYS = 14
MARGIN = 60 * SECONDS_PER_MINUTE
NORM_PRIOR = (22 * SECONDS_PER_HOUR, 8 * SECONDS_PER_HOUR)
NORM_PRIOR_M60 = (NORM_PRIOR[0] - MARGIN, NORM_PRIOR[1])
CURRENT = (DEFAULT_OPTIONS.night_starts_at, DEFAULT_OPTIONS.night_ends_at)
VARIANTS = ("current", "norm_prior", "norm_prior_m60", "learned", "learned_m60", "learned_m60_or_current")
TARGETS = {"feed": "feeding", "sleep_start": "sleep"}
EVENING = (18 * SECONDS_PER_HOUR, 24 * SECONDS_PER_HOUR)


def _median_clock(clocks: list[float], pivot: float) -> float:
    """Median local clock (seconds after midnight) of clocks that may wrap midnight, measured from ``pivot``."""
    shifted = sorted((clock - pivot) % SECONDS_PER_DAY for clock in clocks)
    middle = shifted[len(shifted) // 2] if len(shifted) % 2 else (shifted[len(shifted) // 2 - 1] + shifted[len(shifted) // 2]) / 2
    return (middle + pivot) % SECONDS_PER_DAY


def learned_window(dataset: Dataset, now: float, offset: float, fallback: tuple[float, float], margin: float = 0.0) -> tuple[float, float]:
    """The baby's own night window from the markers of the look-back (the start ``margin`` before her median bed time),
    or ``fallback`` with too few nights."""
    since = now - DEFAULT_OPTIONS.look_back
    beds = [local_seconds_of_day(item.start, offset) for item in dataset.events if item.kind == BED_TIME and since <= item.start <= now]
    wakes = [local_seconds_of_day(item.start, offset) for item in dataset.events if item.kind == WOKE_UP and since <= item.start <= now]
    if len(beds) < MIN_NIGHTS or len(wakes) < MIN_NIGHTS:
        return fallback
    return (_median_clock(beds, 12 * SECONDS_PER_HOUR) - margin) % SECONDS_PER_DAY, _median_clock(wakes, 0.0)


def options_for(variant: str, dataset: Dataset, now: float, offset: float) -> Options:
    window = {
        "current": lambda: CURRENT,
        "norm_prior": lambda: NORM_PRIOR,
        "norm_prior_m60": lambda: NORM_PRIOR_M60,
        "learned": lambda: learned_window(dataset, now, offset, NORM_PRIOR),
        "learned_m60": lambda: learned_window(dataset, now, offset, NORM_PRIOR_M60, MARGIN),
        "learned_m60_or_current": lambda: learned_window(dataset, now, offset, CURRENT, MARGIN),
    }[variant]()
    return replace(DEFAULT_OPTIONS, night_starts_at=window[0], night_ends_at=window[1])


def evaluate_baby(dataset: Dataset) -> dict[str, dict[str, list[float]]]:
    """Absolute errors (minutes) per target, variant and subset (``all``, ``evening``), paired across variants."""
    targets = build_targets(dataset)
    start_at = dataset.first_start + WARM_UP_DAYS * SECONDS_PER_DAY
    errors: dict[str, dict[str, list[float]]] = {}
    for target, type_key in TARGETS.items():
        samples = targets[target]
        for t, y, valid in zip(samples.t, samples.y, samples.valid):
            if not valid or t < start_at:
                continue
            offset = dataset.offset_seconds(float(t))
            seen = dataset.as_of(float(t))
            predicted = {}
            for variant in VARIANTS:
                result = predict(seen, dataset.birth_date, float(t), offset, options_for(variant, dataset, float(t), offset), [type_key])[type_key]
                if isinstance(result, Insufficient):
                    break
                predicted[variant] = (result.expected - float(t)) / SECONDS_PER_MINUTE
            if len(predicted) != len(VARIANTS):
                continue
            clock = local_seconds_of_day(float(t), offset)
            subsets = ["all", "evening"] if EVENING[0] <= clock < EVENING[1] else ["all"]
            for variant, minutes in predicted.items():
                for subset in subsets:
                    errors.setdefault(f"{target}/{subset}", {}).setdefault(variant, []).append(abs(minutes - float(y)))
    return errors


def summarize(per_baby: list[dict[str, dict[str, list[float]]]], resamples: int, seed: int) -> dict:
    """MAE per variant (pooled points) and the paired bootstrap over babies of each variant minus ``current``."""
    rng = np.random.default_rng(seed)
    keys = sorted({key for baby in per_baby for key in baby})
    out: dict = {}
    for key in keys:
        babies = [baby[key] for baby in per_baby if key in baby]
        entry: dict = {"babies": len(babies), "points": int(sum(len(b["current"]) for b in babies))}
        for variant in VARIANTS:
            entry[variant] = {"mae": float(np.mean([e for b in babies for e in b[variant]]))}
        for variant in VARIANTS[1:]:
            draws = []
            for _ in range(resamples):
                chosen = [babies[i] for i in rng.integers(0, len(babies), len(babies))]
                current = np.concatenate([b["current"] for b in chosen])
                other = np.concatenate([b[variant] for b in chosen])
                draws.append(float(other.mean() - current.mean()))
            low, high = np.percentile(draws, [2.5, 97.5])
            entry[variant]["delta_vs_current"] = entry[variant]["mae"] - entry["current"]["mae"]
            entry[variant]["ci95"] = [float(low), float(high)]
        out[key] = entry
    return out


def markdown(report: dict) -> str:
    lines = ["# Night-window evaluation", "", f"Synthetic cohorts, {report['babies_per_cohort']} babies each, {report['days']} days, last feed {report['bedtime_feed_lead']:.0f} min before bed; MAE in minutes; Δ = variant − current with a 95 % bootstrap CI over babies.", ""]
    for cohort, results in report["cohorts"].items():
        header = " | ".join(f"{variant} (Δ, CI)" for variant in VARIANTS[1:])
        lines += [f"## {cohort}", "", f"| target / subset | babies | points | current | {header} |", "|---|---:|---:|---:|" + "---|" * (len(VARIANTS) - 1)]
        for key, entry in results.items():
            cells = [f"{entry[v]['mae']:.1f} ({entry[v]['delta_vs_current']:+.1f}, {entry[v]['ci95'][0]:+.1f}..{entry[v]['ci95'][1]:+.1f})" for v in VARIANTS[1:]]
            lines.append(f"| {key} | {entry['babies']} | {entry['points']} | {entry['current']['mae']:.1f} | " + " | ".join(cells) + " |")
        lines.append("")
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--data", default=None, help="the owner's events CSV (kept outside the repository); default: synthetic cohorts only")
    parser.add_argument("--out", default=os.environ.get("BR_ML_OUT", "out"))
    parser.add_argument("--babies", type=int, default=30, help="synthetic babies per cohort")
    parser.add_argument("--days", type=int, default=35)
    parser.add_argument("--resamples", type=int, default=1000)
    parser.add_argument("--seed", type=int, default=7)
    parser.add_argument("--bedtime-feed-lead", type=float, default=15, help="synthetic: minutes from the last feed to bed time (sensitivity)")
    args = parser.parse_args(argv)
    started = time.perf_counter()
    report: dict = {"babies_per_cohort": args.babies, "days": args.days, "bedtime_feed_lead": args.bedtime_feed_lead, "min_nights": MIN_NIGHTS, "warm_up_days": WARM_UP_DAYS, "cohorts": {}}
    if args.data:
        report["cohorts"]["own_data"] = summarize([evaluate_baby(load_events(args.data))], args.resamples, args.seed)
    else:
        for name, cohort in COHORTS.items():
            per_baby = [evaluate_baby(cohort_baby(cohort, seed, args.days, bedtime_feed_lead=args.bedtime_feed_lead)) for seed in range(args.babies)]
            report["cohorts"][name] = summarize(per_baby, args.resamples, args.seed)
            print(f"{name}: {args.babies} babies done", flush=True)
    report["seconds"] = time.perf_counter() - started
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    (out / "night_window.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    (out / "night_window.md").write_text(markdown(report) + "\n", encoding="utf-8")
    print(f"wrote {out / 'night_window.json'} and night_window.md in {report['seconds']:.0f}s", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
