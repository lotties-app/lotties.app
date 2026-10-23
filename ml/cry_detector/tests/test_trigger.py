"""The sustained-cry trigger on synthetic score sequences (hop 1 s for readable numbers)."""

import numpy as np
import pytest

from cry_detector.metrics import match, summarise
from cry_detector.trigger import TriggerParams, detect, smooth_scores, windows_for

HOP = 1.0
P = TriggerParams(threshold=0.5, need_s=20, window_s=30, quiet_s=60)


def seq(*parts):
    """seq((0.0, 100), (0.9, 40)) -> 100 windows at 0.0 then 40 at 0.9."""
    return np.concatenate([np.full(n, v, dtype=float) for v, n in parts])


def test_silence_never_triggers():
    assert detect(seq((0.0, 3600)), P, HOP) == []


def test_sustained_cry_triggers_once_after_need_seconds():
    events = detect(seq((0.0, 100), (0.9, 120), (0.0, 200)), P, HOP)
    assert len(events) == 1
    e = events[0]
    assert e.start_s == 100  # started_at = first active window
    assert e.trigger_s == 120  # 20 active seconds -> decided at the end of the 20th active window
    assert e.end_s == 220  # ended_at = end of the last active window
    assert e.closed_s == 280  # known after 60 s of quiet


def test_short_burst_below_need_does_not_trigger():
    assert detect(seq((0.0, 50), (0.9, 19), (0.0, 100)), P, HOP) == []


def test_intermittent_cry_counts_active_seconds_in_window():
    # 2 s on / 1 s off: 20 active seconds need about 30 s of wall time, so it triggers within the 30 s window.
    pattern = np.tile([0.9, 0.9, 0.0], 40)
    events = detect(np.concatenate([np.zeros(10), pattern, np.zeros(100)]), P, HOP)
    assert len(events) == 1
    assert events[0].trigger_s - 10 <= 30


def test_sparse_cry_below_ratio_never_triggers():
    # 1 s on / 2 s off: at most 10 of 30 s active.
    pattern = np.tile([0.9, 0.0, 0.0], 200)
    assert detect(pattern, P, HOP) == []


def test_pause_shorter_than_quiet_keeps_one_event():
    events = detect(seq((0.9, 60), (0.0, 50), (0.9, 60), (0.0, 100)), P, HOP)
    assert len(events) == 1
    assert events[0].end_s == 170


def test_pause_longer_than_quiet_makes_two_events():
    events = detect(seq((0.9, 60), (0.0, 70), (0.9, 60), (0.0, 100)), P, HOP)
    assert [round(e.start_s) for e in events] == [0, 130]


def test_cry_running_at_stream_end_closes_at_end():
    events = detect(seq((0.0, 10), (0.9, 40)), P, HOP)
    assert len(events) == 1 and events[0].closed_s == 50


def test_threshold_is_inclusive():
    assert len(detect(seq((0.5, 25)), P, HOP)) == 1
    assert detect(seq((0.4999, 25)), P, HOP) == []


def test_smoothing_bridges_single_dips():
    s = np.tile([0.9, 0.9, 0.9, 0.2], 20)
    raw = TriggerParams(threshold=0.6, need_s=30, window_s=30, quiet_s=60, smooth=1)
    smoothed = TriggerParams(threshold=0.6, need_s=30, window_s=30, quiet_s=60, smooth=4)
    assert detect(s, raw, HOP) == []
    assert len(detect(s, smoothed, HOP)) == 1


def test_smooth_is_causal_moving_average():
    np.testing.assert_allclose(smooth_scores(np.array([0, 1, 1, 0.0]), 2), [0, 0.5, 1, 0.5])


def test_parameter_guards():
    with pytest.raises(ValueError):
        windows_for(TriggerParams(threshold=0.5, need_s=40, window_s=30), HOP)
    with pytest.raises(ValueError):
        windows_for(TriggerParams(threshold=0.5, need_s=20, window_s=30, quiet_s=10), HOP)


def test_yamnet_hop_rounding():
    m, need, q = windows_for(TriggerParams(threshold=0.5, need_s=20, window_s=30, quiet_s=180), 0.975)
    assert (m, need, q) == (31, 21, 185)


def test_match_detection_latency_and_false_alarms():
    s = seq((0.0, 100), (0.9, 120), (0.0, 400), (0.9, 25), (0.0, 400))
    events = detect(s, P, HOP)
    results, false_alarms = match(events, [(100.0, 220.0)], grace_s=3.0)
    assert results[0].detected and results[0].latency_s == 20 and results[0].start_error_s == 0
    assert len(false_alarms) == 1 and false_alarms[0].start_s == 620
    summary = summarise(results)
    assert summary["detection_rate"] == 1.0 and summary["latency_median_s"] == 20


def test_missed_episode():
    results, false_alarms = match([], [(0.0, 50.0)], grace_s=3.0)
    assert not results[0].detected and false_alarms == []
    assert summarise(results)["detection_rate"] == 0.0


def test_order_and_determinism():
    rng = np.random.default_rng(1)
    s = rng.random(5000)
    assert detect(s, P, HOP) == detect(s.copy(), P, HOP)
