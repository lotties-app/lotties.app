"""Day composition and false-alarm attribution on a fake library (no audio, no model)."""

import numpy as np

from cry_detector import HOP_S
from cry_detector.library import Item
from cry_detector.metrics import match
from cry_detector.simulate import DAY_WINDOWS, MIN_EPISODE_GAP, Composer, attribute
from cry_detector.trigger import TriggerParams, detect


def item(kind, condition, bed, type_, n, score, truth=None):
    labels = np.zeros(n, dtype=np.int8)
    if truth:
        labels[truth[0] : truth[1]] = 1
    it = Item(kind, condition, bed, type_, type_, labels, truth, np.zeros((n, 521), np.float16), np.zeros((n, 14), np.float32), n * HOP_S)
    return it, np.full(n, score, dtype=np.float32)


def library():
    items, scores = [], []
    for k in range(10):  # cry episodes of about 2 min, 2 windows of bed on each side
        it, s = item("episode", "fan_snr5", "fan", "cry", 128, 0.0, (2, 126))
        s[2:126] = 0.9
        items.append(it)
        scores.append(s)
    for k in range(5):  # loud "music" that looks like crying for 40 s
        it, s = item("negative", "fan", "fan", "music", 45, 0.9)
        items.append(it)
        scores.append(s)
    it, s = item("bed", "fan@-40", "fan", "bed", 600, 0.01)
    items.append(it)
    scores.append(s)
    return items, {"m": scores}


def test_day_has_episodes_at_known_times_with_minimum_gaps():
    items, scores = library()
    day = Composer(items, scores).day("pos", "fan", -40.0, "none", "fan_snr5", seed=3)
    assert len(day.scores["m"]) == DAY_WINDOWS
    assert len(day.episodes) == 8
    starts = [a for a, _ in day.episodes]
    ends = [b for _, b in day.episodes]
    assert all(s2 - e1 >= MIN_EPISODE_GAP * HOP_S - 1e-6 for e1, s2 in zip(ends, starts[1:]))
    events = detect(day.scores["m"], TriggerParams(threshold=0.5, need_s=20, window_s=30))
    results, false_alarms = match(events, day.episodes, grace_s=4 * HOP_S)
    assert all(r.detected for r in results) and false_alarms == []


def test_same_seed_same_day():
    items, scores = library()
    a = Composer(items, scores).day("pos", "fan", -40.0, "none", "fan_snr5", seed=5)
    b = Composer(items, scores).day("pos", "fan", -40.0, "none", "fan_snr5", seed=5)
    np.testing.assert_array_equal(a.scores["m"], b.scores["m"])
    assert a.episodes == b.episodes


def test_negative_day_false_alarm_is_attributed_to_its_segment():
    items, scores = library()
    day = Composer(items, scores).day("neg", "fan", -40.0, "music", None, seed=1)
    events = detect(day.scores["m"], TriggerParams(threshold=0.5, need_s=20, window_s=30))
    _, false_alarms = match(events, day.episodes, grace_s=4 * HOP_S)
    assert false_alarms, "a 40 s cry-like music stretch must trigger"
    assert {attribute(day, e.trigger_s, 30.0)[0] for e in false_alarms} == {"music"}
