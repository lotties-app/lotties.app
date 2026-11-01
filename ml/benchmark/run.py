"""Command line entry point: ``python -m benchmark.run --data $BR_ML_DATA --out <dir>``.

Writes only aggregate metrics (``results.json`` and ``results.md``) to ``--out``; no event or per-prediction rows are
written anywhere.
"""

from __future__ import annotations

import argparse
import json
import os
import platform
import sys
import time
from datetime import date, timedelta
from pathlib import Path

import numpy as np

from .backtest import FAST_METHODS, METHODS, SENSITIVITY, Run, combine, data_days, evaluate, local_days, prepare, subset, timings
from .data import load_events, local_midnight
from .metrics import bootstrap_improvement, scores
from .priors import use_legacy_priors
from .synthetic import COHORTS, cohort_baby

PRIMARY = ("feed", "diaper", "sleep_start", "nap_duration", "night_duration", "bedtime")
CORE = (
    "heuristic",
    "heuristic_kind",
    "last10_median",
    "same_hour_median",
    "lgbm_quantile",
    "lgbm_quantile_ratio",
    "linear_quantile",
    "hazard",
    "shrinkage",
    "ensemble",
)


DURATION_TARGETS = ("nap_duration", "night_duration", "wake_up")


def reference_of(target: str) -> str:
    """The method improvements are measured against: the C# port, or for the bed-time clock target (which the C#
    engine does not predict) the recent bed-time clock baseline."""
    return "same_hour_median" if target in ("bedtime", "bedtime_after_last_nap") else "heuristic"


def score_run(run: Run, resamples: int) -> dict:
    reference = reference_of(run.target)
    secondary = "heuristic_kind" if run.target in DURATION_TARGETS and "heuristic_kind" in run.predictions else None
    out = {
        "target": run.target,
        "reference": reference,
        "secondary_reference": secondary,
        "n": int(len(run.y)),
        "days": int(len(np.unique(run.day))),
        "methods": {},
    }
    for method, values in run.predictions.items():
        entry = scores(run.y, values)
        entry["fallbacks"] = int(run.fallbacks.get(method, 0))
        if method != reference and len(run.y):
            entry.update(bootstrap_improvement(run.y, values, run.predictions[reference], run.day, resamples))
        if secondary and method != secondary and len(run.y):
            versus = bootstrap_improvement(run.y, values, run.predictions[secondary], run.day, resamples)
            entry.update({f"vs_kind_{key}": value for key, value in versus.items()})
        out["methods"][method] = entry
    return out


def evaluate_window(prepared, days: list[date], resamples: int, frozen_at: float | None = None, methods=METHODS) -> dict:
    runs = {name: evaluate(prepared, name, days, frozen_at, methods) for name in PRIMARY}
    runs["wake_up"] = combine([runs["nap_duration"], runs["night_duration"]], "wake_up")
    runs["nap_start"] = subset(runs["sleep_start"], "nap", "nap_start")
    runs["night_start"] = subset(runs["sleep_start"], "night", "night_start")
    runs["bedtime_after_last_nap"] = subset(runs["bedtime"], "last_wake", "bedtime_after_last_nap")
    return {name: score_run(run, resamples) for name, run in runs.items() if len(run.y)}


def fmt(value: float, digits: int = 0) -> str:
    return "-" if value is None or (isinstance(value, float) and np.isnan(value)) else f"{value:.{digits}f}"


def pct(value: float | None) -> str:
    return "-" if value is None else f"{100 * value:+.0f}%"


def interval(entry: dict, prefix: str) -> str:
    return f"{pct(entry[prefix + '_rel'])} [{pct(entry[prefix + '_rel_lo'])}, {pct(entry[prefix + '_rel_hi'])}]"


def markdown_table(result: dict, methods: tuple[str, ...]) -> str:
    reference = result["reference"]
    secondary = result.get("secondary_reference")
    extra_head = " ΔMAE vs heuristic_kind |" if secondary else ""
    lines = [
        f"**{result['target']}** (n = {result['n']} predictions over {result['days']} days; improvement vs `{reference}`)",
        "",
        "| method | MAE | MedAE | pinball q10/q50/q90 | cov80 | cov50 | ±15 | ±30 | ΔMAE [95% CI] | Δpinball [95% CI] |" + extra_head,
        "|---|---:|---:|---|---:|---:|---:|---:|---|---|" + ("---|" if secondary else ""),
    ]
    for method in methods:
        entry = result["methods"].get(method)
        if entry is None:
            continue
        delta = "ref" if method == reference else interval(entry, "mae")
        delta_p = "ref" if method == reference else interval(entry, "pinball")
        extra = ""
        if secondary:
            extra = " ref |" if method == secondary else f" {interval(entry, 'vs_kind_mae')} |"
        lines.append(
            f"| {method} | {fmt(entry['mae'])} | {fmt(entry['median_ae'])} | "
            f"{fmt(entry['pinball_q10'], 1)} / {fmt(entry['pinball_q50'], 1)} / {fmt(entry['pinball_q90'], 1)} | "
            f"{fmt(100 * entry['coverage80'])}% | {fmt(100 * entry['coverage50'])}% | {fmt(100 * entry['within15'])}% | "
            f"{fmt(100 * entry['within30'])}% | {delta} | {delta_p} |{extra}"
        )
    return "\n".join(lines)


SUMMARY_TARGETS = ("feed", "diaper", "sleep_start", "nap_duration", "night_duration", "wake_up", "bedtime")
SUMMARY_METHODS = ("heuristic_kind", "lgbm_quantile", "linear_quantile", "hazard", "shrinkage", "ensemble")


def summary_table(title: str, windows: dict) -> str:
    """One row per (window, target): reference MAE and the MAE change of the main models."""
    lines = [
        f"### {title}",
        "",
        "| window | target | n | reference MAE | " + " | ".join(SUMMARY_METHODS) + " |",
        "|---|---|---:|---:|" + "---|" * len(SUMMARY_METHODS),
    ]
    for window, results in windows.items():
        for target in SUMMARY_TARGETS:
            result = results.get(target)
            if result is None:
                continue
            reference = result["methods"][result["reference"]]
            cells = []
            for method in SUMMARY_METHODS:
                entry = result["methods"].get(method)
                cells.append(interval(entry, "mae") if entry and "mae_rel" in entry else "-")
            lines.append(f"| {window} | {target} | {result['n']} | {fmt(reference['mae'])} | " + " | ".join(cells) + " |")
    return "\n".join(lines)


def peak_memory_mb() -> float | None:
    try:
        import psutil

        info = psutil.Process().memory_info()
        peak = getattr(info, "peak_wset", None) or getattr(info, "rss", None)
        return peak / 1024 / 1024 if peak else None
    except ImportError:
        return None


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data", default=os.environ.get("BR_ML_DATA"), help="events CSV (default $BR_ML_DATA)")
    parser.add_argument("--out", default=os.environ.get("BR_ML_OUT", "out"), help="directory for results.json/.md")
    parser.add_argument("--test-days", type=int, default=21)
    parser.add_argument("--resamples", type=int, default=2000)
    parser.add_argument("--skip-cold-start", action="store_true")
    parser.add_argument("--sensitivity", action="store_true", help="also run LightGBM variants on both windows")
    parser.add_argument("--synthetic", choices=sorted(COHORTS), help="run on one synthetic baby of this cohort instead of --data")
    parser.add_argument("--synthetic-seed", type=int, default=0)
    parser.add_argument("--synthetic-days", type=int, default=70)
    parser.add_argument("--legacy-priors", action="store_true", help="the age-band priors before 2026-10-23 (before/after runs)")
    args = parser.parse_args(argv)

    started = time.perf_counter()
    use_legacy_priors(args.legacy_priors)
    dataset = (
        cohort_baby(COHORTS[args.synthetic], args.synthetic_seed, args.synthetic_days)
        if args.synthetic
        else load_events(args.data)
    )
    prepared = prepare(dataset)
    first, last = data_days(dataset)
    test_first = last - timedelta(days=args.test_days - 1)
    validation_first = test_first - timedelta(days=args.test_days)
    test_days = local_days(dataset, test_first, last)
    validation_days = local_days(dataset, max(validation_first, first + timedelta(days=7)), test_first - timedelta(days=1))
    report: dict = {
        "data": {
            "events": len(dataset.events),
            "days": (last - first).days + 1,
            "age_days": [(first - dataset.birth_date).days, (last - dataset.birth_date).days],
            "decision_points": {name: int(len(t.samples)) for name, t in prepared.targets.items()},
            "valid_outcomes": {name: int(t.samples.valid.sum()) for name, t in prepared.targets.items()},
            "excluded_gaps": {
                name: int((np.isfinite(t.samples.y) & ~t.samples.valid).sum()) for name, t in prepared.targets.items()
            },
        },
        "windows": {
            "test": [str(test_days[0]), str(test_days[-1])],
            "validation": [str(validation_days[0]), str(validation_days[-1])],
        },
        "environment": {"python": sys.version.split()[0], "platform": platform.platform(), "cpu_count": os.cpu_count()},
    }
    print(f"prepared features in {prepared.seconds:.1f}s", flush=True)

    report["test"] = evaluate_window(prepared, test_days, args.resamples)
    print("test window done", flush=True)
    report["validation"] = evaluate_window(prepared, validation_days, args.resamples, methods=FAST_METHODS)
    print("validation window done", flush=True)

    if args.sensitivity:
        methods = ("heuristic", "same_hour_median", "lgbm_quantile") + SENSITIVITY
        report["sensitivity"] = {
            "validation": evaluate_window(prepared, validation_days, args.resamples, methods=methods),
            "test": evaluate_window(prepared, test_days, args.resamples, methods=methods),
        }
        print("sensitivity done", flush=True)

    if not args.skip_cold_start:
        weeks = {}
        for week in (2, 3, 4):
            days = local_days(dataset, first + timedelta(days=7 * (week - 1)), first + timedelta(days=7 * week - 1))
            weeks[f"week{week}"] = evaluate_window(prepared, days, args.resamples, methods=FAST_METHODS)
        report["cold_start_rolling"] = weeks
        frozen = {}
        for weeks_of_history in (1, 2, 3):
            cut_day = first + timedelta(days=7 * weeks_of_history)
            at = local_midnight(cut_day, dataset.offset_seconds(dataset.first_start))
            frozen[f"first{weeks_of_history}w"] = evaluate_window(prepared, test_days, args.resamples, at, methods=FAST_METHODS)
        report["cold_start_frozen"] = frozen
        print("cold start done", flush=True)

    report["timings"] = {name: timings(prepared, name) for name in PRIMARY}
    report["feature_ms_per_point"] = 1000 * prepared.seconds / sum(len(t.samples) for t in prepared.targets.values())
    report["peak_memory_mb"] = peak_memory_mb()
    report["total_seconds"] = time.perf_counter() - started

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    (out / "results.json").write_text(json.dumps(report, indent=2, default=float), encoding="utf-8")
    sections = [f"# Backtest results\n\nTest window {report['windows']['test'][0]} to {report['windows']['test'][1]}."]
    for name, result in report["test"].items():
        sections.append(markdown_table(result, METHODS))
    sections.append(f"## Validation window {report['windows']['validation'][0]} to {report['windows']['validation'][1]}\n")
    for name, result in report["validation"].items():
        sections.append(markdown_table(result, CORE))
    sections.append("## Summaries (ΔMAE vs reference, 95% day-block bootstrap CI)\n")
    sections.append(summary_table("Test and validation", {"test": report["test"], "validation": report["validation"]}))
    if "sensitivity" in report:
        sens = report["sensitivity"]
        lines = ["### LightGBM sensitivity (ΔMAE vs reference)", "", "| window | target | " + " | ".join(("lgbm_quantile",) + SENSITIVITY) + " |", "|---|---|" + "---|" * (1 + len(SENSITIVITY))]
        for window, results in sens.items():
            for target in SUMMARY_TARGETS:
                result = results.get(target)
                if result is None:
                    continue
                cells = [interval(result["methods"][m], "mae") if "mae_rel" in result["methods"][m] else "ref" for m in ("lgbm_quantile",) + SENSITIVITY]
                lines.append(f"| {window} | {target} | " + " | ".join(cells) + " |")
        sections.append("\n".join(lines))
    if "cold_start_rolling" in report:
        sections.append(summary_table("Cold start, rolling refit (evaluated in week k)", report["cold_start_rolling"]))
        sections.append(summary_table("Cold start, trained once on the first k weeks (evaluated on the test window)", report["cold_start_frozen"]))
    timing_lines = ["### Timings per baby (whole history)", "", "| target | model | train rows | fit ms | predict ms | size KB |", "|---|---|---:|---:|---:|---:|"]
    for target, models in report["timings"].items():
        for model, values in models.items():
            timing_lines.append(
                f"| {target} | {model} | {values['train_rows']} | {values['fit_ms']:.0f} | {values['predict_ms']:.2f} | {values['size_kb']:.0f} |"
            )
    timing_lines.append("")
    timing_lines.append(f"Feature building: {report['feature_ms_per_point']:.1f} ms per decision point; peak memory {fmt(report['peak_memory_mb'])} MB.")
    sections.append("\n".join(timing_lines))
    (out / "results.md").write_text("\n\n".join(sections) + "\n", encoding="utf-8")
    print(f"wrote {out / 'results.json'} and results.md in {report['total_seconds']:.0f}s", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
