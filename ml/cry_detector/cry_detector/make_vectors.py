"""Shared test vectors of the sustained-cry trigger for the web port (code/web/src/cry/trigger.ts).

    python -m cry_detector.make_vectors            # writes code/web/src/cry/cryTriggerVectors.json
    python -m cry_detector.make_vectors --check    # exit 1 when the committed file differs from trigger.py's output

Synthetic score sequences only (seeded, no audio, no dataset): quiet, one cry, two cries with a short and a long gap,
flapping around the threshold, a spike shorter than the sustained rule, a long cry with pauses, a cry still running
when the stream ends, a raw (unsmoothed) intermittent pattern, and one faint cry run at the three sensitivity levels.
Every case is run through `trigger.detect` at the real YAMNet hop (0.975 s); the vitest (`trigger.test.ts`) feeds the
same scores to the TypeScript trigger and expects the same events. Scores are written with 4 decimals as a
space-separated string (compact, and both sides parse the same decimal to the same double).
"""

from __future__ import annotations

import argparse
import dataclasses
import json
import sys
from pathlib import Path

import numpy as np

from . import HOP_S
from .trigger import TriggerParams, detect

SEED = 20261024
REPO_ROOT = Path(__file__).resolve().parents[3]
DEFAULT_OUT = REPO_ROOT / "code" / "web" / "src" / "cry" / "cryTriggerVectors.json"

# The product rule (docs/design/31-cry-detector-spike.md section 0) and the sensitivity levels of the build
# (docs/design/35-cry-engine.md): every threshold inside the spike's safe band 0.005-0.03.
DEFAULT = TriggerParams(threshold=0.02, need_s=20.0, window_s=60.0, quiet_s=180.0, smooth=3)
LEVELS = {"less": 0.03, "balanced": 0.02, "more": 0.01}


def _quiet(rng: np.random.Generator, n: int) -> np.ndarray:
    return rng.uniform(0.0, 0.008, n)


def _cry(rng: np.random.Generator, n: int, lo: float = 0.03, hi: float = 0.6, breath: float = 0.12) -> np.ndarray:
    """Cry windows with breath dips: a share of windows falls back to the quiet range."""
    x = rng.uniform(lo, hi, n)
    dips = rng.random(n) < breath
    x[dips] = rng.uniform(0.0, 0.01, int(dips.sum()))
    return x


def _flapping(rng: np.random.Generator, n: int, threshold: float) -> np.ndarray:
    """Scores hovering around the threshold, some exactly on it (the comparison is inclusive)."""
    x = threshold + rng.uniform(-0.01, 0.012, n)
    exact = rng.random(n) < 0.1
    x[exact] = threshold
    return np.clip(x, 0.0, 1.0)


def _cases() -> list[tuple[str, TriggerParams, np.ndarray]]:
    rng = np.random.default_rng(SEED)
    cat = np.concatenate
    cases: list[tuple[str, TriggerParams, np.ndarray]] = []
    cases.append(("quiet", DEFAULT, _quiet(rng, 600)))
    cases.append(("one_cry", DEFAULT, cat([_quiet(rng, 60), _cry(rng, 200), _quiet(rng, 300)])))
    # 120 quiet windows (117 s) < 185 (180 s): one event; 250 (244 s) > 185: two events.
    cases.append(
        ("two_cries_short_gap", DEFAULT, cat([_quiet(rng, 40), _cry(rng, 120), _quiet(rng, 120), _cry(rng, 120), _quiet(rng, 300)]))
    )
    cases.append(
        ("two_cries_long_gap", DEFAULT, cat([_quiet(rng, 40), _cry(rng, 120), _quiet(rng, 250), _cry(rng, 120), _quiet(rng, 250)]))
    )
    cases.append(("flapping", DEFAULT, cat([_quiet(rng, 30), _flapping(rng, 400, DEFAULT.threshold), _quiet(rng, 250)])))
    cases.append(("short_spike", DEFAULT, cat([_quiet(rng, 100), _cry(rng, 15, breath=0.0), _quiet(rng, 200)])))
    long_cry = [_quiet(rng, 30)]
    for _ in range(12):  # about 11 minutes: 50 s of crying, then a 5-10 s pause
        long_cry += [_cry(rng, 52), _quiet(rng, int(rng.integers(5, 11)))]
    long_cry.append(_quiet(rng, 250))
    cases.append(("long_cry", DEFAULT, cat(long_cry)))
    cases.append(("cry_at_stream_end", DEFAULT, cat([_quiet(rng, 50), _cry(rng, 100)])))
    raw = TriggerParams(threshold=0.5, need_s=20.0, window_s=30.0, quiet_s=60.0, smooth=1)
    on_off = np.tile([0.9, 0.9, 0.0], 40)
    cases.append(("raw_intermittent", raw, cat([np.zeros(10), on_off, np.zeros(100), np.tile([0.9, 0.0, 0.0], 60), np.zeros(80)])))
    faint = cat([_quiet(rng, 40), _cry(rng, 150, lo=0.008, hi=0.04, breath=0.2), _quiet(rng, 250)])
    for level, threshold in LEVELS.items():
        cases.append((f"faint_cry_{level}", dataclasses.replace(DEFAULT, threshold=threshold), faint))
    return cases


def _encode(scores: np.ndarray) -> tuple[str, np.ndarray]:
    text = " ".join(f"{v:.4f}" for v in scores)
    return text, np.array([float(v) for v in text.split(" ")], dtype=np.float64)


def build(hop: float = HOP_S) -> dict:
    out_cases = []
    for name, params, scores in _cases():
        text, parsed = _encode(scores)
        events = []
        for e in detect(parsed, params, hop):
            closed = round(e.closed_s / hop)
            events.append(
                {
                    "startWindow": round(e.start_s / hop),
                    "detectedAfterWindow": round(e.trigger_s / hop) - 1,
                    "endWindow": round(e.end_s / hop) - 1,
                    "closedWindows": closed,
                    "closedByStreamEnd": closed == len(parsed),
                    "startS": round(e.start_s, 6),
                    "triggerS": round(e.trigger_s, 6),
                    "endS": round(e.end_s, 6),
                    "closedS": round(e.closed_s, 6),
                }
            )
        out_cases.append(
            {
                "name": name,
                "config": {
                    "threshold": params.threshold,
                    "minSeconds": params.need_s,
                    "windowSeconds": params.window_s,
                    "quietSeconds": params.quiet_s,
                    "smoothing": params.smooth,
                },
                "windows": len(parsed),
                "events": events,
                "scores": text,
            }
        )
    return {
        "description": (
            "Shared vectors of the sustained-cry trigger, written by `python -m cry_detector.make_vectors` "
            "(ml/cry_detector) from cry_detector/trigger.py; read by code/web/src/cry/trigger.test.ts. Window i "
            "starts at i * hopSeconds; startWindow = first active window of the sustained run (started_at), "
            "detectedAfterWindow = the window whose end fires the start, endWindow = last active window (ended_at = "
            "its end), closedWindows = when the end is known (in windows from the stream start; equal to `windows` "
            "when the stream ended first). Do not edit by hand."
        ),
        "seed": SEED,
        "hopSeconds": hop,
        "cases": out_cases,
    }


def render(doc: dict) -> str:
    return json.dumps(doc, indent=2) + "\n"


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--out", type=Path, default=DEFAULT_OUT)
    ap.add_argument("--check", action="store_true", help="compare with the file instead of writing it")
    args = ap.parse_args(argv)
    text = render(build())
    if args.check:
        current = args.out.read_text(encoding="utf-8") if args.out.exists() else None
        if current != text:
            print(f"{args.out} is out of date: run python -m cry_detector.make_vectors", file=sys.stderr)
            return 1
        print(f"{args.out} is up to date")
        return 0
    args.out.write_text(text, encoding="utf-8", newline="\n")
    print(f"wrote {args.out} ({len(text)} bytes, {len(build()['cases'])} cases)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
