"""Clip inventory of the public corpora, with leak-free train / val / test splits.

Splits are by recording group, never by clip: ESC-50 by its own folds (clips cut from one Freesound recording share a
fold), Donate-a-cry by the app-instance id in the file name, Mini LibriSpeech by speaker. Groups are assigned with a
SHA-256 of the group id, so the split never depends on the order of files on disk.
"""

from __future__ import annotations

import csv
import hashlib
from dataclasses import dataclass
from functools import lru_cache
from math import gcd
from pathlib import Path

import numpy as np
import soundfile as sf
from scipy.signal import resample_poly

from . import SAMPLE_RATE

# ESC-50's five major groups (targets 0-9, 10-19, ...). crying_baby (20) is the positive class.
ESC_GROUPS = ["animals", "natural", "human", "domestic", "urban"]
ESC_FOLDS = {1: "train", 2: "train", 3: "val", 4: "test", 5: "test"}


@dataclass(frozen=True)
class Clip:
    id: str
    source: str  # esc50 | donateacry | libri
    category: str  # ESC-50 category, "baby_cry" or "speech"
    group: str  # negative type used in the reports (esc group, "cry", "speech")
    split: str
    path: str
    is_cry: bool


def group_split(group_id: str, train: int = 5, val: int = 2) -> str:
    bucket = int(hashlib.sha256(group_id.encode()).hexdigest(), 16) % 10
    return "train" if bucket < train else "val" if bucket < train + val else "test"


def _one(root: Path, pattern: str) -> Path:
    found = sorted(root.glob(pattern))
    if not found:
        raise FileNotFoundError(f"{pattern} under {root}: run `python -I -m cry_detector.fetch` first")
    return found[0]


def esc50(cache: Path) -> list[Clip]:
    meta = _one(cache / "data" / "esc50", "*/meta/esc50.csv")
    audio = meta.parent.parent / "audio"
    clips = []
    with meta.open(newline="") as fh:
        for row in csv.DictReader(fh):
            target = int(row["target"])
            cry = row["category"] == "crying_baby"
            clips.append(
                Clip(
                    id=f"esc50/{row['filename']}",
                    source="esc50",
                    category=row["category"],
                    group="cry" if cry else ESC_GROUPS[target // 10],
                    split=ESC_FOLDS[int(row["fold"])],
                    path=str(audio / row["filename"]),
                    is_cry=cry,
                )
            )
    return clips


def donateacry(cache: Path) -> list[Clip]:
    root = _one(cache / "data" / "donateacry", "*/donateacry_corpus_cleaned_and_updated_data")
    clips = []
    for f in sorted(root.glob("*/*.wav")):
        instance = f.name[:36]  # app instance id: one installed app, usually one family
        clips.append(
            Clip(
                id=f"donateacry/{f.parent.name}/{f.name}",
                source="donateacry",
                category="baby_cry",
                group="cry",
                split=group_split("dac:" + instance),
                path=str(f),
                is_cry=True,
            )
        )
    return clips


def libri(cache: Path) -> list[Clip]:
    root = _one(cache / "data" / "minilibrispeech", "LibriSpeech/dev-clean-2")
    clips = []
    for f in sorted(root.glob("*/*/*.flac")):
        speaker = f.parent.parent.name
        clips.append(
            Clip(
                id=f"libri/{f.name}",
                source="libri",
                category="speech",
                group="speech",
                split=group_split("libri:" + speaker),
                path=str(f),
                is_cry=False,
            )
        )
    return clips


def inventory(cache: Path) -> list[Clip]:
    return esc50(cache) + donateacry(cache) + libri(cache)


@lru_cache(maxsize=1024)
def load(path: str) -> np.ndarray:
    """Mono float32 at 16 kHz."""
    data, sr = sf.read(path, dtype="float32", always_2d=True)
    x = data.mean(axis=1)
    if sr != SAMPLE_RATE:
        g = gcd(sr, SAMPLE_RATE)
        x = resample_poly(x, SAMPLE_RATE // g, sr // g).astype(np.float32)
    return x
