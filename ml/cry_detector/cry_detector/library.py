"""The scored library: synthetic cry episodes, negative stretches and noise beds, rendered once and scored once.

Long recordings are compositions of library items (simulate.py), so a 24 h day costs nothing to score again. Every
item is rendered over its noise bed with 2 windows of bed before and after, and scored as one piece of audio, so its
windows have real context. Only scores, window labels and features are kept (in memory or in the cache); no audio
leaves this process.

Levels (dBFS of active RMS, see audio.py): a cry near the phone at -35 (about 1 m with a typical phone microphone);
beds at -45 / -40 / -35 for 10 / 5 / 0 dB SNR; room tone at -75; next room with the door open: reverb, cry at -50;
another room behind a closed door: wall filter + reverb, cry at -55.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

from . import SAMPLE_RATE as SR
from . import WINDOW
from . import audio as A
from .corpus import ESC_GROUPS, Clip, load
from .features import features as baseline_features

CRY_NEAR_DB = -35.0
CRY_OTHER_ROOM_DB = -55.0
CRY_DOOR_OPEN_DB = -50.0
QUIET_DB = -75.0
PAD_WINDOWS = 2


@dataclass(frozen=True)
class PositiveCondition:
    name: str
    bed: str
    bed_db: float
    cry_db: float
    other_room: bool = False
    wall: bool = True

    @property
    def snr_db(self) -> float:
        return self.cry_db - self.bed_db


POSITIVE_CONDITIONS = [
    PositiveCondition("quiet_near", "quiet", QUIET_DB, CRY_NEAR_DB),
    *[
        PositiveCondition(f"{bed}_snr{snr}", bed, CRY_NEAR_DB - snr, CRY_NEAR_DB)
        for bed in ("white", "pink", "fan")
        for snr in (10, 5, 0)
    ],
    PositiveCondition("quiet_door_open", "quiet", QUIET_DB, CRY_DOOR_OPEN_DB, other_room=True, wall=False),
    PositiveCondition("fan_door_open", "fan", CRY_DOOR_OPEN_DB - 5, CRY_DOOR_OPEN_DB, other_room=True, wall=False),
    PositiveCondition("quiet_other_room", "quiet", QUIET_DB, CRY_OTHER_ROOM_DB, other_room=True),
    PositiveCondition("fan_other_room", "fan", CRY_OTHER_ROOM_DB - 5, CRY_OTHER_ROOM_DB, other_room=True),
]

# Beds of the negative days: room tone, and the three noise beds at the 5 dB SNR level of a near cry.
NEGATIVE_BEDS = {"quiet": QUIET_DB, "white": -40.0, "pink": -40.0, "fan": -40.0}
NEGATIVE_TYPES = ["speech", "music", *ESC_GROUPS]


@dataclass
class Item:
    kind: str  # episode | negative | bed
    condition: str  # positive condition name, or "<bed>" for negatives and beds
    bed: str
    type: str  # cry | speech | music | an ESC-50 group | bed
    category: str  # ESC-50 category, cry source, speech, music, bed
    labels: np.ndarray  # per window: 1 cry active, 0 negative, -1 ignored (a pause inside a cry)
    truth: tuple[int, int] | None  # episode windows [start, end)
    yamnet: np.ndarray = field(repr=False)  # (windows, 521) float16
    feats: np.ndarray = field(repr=False)  # (windows, 14) float32
    seconds: float = 0.0


@dataclass(frozen=True)
class Sizes:
    episodes: int = 24
    bursts_per_group: int = 40
    speech: int = 30
    music: int = 30
    bed_minutes: float = 20.0


TEST_SIZES = Sizes()
VAL_SIZES = Sizes(episodes=12, bursts_per_group=20, speech=15, music=15, bed_minutes=10.0)


def trim(x: np.ndarray) -> np.ndarray:
    act = A.activity(x, rel_db=35)
    idx = np.flatnonzero(act)
    if idx.size == 0:
        return x
    return x[idx[0] * A.FRAME : (idx[-1] + 1) * A.FRAME]


def cry_track(pool: list[Clip], seconds: float, rng: np.random.Generator) -> np.ndarray:
    """A crying episode: clips in random order with breath gaps (0.2-1.2 s) and a pause of 3-12 s every 30-90 s."""
    pieces, gaps = [], []
    t, next_pause = 0.0, rng.uniform(30, 90)
    while t < seconds:
        x = trim(load(pool[int(rng.integers(len(pool)))].path))
        x = x / (np.sqrt(np.mean(x.astype(np.float64) ** 2)) + 1e-9) * 10 ** (rng.uniform(-3, 3) / 20)
        gap = rng.uniform(0.2, 1.2)
        if t > next_pause:
            gap = rng.uniform(3, 12)
            next_pause = t + rng.uniform(30, 90)
        pieces.append(x.astype(np.float32))
        gaps.append(gap)
        t += len(x) / SR + gap
    y = A.concat(pieces, gaps)[: int(seconds * SR)]
    fade = min(len(y), int(0.05 * SR))
    y[-fade:] *= np.linspace(1, 0, fade)
    return y


def window_activity(track: np.ndarray, n_windows: int, offset: int) -> np.ndarray:
    """Share of active 10 ms frames per window for a track starting `offset` samples into the item."""
    act = A.activity(track).astype(np.float32)
    per_sample = np.zeros(n_windows * WINDOW, dtype=np.float32)
    frames = np.repeat(act, A.FRAME)[: max(0, n_windows * WINDOW - offset)]
    per_sample[offset : offset + len(frames)] = frames
    return per_sample.reshape(n_windows, WINDOW).mean(axis=1)


def _render(signal: np.ndarray, bed: str, bed_db: float, rng: np.random.Generator) -> tuple[np.ndarray, int]:
    pad = PAD_WINDOWS * WINDOW
    total = int(np.ceil((len(signal) + 2 * pad) / WINDOW)) * WINDOW
    y = A.bed(bed, total, bed_db, rng)
    y[pad : pad + len(signal)] += signal
    return np.clip(y, -1, 1), pad


def _score(scorer, y: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    return scorer.scores(y).astype(np.float16), baseline_features(y)


def episode_items(scorer, cry_pool: list[Clip], sizes: Sizes, seed: int) -> list[Item]:
    rng = np.random.default_rng(seed)
    by_source = {s: [c for c in cry_pool if c.source == s] for s in ("donateacry", "esc50")}
    tracks = []
    for k in range(sizes.episodes):
        source = "esc50" if k % 3 == 2 and by_source["esc50"] else "donateacry"
        seconds = float(np.exp(rng.uniform(np.log(60), np.log(600))))
        tracks.append((source, cry_track(by_source[source], seconds, rng)))
    items = []
    for cond in POSITIVE_CONDITIONS:
        crng = np.random.default_rng([seed, POSITIVE_CONDITIONS.index(cond)])
        for source, track in tracks:
            x = A.other_room(track, crng, wall=cond.wall) if cond.other_room else track
            x = A.set_level(x, cond.cry_db)
            y, pad = _render(x, cond.bed, cond.bed_db, crng)
            yam, feats = _score(scorer, y)
            n = len(yam)
            share = window_activity(track, n, pad)
            labels = np.where(share >= 0.3, 1, np.where(share > 0, -1, 0)).astype(np.int8)
            start = PAD_WINDOWS
            end = PAD_WINDOWS + int(np.ceil(len(track) / WINDOW))
            labels[start:end][labels[start:end] == 0] = -1  # pauses inside an episode are neither cry nor negative
            items.append(Item("episode", cond.name, cond.bed, "cry", source, labels, (start, end), yam, feats, len(y) / SR))
    return items


def negative_signal(kind: str, clips: list[Clip], rng: np.random.Generator) -> tuple[np.ndarray, str]:
    if kind == "speech":
        speakers = sorted({Path(c.path).parent.parent.name for c in clips})
        chosen = set(rng.choice(speakers, size=min(len(speakers), int(rng.integers(1, 4))), replace=False))
        pool = [c for c in clips if Path(c.path).parent.parent.name in chosen]
        seconds = rng.uniform(30, 240)
        pieces, t = [], 0.0
        while t < seconds:
            x = load(pool[int(rng.integers(len(pool)))].path)
            pieces.append(x)
            t += len(x) / SR + 0.8
        x = A.concat(pieces, list(rng.uniform(0.3, 1.5, len(pieces))))[: int(seconds * SR)]
        return A.set_level(x, rng.uniform(-42, -30)), "speech"
    if kind == "music":
        x = A.music(int(rng.uniform(30, 240) * SR), rng)
        return A.set_level(x, rng.uniform(-45, -30)), "music"
    categories = sorted({c.category for c in clips if c.group == kind})
    category = categories[int(rng.integers(len(categories)))]
    pool = [c for c in clips if c.category == category]
    k = int(rng.integers(1, 7))
    pieces = [trim(load(pool[int(rng.integers(len(pool)))].path)) for _ in range(k)]
    x = A.concat(pieces, list(rng.uniform(0.0, 1.5, k)))
    return A.set_level(x, rng.uniform(-45, -25)), category


def negative_items(scorer, clips: list[Clip], sizes: Sizes, seed: int) -> list[Item]:
    items = []
    counts = {"speech": sizes.speech, "music": sizes.music, **{g: sizes.bursts_per_group for g in ESC_GROUPS}}
    for bed, bed_db in NEGATIVE_BEDS.items():
        for kind in NEGATIVE_TYPES:
            pool = [c for c in clips if (c.group == kind or (kind == "speech" and c.source == "libri")) and not c.is_cry]
            rng = np.random.default_rng([seed, NEGATIVE_TYPES.index(kind), list(NEGATIVE_BEDS).index(bed)])
            for _ in range(counts[kind]):
                x, category = negative_signal(kind, pool, rng)
                y, _ = _render(x, bed, bed_db, rng)
                yam, feats = _score(scorer, y)
                labels = np.zeros(len(yam), dtype=np.int8)
                items.append(Item("negative", bed, bed, kind, category, labels, None, yam, feats, len(y) / SR))
    return items


def bed_items(scorer, sizes: Sizes, seed: int) -> list[Item]:
    beds = {(c.bed, c.bed_db) for c in POSITIVE_CONDITIONS} | set(NEGATIVE_BEDS.items())
    items = []
    for k, (bed, db) in enumerate(sorted(beds)):
        rng = np.random.default_rng([seed, 99, k])
        y = A.bed(bed, int(sizes.bed_minutes * 60 / (WINDOW / SR)) * WINDOW, db, rng)
        yam, feats = _score(scorer, y)
        name = f"{bed}@{db:g}"
        items.append(Item("bed", name, bed, "bed", "bed", np.zeros(len(yam), np.int8), None, yam, feats, len(y) / SR))
    return items


def training_windows(scorer, clips: list[Clip], seed: int, music_clips: int = 40, speech_clips: int = 300):
    """Windows to fit the YAMNet head and the baseline: every cry clip twice over a random bed at a random SNR
    (-5 to 25 dB, a quarter through the wall filter), every ESC-50 non-cry clip, speech and music once."""
    rng = np.random.default_rng(seed)
    yam, feats, labels, groups = [], [], [], []
    beds = ["quiet", "white", "pink", "fan"]

    def add(signal: np.ndarray, track: np.ndarray | None, group: str) -> None:
        bed = beds[int(rng.integers(len(beds)))]
        bed_db = QUIET_DB if bed == "quiet" else CRY_NEAR_DB - rng.uniform(-5, 25)
        y, pad = _render(signal, bed, bed_db, rng)
        m, f = _score(scorer, y)
        if track is None:
            lab = np.zeros(len(m), dtype=np.int8)
        else:
            share = window_activity(track, len(m), pad)
            lab = np.where(share >= 0.3, 1, np.where(share > 0, -1, 0)).astype(np.int8)
        yam.append(m)
        feats.append(f)
        labels.append(lab)
        groups.extend([group] * len(m))

    for clip in clips:
        if clip.is_cry:
            for _ in range(2):
                track = trim(load(clip.path))
                other = rng.random() < 0.25
                x = A.other_room(track, rng) if other else track
                x = A.set_level(x, (CRY_OTHER_ROOM_DB if other else CRY_NEAR_DB) + rng.uniform(-5, 5))
                add(x, track, "cry")
        elif clip.source == "esc50":
            add(A.set_level(trim(load(clip.path)), rng.uniform(-45, -25)), None, clip.group)
    speech = [c for c in clips if c.source == "libri"]
    for k in rng.choice(len(speech), size=min(speech_clips, len(speech)), replace=False):
        add(A.set_level(load(speech[int(k)].path), rng.uniform(-42, -30)), None, "speech")
    for _ in range(music_clips):
        add(A.set_level(A.music(int(20 * SR), rng), rng.uniform(-45, -30)), None, "music")
    for bed in beds:
        add(np.zeros(int(60 * SR), dtype=np.float32), None, "bed")
    return np.concatenate(yam), np.concatenate(feats), np.concatenate(labels), np.array(groups)
