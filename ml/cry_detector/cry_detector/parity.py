"""Browser parity: the same signals scored in Python (here) and in headless Chromium (browser/bench.mjs).

    python -I -m cry_detector.parity write --cache C:/cry-cache --dir C:/scratch/bench/signals
    python -I -m cry_detector.parity compare --dir C:/scratch/bench/signals --browser C:/scratch/bench/bench.json

`write` puts 16 kHz float32 signals (two test cry clips, speech, pink noise, synthetic music) and the Python scores
into a scratch directory outside the repository; `compare` prints the largest score differences. The signals are
public dataset clips or synthetic; they stay in the scratch directory.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np

from . import SAMPLE_RATE as SR
from . import audio as A
from .corpus import inventory, load
from .fetch import cache_dir
from .scorers import BABY_CRY, Ast, Yamnet


def write(cache: Path, out: Path) -> None:
    out.mkdir(parents=True, exist_ok=True)
    clips = inventory(cache)
    test = [c for c in clips if c.split == "test"]
    pick = {
        "cry_donateacry": next(c for c in test if c.source == "donateacry"),
        "cry_esc50": next(c for c in test if c.source == "esc50" and c.is_cry),
        "speech": next(c for c in test if c.source == "libri"),
        "dog_esc50": next(c for c in test if c.category == "dog"),
    }
    rng = np.random.default_rng(7)
    signals = {k: A.set_level(load(c.path)[: 8 * SR], -30.0) for k, c in pick.items()}
    signals["pink"] = A.bed("pink", 5 * SR, -40.0, rng)
    signals["music"] = A.set_level(A.music(8 * SR, rng), -30.0)
    yam = Yamnet(cache / "downloads" / "yamnet.tflite")
    ast = Ast(cache / "downloads" / "ast_model_quantized.onnx", cache / "downloads" / "ast_config.json", threads=4)
    expected = {}
    for name, x in signals.items():
        x = np.ascontiguousarray(x, dtype=np.float32)
        (out / f"{name}.f32").write_bytes(x.tobytes())
        m = yam.scores(x)
        p = ast.probabilities(x)
        expected[name] = {
            "samples": int(x.size),
            "yamnet_baby": [round(float(v), 6) for v in m[:, BABY_CRY]],
            "yamnet_top1": [yam.labels[int(i)] for i in m.argmax(axis=1)],
            "ast_baby_logit": float(np.log(p[ast.baby_cry] / (1 - p[ast.baby_cry]))),
        }
    (out / "expected.json").write_text(json.dumps({"signals": list(signals), "expected": expected}, indent=1))
    print(f"wrote {len(signals)} signals to {out}")


def compare(out: Path, browser: Path) -> dict:
    expected = json.loads((out / "expected.json").read_text())["expected"]
    got = json.loads(browser.read_text())
    rows = {}
    for name, e in expected.items():
        b = got["yamnet"]["parity"].get(name)
        row = {}
        if b:
            n = min(len(b), len(e["yamnet_baby"]))
            diff = np.abs(np.array(b[:n]) - np.array(e["yamnet_baby"][:n]))
            row["yamnet_windows"] = n
            row["yamnet_baby_max_abs_diff"] = float(diff.max()) if n else None
        a = got.get("ast", {}).get("parity", {}).get(name)
        if a is not None:
            row["ast_baby_logit_python"] = round(e["ast_baby_logit"], 3)
            row["ast_baby_logit_browser"] = round(a, 3)
        rows[name] = row
    print(json.dumps(rows, indent=1))
    return rows


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("action", choices=["write", "compare"])
    ap.add_argument("--cache")
    ap.add_argument("--dir", required=True)
    ap.add_argument("--browser")
    args = ap.parse_args(argv)
    if args.action == "write":
        write(cache_dir(args.cache), Path(args.dir))
    else:
        compare(Path(args.dir), Path(args.browser))
    return 0


if __name__ == "__main__":
    sys.exit(main())
