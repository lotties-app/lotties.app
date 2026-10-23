"""The evaluated detectors.

- YAMNet through MediaPipe Tasks (the same .tflite and Tasks version as @mediapipe/tasks-audio in the browser): 521
  AudioSet class scores per 0.975 s window. Cry scores read from it: `yamnet_baby` (class 20 "Baby cry, infant cry"),
  `yamnet_cry` (max of 19 "Crying, sobbing" and 20) and `yamnet_head` (a logistic regression over the 521 log-scores,
  trained on the train split; 522 numbers that ship next to the model).
- `baseline`: the hand-made features (features.py) and a logistic regression.
- AST (Audio Spectrogram Transformer, int8 ONNX of Transformers.js): one 10.24 s window per call, clip level only
  (its cost rules out continuous use, see the report).
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

from . import SAMPLE_RATE

BABY_CRY = 20
CRYING_SOBBING = 19


class Yamnet:
    def __init__(self, model_path: Path):
        from mediapipe.tasks.python import audio as mp_audio
        from mediapipe.tasks.python.components.containers import audio_data
        from mediapipe.tasks.python.core import base_options

        self._audio_data = audio_data
        options = mp_audio.AudioClassifierOptions(
            base_options=base_options.BaseOptions(model_asset_path=str(model_path)),
            max_results=-1,
            running_mode=mp_audio.RunningMode.AUDIO_CLIPS,
        )
        self._clf = mp_audio.AudioClassifier.create_from_options(options)
        self.labels: list[str] = []

    def scores(self, x: np.ndarray) -> np.ndarray:
        """(windows, 521) float32 class scores of consecutive 0.975 s windows."""
        data = self._audio_data.AudioData.create_from_array(np.ascontiguousarray(x, dtype=np.float32), SAMPLE_RATE)
        results = self._clf.classify(data)
        out = np.zeros((len(results), 521), dtype=np.float32)
        for i, r in enumerate(results):
            cats = r.classifications[0].categories
            if not self.labels:
                names = sorted((c.index, c.category_name) for c in cats)
                self.labels = [n for _, n in names]
            for c in cats:
                out[i, c.index] = c.score
        return out


def log_scores(m: np.ndarray) -> np.ndarray:
    return np.log(np.clip(m.astype(np.float32), 1e-4, 1.0))


def yamnet_baby(m: np.ndarray) -> np.ndarray:
    return m[:, BABY_CRY].astype(np.float32)


def yamnet_cry(m: np.ndarray) -> np.ndarray:
    return np.maximum(m[:, BABY_CRY], m[:, CRYING_SOBBING]).astype(np.float32)


def fit_logistic(x: np.ndarray, y: np.ndarray, c: float = 0.1, seed: int = 0):
    model = make_pipeline(
        StandardScaler(),
        LogisticRegression(C=c, max_iter=2000, class_weight="balanced", random_state=seed),
    )
    model.fit(x, y)
    return model


def predict(model, x: np.ndarray) -> np.ndarray:
    if len(x) == 0:
        return np.zeros(0, dtype=np.float32)
    return model.predict_proba(x)[:, 1].astype(np.float32)


class Ast:
    """AST via onnxruntime on the same int8 ONNX file Transformers.js loads."""

    def __init__(self, model_path: Path, config_path: Path, threads: int = 1):
        import onnxruntime as ort

        options = ort.SessionOptions()
        options.intra_op_num_threads = threads
        self._sess = ort.InferenceSession(str(model_path), options, providers=["CPUExecutionProvider"])
        labels = json.loads(Path(config_path).read_text())["id2label"]
        self.labels = [labels[str(i)] for i in range(len(labels))]
        self.baby_cry = self.labels.index("Baby cry, infant cry")
        self.crying_sobbing = self.labels.index("Crying, sobbing")

    def probabilities(self, x: np.ndarray) -> np.ndarray:
        from .ast_features import input_values

        logits = self._sess.run(None, {"input_values": input_values(x)})[0][0]
        return (1 / (1 + np.exp(-logits))).astype(np.float32)
