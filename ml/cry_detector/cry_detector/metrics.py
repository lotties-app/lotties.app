"""Window metrics and the product metric (episodes detected, latency, false alarms)."""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from sklearn.metrics import average_precision_score, precision_recall_curve, roc_auc_score, roc_curve

from .trigger import CryEvent


def window_metrics(scores: np.ndarray, labels: np.ndarray, threshold: float | None = None) -> dict:
    """ROC AUC, average precision, best F1 (and its threshold), and precision/recall/F1 at `threshold`."""
    keep = labels >= 0
    s, y = scores[keep].astype(np.float64), labels[keep].astype(int)
    out = {"positives": int(y.sum()), "negatives": int((1 - y).sum())}
    if y.min() == y.max():
        return out
    out["roc_auc"] = float(roc_auc_score(y, s))
    out["average_precision"] = float(average_precision_score(y, s))
    p, r, t = precision_recall_curve(y, s)
    f1 = 2 * p * r / np.maximum(p + r, 1e-12)
    b = int(np.argmax(f1[:-1])) if len(t) else 0
    out.update({"best_f1": float(f1[b]), "best_f1_threshold": float(t[b]) if len(t) else None})
    if threshold is not None:
        pred = s >= threshold
        tp = float((pred & (y == 1)).sum())
        precision = tp / max(1.0, float(pred.sum()))
        recall = tp / max(1.0, float(y.sum()))
        fpr = float((pred & (y == 0)).sum()) / max(1.0, float((y == 0).sum()))
        out.update(
            {
                "threshold": threshold,
                "precision": precision,
                "recall": recall,
                "f1": 2 * precision * recall / max(1e-12, precision + recall),
                "false_positive_rate": fpr,
            }
        )
    return out


def roc_points(scores: np.ndarray, labels: np.ndarray, n: int = 25) -> list[tuple[float, float]]:
    keep = labels >= 0
    fpr, tpr, _ = roc_curve(labels[keep], scores[keep])
    grid = np.unique(np.concatenate([np.geomspace(1e-4, 1, n), [0.0]]))
    return [(float(f), float(np.interp(f, fpr, tpr))) for f in grid]


@dataclass(frozen=True)
class EpisodeResult:
    start_s: float
    end_s: float
    detected: bool
    latency_s: float | None
    start_error_s: float | None
    fragments: int


def match(events: list[CryEvent], episodes: list[tuple[float, float]], grace_s: float) -> tuple[list[EpisodeResult], list[CryEvent]]:
    """An episode is detected when a trigger fires between its start and its end plus `grace_s` (window and
    smoothing lag). Every other trigger is a false alarm."""
    used = set()
    results = []
    for start, end in episodes:
        hits = [k for k, e in enumerate(events) if start <= e.trigger_s <= end + grace_s]
        used.update(hits)
        if hits:
            first = events[hits[0]]
            results.append(EpisodeResult(start, end, True, first.trigger_s - start, first.start_s - start, len(hits)))
        else:
            results.append(EpisodeResult(start, end, False, None, None, 0))
    false_alarms = [e for k, e in enumerate(events) if k not in used]
    return results, false_alarms


def wilson(k: int, n: int, z: float = 1.96) -> tuple[float, float]:
    """95 % Wilson score interval of a proportion."""
    if n == 0:
        return (0.0, 1.0)
    p = k / n
    centre = (p + z * z / (2 * n)) / (1 + z * z / n)
    half = z * np.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / (1 + z * z / n)
    return (round(float(max(0.0, centre - half)), 4), round(float(min(1.0, centre + half)), 4))


def summarise(results: list[EpisodeResult]) -> dict:
    if not results:
        return {"episodes": 0}
    lat = np.array([r.latency_s for r in results if r.detected])
    err = np.array([r.start_error_s for r in results if r.detected])
    k, n = int(sum(r.detected for r in results)), len(results)
    out = {
        "episodes": n,
        "detected": k,
        "detection_rate": k / n,
        "wilson95": wilson(k, n),
        "fragmented": int(sum(r.fragments > 1 for r in results)),
    }
    if lat.size:
        out.update(
            {
                "latency_median_s": float(np.median(lat)),
                "latency_p90_s": float(np.percentile(lat, 90)),
                "start_error_median_s": float(np.median(err)),
            }
        )
    return out
