"""The sustained-cry trigger: the rule a device would run on the stream of window scores (pure, causal, no I/O).

Per window: smoothed score (causal moving average over `smooth` windows) >= `threshold` makes the window "active".
A cry starts when at least `need_s` seconds of the last `window_s` seconds are active; the device decides at the end
of that window (`trigger_s`), and `start_s` is the start of the first active window inside those `window_s` seconds
(the `started_at` the event gets). It ends after `quiet_s` seconds without an active window: `end_s` is the end of the
last active window (`ended_at`), `closed_s` when the device knows (end + quiet, or the end of the stream).
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np

from . import HOP_S


@dataclass(frozen=True)
class TriggerParams:
    threshold: float
    need_s: float = 20.0
    window_s: float = 30.0
    quiet_s: float = 180.0
    smooth: int = 1

    def label(self) -> str:
        return f"T={self.threshold:.2f} N={self.need_s:g}s M={self.window_s:g}s Q={self.quiet_s:g}s smooth={self.smooth}"


@dataclass(frozen=True)
class CryEvent:
    trigger_s: float
    start_s: float
    end_s: float
    closed_s: float


def smooth_scores(scores: np.ndarray, k: int) -> np.ndarray:
    s = np.asarray(scores, dtype=np.float64)
    if k <= 1 or s.size == 0:
        return s
    c = np.concatenate([[0.0], np.cumsum(s)])
    i = np.arange(s.size)
    lo = np.maximum(0, i - k + 1)
    return (c[i + 1] - c[lo]) / (i + 1 - lo)


def windows_for(params: TriggerParams, hop: float = HOP_S) -> tuple[int, int, int]:
    m = max(1, round(params.window_s / hop))
    need = max(1, math.ceil(params.need_s / hop - 1e-9))
    q = max(1, math.ceil(params.quiet_s / hop - 1e-9))
    if need > m:
        raise ValueError("need_s must not exceed window_s")
    if q < m:
        raise ValueError("quiet_s must be at least window_s, so a new cry is counted from fresh windows")
    return m, need, q


def detect(scores: np.ndarray, params: TriggerParams, hop: float = HOP_S) -> list[CryEvent]:
    n = len(scores)
    if n == 0:
        return []
    m, need, q = windows_for(params, hop)
    active = smooth_scores(scores, params.smooth) >= params.threshold
    act = np.flatnonzero(active)
    if act.size < need:
        return []
    csum = np.concatenate([[0], np.cumsum(active)])
    i = np.arange(n)
    count = csum[i + 1] - csum[np.maximum(0, i - m + 1)]
    candidates = np.flatnonzero(count >= need)
    big_gaps = np.flatnonzero(np.diff(act) - 1 >= q)  # act[u] is the last active window before a quiet period
    events: list[CryEvent] = []
    pos = 0
    while True:
        k = np.searchsorted(candidates, pos)
        if k == candidates.size:
            break
        j = int(candidates[k])
        first = int(act[np.searchsorted(act, max(j - m + 1, pos))])
        t = int(np.searchsorted(act, j, side="right") - 1)  # last active window at or before j
        g = np.searchsorted(big_gaps, t)
        last = int(act[big_gaps[g]]) if g < big_gaps.size else int(act[-1])
        closed = min(last + q + 1, n)
        events.append(CryEvent((j + 1) * hop, first * hop, (last + 1) * hop, closed * hop))
        pos = last + q + 1
        if pos >= n:
            break
    return events
