"""Evaluation CLI of the cry detector spike: window metrics, 24 h day simulations, trigger sweep, confusion, AST.

    python -I -m cry_detector.evaluate --cache C:/path/outside/the/repo/cry-cache --out out [--skip-ast] [--quick]

Writes only aggregates (results.json, results.md) to --out. Scored libraries are cached in <cache>/scores (pickles
this harness wrote itself; delete them or pass --rebuild after changing the code).
"""

from __future__ import annotations

import argparse
import json
import pickle
import platform
import sys
import time
from collections import Counter, defaultdict
from dataclasses import asdict, replace
from pathlib import Path

import numpy as np

from . import HOP_S
from . import SAMPLE_RATE as SR
from . import audio as A
from .corpus import Clip, inventory, load
from .fetch import cache_dir
from .library import (
    NEGATIVE_BEDS,
    POSITIVE_CONDITIONS,
    TEST_SIZES,
    VAL_SIZES,
    Item,
    Sizes,
    bed_items,
    episode_items,
    negative_items,
    training_windows,
    trim,
)
from .metrics import match, roc_points, summarise, window_metrics
from .scorers import Yamnet, fit_logistic, log_scores, predict, yamnet_baby, yamnet_cry
from .simulate import MIXES, Composer, attribute, day_plan
from .trigger import TriggerParams, detect

CACHE_VERSION = "v1"
MODELS = ["yamnet_baby", "yamnet_cry", "yamnet_head", "baseline"]
THRESHOLDS = (
    [0.002, 0.005, 0.01, 0.02, 0.03, 0.04]
    + [round(float(t), 2) for t in np.arange(0.05, 0.96, 0.05)]
    + [0.97, 0.98, 0.99, 0.995]
)
NEEDS = [10.0, 15.0, 20.0, 30.0]
WINDOWS = [30.0, 60.0]
SMOOTHS = [1, 3]
QUIET_S = 180.0
FA_BUDGET = 0.5  # false alarms per 24 h on household days (validation) for the standard default
HIGH_FA_BUDGET = 2.0  # the high sensitivity level may spend up to this
PRODUCT_NEEDS = (20.0, 30.0)  # "sustained": the default needs at least 20 s of crying (brief: trigger 20-30 s)
NEAR = ("quiet_near", "white_snr10", "pink_snr10", "fan_snr10", "real:quiet")
GRACE_S = 4 * HOP_S


def cached(path: Path, build, rebuild: bool):
    if path.exists() and not rebuild:
        with path.open("rb") as fh:
            return pickle.load(fh)
    t0 = time.perf_counter()
    value = build()
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("wb") as fh:
        pickle.dump(value, fh, protocol=pickle.HIGHEST_PROTOCOL)
    print(f"built {path.name} in {time.perf_counter() - t0:.0f} s", flush=True)
    return value


def build_library(yam: Yamnet, clips: list[Clip], sizes: Sizes, seed: int) -> list[Item]:
    cry = [c for c in clips if c.is_cry]
    items = episode_items(yam, cry, sizes, seed)
    print(f"  episodes: {len(items)}", flush=True)
    items += negative_items(yam, clips, sizes, seed + 1)
    print(f"  + negatives: {len(items)}", flush=True)
    items += bed_items(yam, sizes, seed + 2)
    return items


def model_scores(items: list[Item], head, baseline) -> dict[str, list[np.ndarray]]:
    out: dict[str, list[np.ndarray]] = {m: [] for m in MODELS}
    for it in items:
        m = it.yamnet.astype(np.float32)
        out["yamnet_baby"].append(yamnet_baby(m))
        out["yamnet_cry"].append(yamnet_cry(m))
        out["yamnet_head"].append(predict(head, log_scores(m)))
        out["baseline"].append(predict(baseline, it.feats))
    return out


def flat(items: list[Item], scores: dict[str, list[np.ndarray]], pick) -> tuple[dict[str, np.ndarray], np.ndarray]:
    idx = [k for k, it in enumerate(items) if pick(it)]
    labels = np.concatenate([items[k].labels for k in idx]) if idx else np.zeros(0, np.int8)
    return {m: np.concatenate([scores[m][k] for k in idx]) for m in scores}, labels


def window_report(items, scores, defaults) -> dict:
    """Per model: all test windows, then each positive condition against the negatives and beds of its bed."""
    rep: dict = {}
    s_all, y_all = flat(items, scores, lambda it: True)
    for m in MODELS:
        t = defaults[m].threshold if m in defaults else None
        rep[m] = {"all": window_metrics(s_all[m], y_all, t), "roc": roc_points(s_all[m], y_all)}
        for c in POSITIVE_CONDITIONS:
            neg_bed = c.bed
            s, y = flat(
                items,
                scores,
                lambda it, c=c, b=neg_bed: (it.kind == "episode" and it.condition == c.name)
                or (it.kind == "negative" and it.bed == b)
                or (it.kind == "bed" and it.bed == b),
            )
            rep[m][c.name] = window_metrics(s[m], y, t)
    return rep


def make_days(items, scores, split_seed, positive_days, negative_days):
    composer = Composer(items, scores)
    return [composer.day(*spec) for spec in day_plan(split_seed, positive_days, negative_days)]


def run_days(days, model: str, p: TriggerParams, causes_too: bool = True) -> dict:
    """Detection per condition, false alarms per 24 h per (bed, mix), attribution of every false alarm."""
    det: dict[str, list] = defaultdict(list)
    fa: dict[str, list[int]] = defaultdict(list)
    causes: Counter = Counter()
    for d in days:
        events = detect(d.scores[model], p)
        results, false_alarms = match(events, d.episodes, GRACE_S)
        kind = d.name.split(":")[0]
        if kind == "pos":
            det[d.condition].extend(results)
            fa[f"pos-bed:{d.bed}"].append(len(false_alarms))
        elif kind == "real":
            det[f"real:{d.bed}"].extend(results)
            fa[f"real:{d.bed}"].append(len(false_alarms))
        else:
            fa[f"{d.bed}:{d.mix}"].append(len(false_alarms))
        if causes_too:
            for e in false_alarms:
                causes[attribute(d, e.trigger_s, p.window_s)] += 1
    return {"detection": det, "false_alarms": fa, "causes": causes}


def _rate(run: dict, keys) -> float:
    det = [r for k in keys for r in run["detection"].get(k, [])]
    return float(np.mean([r.detected for r in det])) if det else 0.0


def headline(run: dict) -> dict:
    """The selection numbers: detection over the in-room conditions (the monitor is in the baby's room: near, 10 and
    5 dB SNR, realistic days), over all conditions (adds 0 dB, open and closed door) and over the near ones; false
    alarms per 24 h on household days and on the one-type stress days."""
    conditions = [c.name for c in POSITIVE_CONDITIONS] + [k for k in run["detection"] if k.startswith("real:")]
    usable = [k for k in conditions if not k.endswith(("snr0", "other_room", "door_open"))]
    det = [r for k in usable for r in run["detection"].get(k, [])]
    household = [n for k, v in run["false_alarms"].items() if k.endswith(":household") or k.startswith("real:") for n in v]
    stress = [
        n
        for k, v in run["false_alarms"].items()
        if k.split(":")[0] in NEGATIVE_BEDS and k.split(":")[1] not in ("none", "household")
        for n in v
    ]
    lat = [r.latency_s for r in det if r.detected]
    return {
        "detection_rate": _rate(run, usable),
        "detection_all": _rate(run, conditions),
        "detection_near": _rate(run, NEAR),
        "household_fa_per_24h": float(np.mean(household)) if household else 0.0,
        "stress_fa_per_24h": float(np.mean(stress)) if stress else 0.0,
        "latency_median_s": float(np.median(lat)) if lat else None,
    }


def sweep(days, model: str) -> list[dict]:
    rows = []
    for smooth in SMOOTHS:
        for window in WINDOWS:
            for need in NEEDS:
                if need > window:
                    continue
                for t in THRESHOLDS:
                    p = TriggerParams(threshold=t, need_s=need, window_s=window, quiet_s=QUIET_S, smooth=smooth)
                    rows.append({"params": p, **headline(run_days(days, model, p, causes_too=False))})
    return rows


def _same_rule(r: dict, p: TriggerParams) -> bool:
    return (r["params"].need_s, r["params"].window_s, r["params"].smooth) == (p.need_s, p.window_s, p.smooth)


def choose_standard(rows: list[dict], needs=PRODUCT_NEEDS) -> dict:
    """Household false alarms within budget and N in `needs`; detection within 1 point of the best such rule; then
    the fewest stress-day false alarms; then the highest threshold (margin); then the lowest latency."""
    ok = [r for r in rows if r["household_fa_per_24h"] <= FA_BUDGET and r["params"].need_s in needs]
    if not ok:
        ok = [min(rows, key=lambda r: (r["household_fa_per_24h"], -r["detection_rate"]))]
    best = max(r["detection_rate"] for r in ok)
    near_best = [r for r in ok if r["detection_rate"] >= best - 0.01]
    return min(near_best, key=lambda r: (r["stress_fa_per_24h"], -r["params"].threshold, r["latency_median_s"] or 1e9))


def choose_high(rows: list[dict], standard: TriggerParams) -> dict:
    """Same rule, threshold at most the standard one: the most detections over all conditions within the high budget."""
    ok = [
        r
        for r in rows
        if _same_rule(r, standard) and r["household_fa_per_24h"] <= HIGH_FA_BUDGET and r["params"].threshold <= standard.threshold
    ]
    return max(ok, key=lambda r: (r["detection_all"], r["params"].threshold))


def choose_low(rows: list[dict], standard: TriggerParams) -> dict:
    """Same rule, threshold at least the standard one: the highest that still catches 95 % of near cries."""
    same = [r for r in rows if _same_rule(r, standard)]
    ok = [r for r in same if r["detection_near"] >= 0.95 and r["params"].threshold >= standard.threshold]
    if not ok:
        return next(r for r in same if r["params"].threshold == standard.threshold)
    return max(ok, key=lambda r: r["params"].threshold)


def detection_table(run: dict) -> dict:
    return {k: summarise(v) for k, v in sorted(run["detection"].items())}


def poisson_upper(count: int, days: int, level: float = 0.95) -> float:
    """One-sided upper confidence bound of a Poisson rate per day (0 events in n days gives about 3/n)."""
    from scipy.stats import chi2

    return float(chi2.ppf(level, 2 * (count + 1)) / 2 / max(1, days))


def fa_table(run: dict) -> dict:
    out = {
        k: {"days": len(v), "count": int(sum(v)), "per_24h": float(np.mean(v)), "upper95_per_24h": poisson_upper(int(sum(v)), len(v)), "max": int(max(v))}
        for k, v in sorted(run["false_alarms"].items())
    }
    groups = {
        "all_household": [n for k, v in run["false_alarms"].items() if k.endswith(":household") or k.startswith("real:") for n in v],
        "all_stress": [
            n
            for k, v in run["false_alarms"].items()
            if k.split(":")[0] in NEGATIVE_BEDS and k.split(":")[1] not in ("none", "household")
            for n in v
        ],
        "all_bed_only": [n for k, v in run["false_alarms"].items() if k.endswith(":none") or k.startswith("pos-bed:") for n in v],
    }
    for k, v in groups.items():
        out[k] = {"days": len(v), "count": int(sum(v)), "per_24h": float(np.mean(v)) if v else 0.0, "upper95_per_24h": poisson_upper(int(sum(v)), len(v)), "max": int(max(v)) if v else 0}
    return out


def confusion(items, scores, model: str, threshold: float, labels: list[str] | None) -> dict:
    """Window level, raw scores: share of windows at or over the threshold per negative category, and for YAMNet the
    top-1 AudioSet class of the cry windows it misses."""
    per_cat: dict[str, list[int]] = defaultdict(lambda: [0, 0])
    for k, it in enumerate(items):
        if it.kind == "episode":
            continue
        s = scores[model][k]
        key = f"{it.type}/{it.category}" if it.kind == "negative" else f"bed/{it.condition}"
        per_cat[key][0] += int((s >= threshold).sum())
        per_cat[key][1] += len(s)
    rows = sorted(((k, v[0] / max(1, v[1]), v[1]) for k, v in per_cat.items()), key=lambda r: -r[1])
    out = {"negatives_over_threshold": [{"category": k, "share": round(s, 4), "windows": n} for k, s, n in rows[:15]]}
    if labels:
        missed = Counter()
        caught = Counter()
        for k, it in enumerate(items):
            if it.kind != "episode":
                continue
            m = it.yamnet.astype(np.float32)
            pos = it.labels == 1
            top = m.argmax(axis=1)
            hit = scores[model][k] >= threshold
            missed.update(labels[i] for i in top[pos & ~hit])
            caught.update(labels[i] for i in top[pos & hit])
        total = sum(missed.values())
        out["missed_cry_windows"] = total
        out["missed_top1_class"] = [{"class": c, "share": round(n / max(1, total), 3)} for c, n in missed.most_common(8)]
        out["caught_top1_class"] = [{"class": c, "share": round(n / max(1, sum(caught.values())), 3)} for c, n in caught.most_common(5)]
    return out


def mean_scores_by_category(items, scores, model: str) -> list[dict]:
    acc: dict[str, list[float]] = defaultdict(list)
    for k, it in enumerate(items):
        if it.kind == "negative":
            acc[f"{it.type}/{it.category}"].append(float(np.percentile(scores[model][k], 99)))
    rows = sorted(((c, float(np.mean(v))) for c, v in acc.items()), key=lambda r: -r[1])
    return [{"category": c, "p99_score_mean": round(v, 4)} for c, v in rows[:12]]


# ---------- AST at clip level (its cost rules out continuous use) ----------

_AST = None


def _ast_init(model_path: str, config_path: str, threads: int) -> None:
    global _AST
    from .scorers import Ast

    _AST = Ast(Path(model_path), Path(config_path), threads)


def _ast_score(x: np.ndarray) -> tuple[float, float]:
    p = _AST.probabilities(x[: int(10.24 * SR)])
    return float(p[_AST.baby_cry]), float(max(p[_AST.baby_cry], p[_AST.crying_sobbing]))


def clip_level(cache: Path, yam: Yamnet, head, baseline, test: list[Clip], seed: int, workers: int, skip_ast: bool) -> dict:
    from multiprocessing import get_context

    from .features import features

    rng = np.random.default_rng(seed)
    clips = [c for c in test if c.source != "libri"]
    speech = [c for c in test if c.source == "libri"]
    clips += [speech[int(k)] for k in rng.choice(len(speech), size=min(120, len(speech)), replace=False)]
    signals, labels, cats = [], [], []
    for c in clips:
        x = trim(load(c.path))[: int(10.24 * SR)]
        signals.append(A.set_level(x, -35.0 if c.is_cry else float(rng.uniform(-45, -25))))
        labels.append(int(c.is_cry))
        cats.append(f"{c.group}/{c.category}")
    for _ in range(30):
        signals.append(A.set_level(A.music(int(10 * SR), rng), float(rng.uniform(-45, -30))))
        labels.append(0)
        cats.append("music/music")
    y = np.array(labels)
    out: dict = {"clips": len(signals), "positives": int(y.sum())}
    conditions = {"quiet": ("quiet", -75.0), "fan_snr5": ("fan", -40.0)}
    for name, (bed, db) in conditions.items():
        mixed = []
        for k, x in enumerate(signals):
            r = np.random.default_rng([seed, k])
            n = int(np.ceil(len(x) / 15600)) * 15600
            b = A.bed(bed, n, db, r)
            b[: len(x)] += x
            mixed.append(np.clip(b, -1, 1))
        res: dict[str, np.ndarray] = {}
        yam_max = [yam.scores(x) for x in mixed]
        res["yamnet_baby"] = np.array([float(m[:, 20].max()) for m in yam_max])
        res["yamnet_cry"] = np.array([float(np.maximum(m[:, 19], m[:, 20]).max()) for m in yam_max])
        res["yamnet_head"] = np.array([float(predict(head, log_scores(m)).max()) for m in yam_max])
        res["baseline"] = np.array([float(predict(baseline, features(x)).max()) for x in mixed])
        if not skip_ast:
            t0 = time.perf_counter()
            ctx = get_context("spawn")
            init = (str(cache / "downloads" / "ast_model_quantized.onnx"), str(cache / "downloads" / "ast_config.json"), 2)
            with ctx.Pool(workers, initializer=_ast_init, initargs=init) as pool:
                ast = pool.map(_ast_score, mixed, chunksize=8)
            res["ast_baby"] = np.array([a for a, _ in ast])
            res["ast_cry"] = np.array([b for _, b in ast])
            out.setdefault("ast_seconds", {})[name] = round(time.perf_counter() - t0, 1)
        out[name] = {}
        for m, s in res.items():
            metrics = window_metrics(s, y, None)
            # False positives at the threshold that keeps 90 % of the cry clips: which categories.
            t90 = float(np.percentile(s[y == 1], 10))
            fp = Counter(c for c, v, l in zip(cats, s, y) if l == 0 and v >= t90)
            metrics.update(
                {
                    "threshold_at_recall_0.9": round(t90, 4),
                    "false_positive_clips_at_recall_0.9": int(sum(fp.values())),
                    "negatives": int((y == 0).sum()),
                    "top_false_positive_categories": fp.most_common(6),
                }
            )
            out[name][m] = metrics
    return out


# ---------- report ----------


def to_jsonable(o):
    if isinstance(o, TriggerParams):
        return asdict(o)
    if isinstance(o, dict):
        return {str(k): to_jsonable(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [to_jsonable(v) for v in o]
    if isinstance(o, (np.floating, np.integer)):
        return o.item()
    return o


def markdown(res: dict) -> str:
    lines = ["# Cry detector spike: results", "", f"Generated {res['meta']['generated']} ({res['meta']['python']}).", ""]
    lines += ["## Corpus", "", "| split | source | clips | cry clips |", "|---|---|---|---|"]
    for row in res["corpus"]:
        lines.append(f"| {row['split']} | {row['source']} | {row['clips']} | {row['cry']} |")
    lines += ["", "## Defaults chosen on the validation days", ""]
    lines += [
        "| model | level | params | val in-room det. | val all det. | val household FA/24h | val stress FA/24h | test in-room det. | test all det. | test near det. | test household FA/24h | test stress FA/24h | test latency median s |",
        "|---|---|---|---|---|---|---|---|---|---|---|---|---|",
    ]
    for m, levels in res["defaults"].items():
        for level, d in levels.items():
            p, v, t = d["params"], d["val"], d["test"]
            lines.append(
                f"| {m} | {level} | T={p['threshold']} N={p['need_s']:g} M={p['window_s']:g} smooth={p['smooth']} | "
                f"{v['detection_rate']:.3f} | {v['detection_all']:.3f} | {v['household_fa_per_24h']:.2f} | {v['stress_fa_per_24h']:.2f} | "
                f"{t['detection_rate']:.3f} | {t['detection_all']:.3f} | {t['detection_near']:.3f} | {t['household_fa_per_24h']:.2f} | "
                f"{t['stress_fa_per_24h']:.2f} | {t['latency_median_s'] if t['latency_median_s'] is None else round(t['latency_median_s'], 1)} |"
            )
    for m, block in res["test"].items():
        lines += ["", f"## Test days, {m} at the standard default", "", "| condition | episodes | detected | rate | Wilson 95 % | latency median s | p90 s | start error median s | fragmented |", "|---|---|---|---|---|---|---|---|---|"]

        def fmt(x):
            return f"{x:.1f}" if isinstance(x, (int, float)) else "-"

        for k, v in block["detection"].items():
            lo, hi = v.get("wilson95", (0, 1))
            lines.append(
                f"| {k} | {v.get('episodes')} | {v.get('detected')} | {v.get('detection_rate', 0):.3f} | {lo:.2f}-{hi:.2f} | "
                f"{fmt(v.get('latency_median_s'))} | {fmt(v.get('latency_p90_s'))} | {fmt(v.get('start_error_median_s'))} | {v.get('fragmented')} |"
            )
        lines += ["", "| days | n | false alarms | per 24 h | upper 95 % per 24 h | max in a day |", "|---|---|---|---|---|---|"]
        for k, v in block["false_alarms"].items():
            lines.append(f"| {k} | {v['days']} | {v['count']} | {v['per_24h']:.2f} | {v['upper95_per_24h']:.2f} | {v['max']} |")
        lines += ["", "False alarm causes (segment under the trigger window): " + ", ".join(f"{c[0]}/{c[1]} {n}" for c, n in block["causes"])]
    lines += ["", "## Window metrics (test library, all conditions)", "", "| model | ROC AUC | average precision | best F1 | at default T: precision | recall | FPR |", "|---|---|---|---|---|---|---|"]
    for m, w in res["windows"].items():
        a = w["all"]
        lines.append(
            f"| {m} | {a.get('roc_auc', 0):.4f} | {a.get('average_precision', 0):.4f} | {a.get('best_f1', 0):.3f} | "
            f"{a.get('precision', 0):.3f} | {a.get('recall', 0):.3f} | {a.get('false_positive_rate', 0):.5f} |"
        )
    if "clip_level" in res:
        cl = res["clip_level"]
        lines += ["", f"## Clip level ({cl['clips']} test clips, {cl['positives']} cry)", "", "| condition | model | ROC AUC | AP | FP clips at recall 0.9 | top FP categories |", "|---|---|---|---|---|---|"]
        for cond in ("quiet", "fan_snr5"):
            for m, v in cl[cond].items():
                lines.append(
                    f"| {cond} | {m} | {v.get('roc_auc', 0):.4f} | {v.get('average_precision', 0):.4f} | "
                    f"{v['false_positive_clips_at_recall_0.9']}/{v['negatives']} | {', '.join(f'{c} {n}' for c, n in v['top_false_positive_categories'])} |"
                )
    lines += ["", "## Confusion (window level, raw scores, standard threshold)", ""]
    for m, c in res["confusion"].items():
        lines.append(f"- **{m}**: " + "; ".join(f"{r['category']} {r['share']:.3f}" for r in c["negatives_over_threshold"][:8]))
        if "missed_top1_class" in c:
            lines.append(f"  - missed cry windows {c['missed_cry_windows']}, their YAMNet top-1: " + ", ".join(f"{r['class']} {r['share']}" for r in c["missed_top1_class"]))
    return "\n".join(lines) + "\n"


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--cache")
    ap.add_argument("--out", default="out")
    ap.add_argument("--seed", type=int, default=20261023)
    ap.add_argument("--positive-days", type=int, default=6)
    ap.add_argument("--negative-days", type=int, default=3)
    ap.add_argument("--quick", action="store_true", help="small libraries and few days (smoke run)")
    ap.add_argument("--skip-ast", action="store_true")
    ap.add_argument("--ast-workers", type=int, default=6)
    ap.add_argument("--rebuild", action="store_true")
    args = ap.parse_args(argv)
    cache = cache_dir(args.cache)
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    t_start = time.perf_counter()

    clips = inventory(cache)
    by_split = {s: [c for c in clips if c.split == s] for s in ("train", "val", "test")}
    corpus = [
        {"split": s, "source": src, "clips": sum(c.source == src for c in cs), "cry": sum(c.source == src and c.is_cry for c in cs)}
        for s, cs in by_split.items()
        for src in ("esc50", "donateacry", "libri")
    ]
    val_sizes, test_sizes = (Sizes(4, 6, 4, 4, 3.0), Sizes(6, 8, 5, 5, 4.0)) if args.quick else (VAL_SIZES, TEST_SIZES)
    pos_days, neg_days = (2, 1) if args.quick else (args.positive_days, args.negative_days)
    tag = f"{CACHE_VERSION}{'_quick' if args.quick else ''}_{args.seed}"
    store = cache / "scores"

    yam = Yamnet(cache / "downloads" / "yamnet.tflite")
    train_clips = by_split["train"] if not args.quick else by_split["train"][::8]
    tw_yam, tw_feats, tw_labels, tw_groups = cached(
        store / f"train_windows_{tag}.pkl", lambda: training_windows(yam, train_clips, args.seed), args.rebuild
    )
    keep = tw_labels >= 0
    head = fit_logistic(log_scores(tw_yam[keep]), tw_labels[keep], c=0.05, seed=args.seed)
    baseline = fit_logistic(tw_feats[keep], tw_labels[keep], c=1.0, seed=args.seed)
    train_info = {"windows": int(keep.sum()), "cry_windows": int((tw_labels == 1).sum()), "groups": dict(Counter(tw_groups[keep]))}
    print("train windows", train_info, flush=True)

    val_items = cached(store / f"val_library_{tag}.pkl", lambda: build_library(yam, by_split["val"], val_sizes, args.seed + 1), args.rebuild)
    test_items = cached(store / f"test_library_{tag}.pkl", lambda: build_library(yam, by_split["test"], test_sizes, args.seed + 2), args.rebuild)
    if not yam.labels:
        yam.scores(np.zeros(15600, np.float32))
    val_scores = model_scores(val_items, head, baseline)
    test_scores = model_scores(test_items, head, baseline)

    val_days = make_days(val_items, val_scores, 1, max(2, pos_days // 2), max(1, neg_days - 1))
    test_days = make_days(test_items, test_scores, 2, pos_days, neg_days)
    print(f"days: val {len(val_days)}, test {len(test_days)}", flush=True)

    defaults: dict[str, dict] = {}
    standard: dict[str, TriggerParams] = {}
    sweeps: dict[str, list] = {}
    all_rows: dict[str, list] = {}
    for m in MODELS:
        t0 = time.perf_counter()
        rows = all_rows[m] = sweep(val_days, m)
        best = choose_standard(rows)
        standard[m] = best["params"]
        defaults[m] = {}
        levels = {"high": choose_high(rows, best["params"]), "standard": best, "low": choose_low(rows, best["params"])}
        any_n = choose_standard(rows, needs=tuple(NEEDS))
        levels["any_N"] = any_n
        for level, chosen in levels.items():
            defaults[m][level] = {
                "params": chosen["params"],
                "val": {k: v for k, v in chosen.items() if k != "params"},
                "test": headline(run_days(test_days, m, chosen["params"])),
            }
        # The trade-off curve at the standard N/M/smooth: threshold vs detection and false alarms (validation).
        sweeps[m] = [
            {"threshold": r["params"].threshold, **{k: v for k, v in r.items() if k != "params"}}
            for r in rows
            if _same_rule(r, best["params"])
        ]
        print(f"{m}: standard {best['params'].label()} val {headline(run_days(val_days, m, best['params']))} ({time.perf_counter() - t0:.0f} s)", flush=True)

    test_block = {}
    for m in MODELS:
        run = run_days(test_days, m, standard[m])
        test_block[m] = {
            "params": standard[m],
            "detection": detection_table(run),
            "false_alarms": fa_table(run),
            "causes": run["causes"].most_common(12),
        }
    # Fixed common rule for a like-for-like comparison: N=20 s of M=30 s, smooth 1, each model at its standard T.
    common = {}
    for m in MODELS:
        p = replace(standard[m], need_s=20.0, window_s=30.0, smooth=1)
        rows = [r for r in all_rows[m] if (r["params"].need_s, r["params"].window_s, r["params"].smooth) == (20.0, 30.0, 1)]
        pc = choose_standard(rows, needs=(20.0,))["params"] if rows else p
        common[m] = {"params": pc, "test": headline(run_days(test_days, m, pc))}

    res = {
        "meta": {
            "generated": time.strftime("%Y-%m-%d %H:%M"),
            "python": f"Python {platform.python_version()} on {platform.system()}",
            "seed": args.seed,
            "quick": args.quick,
            "hop_s": HOP_S,
            "grace_s": GRACE_S,
            "quiet_s": QUIET_S,
            "fa_budget_standard": FA_BUDGET,
            "fa_budget_high": HIGH_FA_BUDGET,
            "product_needs": PRODUCT_NEEDS,
            "days": {"val": len(val_days), "test": len(test_days)},
            "library": {
                "val_items": len(val_items),
                "test_items": len(test_items),
                "test_hours": round(sum(it.seconds for it in test_items) / 3600, 1),
            },
            "mixes": MIXES,
            "positive_conditions": [asdict(c) | {"snr_db": c.snr_db} for c in POSITIVE_CONDITIONS],
            "negative_beds": NEGATIVE_BEDS,
            "train": train_info,
        },
        "corpus": corpus,
        "defaults": defaults,
        "common_rule_N20_M30": common,
        "sweeps_val": sweeps,
        "test": test_block,
        "windows": window_report(test_items, test_scores, standard),
        "confusion": {m: confusion(test_items, test_scores, m, standard[m].threshold, yam.labels if m.startswith("yamnet") else None) for m in MODELS},
        "p99_by_category": {m: mean_scores_by_category(test_items, test_scores, m) for m in MODELS},
    }
    if not args.quick:
        res["clip_level"] = cached(
            store / f"clip_level_{tag}{'_noast' if args.skip_ast else ''}.pkl",
            lambda: clip_level(cache, yam, head, baseline, by_split["test"], args.seed + 3, args.ast_workers, args.skip_ast),
            args.rebuild,
        )
    res["meta"]["runtime_s"] = round(time.perf_counter() - t_start)
    (out / "results.json").write_text(json.dumps(to_jsonable(res), indent=1))
    (out / "results.md").write_text(markdown(to_jsonable(res)))
    print(f"wrote {out / 'results.json'} and results.md in {res['meta']['runtime_s']} s")
    return 0


if __name__ == "__main__":
    sys.exit(main())
