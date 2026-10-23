"""Pinned public sources of the cry detector spike (docs/design/31-cry-detector-spike.md).

Everything here is downloaded into a cache directory OUTSIDE the repository (`--cache` or `BR_CRY_CACHE`) and is
never committed. Archive checksums are SHA-256 of the files as downloaded on 2026-10-23. GitHub regenerates archive
zips on demand, so an archive checksum can drift while the content stays the same; the content digest (SHA-256 over
the sorted list of audio file names and their SHA-256) is the strict check.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Source:
    key: str
    url: str
    filename: str
    sha256: str
    size: int
    licence: str
    note: str
    archive: bool = False
    # SHA-256 over "name sha256\n" lines of the extracted audio files, sorted by relative path (None for models).
    content_digest: str | None = None
    audio_glob: str | None = None


SOURCES: dict[str, Source] = {
    "yamnet": Source(
        key="yamnet",
        url="https://storage.googleapis.com/mediapipe-models/audio_classifier/yamnet/float32/1/yamnet.tflite",
        filename="yamnet.tflite",
        sha256="4d8b4a53282dc83ef04e3e7dbc4fbc98082e34e44ed798e16c3a0cdd4c584faf",
        size=4_126_810,
        licence=(
            "Apache-2.0 (tensorflow/models research/audioset/yamnet; Kaggle google/yamnet lists all variants as "
            "Apache 2.0); the MediaPipe page for this file names no licence"
        ),
        note="MediaPipe Tasks Audio Classifier model (YAMNet, float32, 521 AudioSet classes, 15600-sample input)",
    ),
    "ast": Source(
        key="ast",
        url=(
            "https://huggingface.co/Xenova/ast-finetuned-audioset-10-10-0.4593/resolve/"
            "249a1fbf0286b40e7f1ed687a8ae396997bf7dc6/onnx/model_quantized.onnx"
        ),
        filename="ast_model_quantized.onnx",
        sha256="807d244b58a30eaa89f0a721fb841619c696857aabe4eac93769bd0b61497f61",
        size=90_807_386,
        licence="BSD-3-Clause (MIT/ast-finetuned-audioset-10-10-0.4593 model card); ONNX conversion by Xenova, no own licence",
        note="Audio Spectrogram Transformer fine-tuned on AudioSet, int8 ONNX for Transformers.js",
    ),
    "ast_config": Source(
        key="ast_config",
        url=(
            "https://huggingface.co/Xenova/ast-finetuned-audioset-10-10-0.4593/resolve/"
            "249a1fbf0286b40e7f1ed687a8ae396997bf7dc6/config.json"
        ),
        filename="ast_config.json",
        sha256="49d0dce922da23685787c73a874d9b1ffa97297f8cc4dc0a4e8bef219725e44d",
        size=26_792,
        licence="BSD-3-Clause",
        note="AST label map (id2label)",
    ),
    "esc50": Source(
        key="esc50",
        url="https://codeload.github.com/karolpiczak/ESC-50/zip/33c8ce9eb2cf0b1c2f8bcf322eb349b6be34dbb6",
        filename="esc50.zip",
        sha256="661183a6f53ef04f12c9bd618fed0ddc1713280d6c94a5a5431e844ba6f6a21f",
        size=645_832_161,
        licence="CC BY-NC 3.0 (dataset); per-clip Freesound licences in its LICENSE file; ESC-10 subset CC BY 3.0",
        note="2000 clips x 5 s, 50 classes, 5 folds; evaluation use only (non-commercial), never redistributed",
        archive=True,
        content_digest="935960232306eaa62d763c72623d74ec4e1d4682c06ca099ce027bfa442aa536",
        audio_glob="**/audio/*.wav",
    ),
    "donateacry": Source(
        key="donateacry",
        url="https://codeload.github.com/gveres/donateacry-corpus/zip/6baf5aca0460964ad072653585837f968a87c2af",
        filename="donateacry.zip",
        sha256="c8a817fcba88f2208e33ed31558eea93de46426fab059179d0369f188e4f8d27",
        size=70_916_240,
        licence="ODbL 1.0 (database) + DbCL 1.0 (contents)",
        note="Donate-a-cry corpus, cleaned set: 457 user-uploaded infant cry clips, 8 kHz, about 7 s",
        archive=True,
        content_digest="c9d7c0600c257c94f4c551cd31f5b4891fb9fe082afad931e30173333693ce3b",
        audio_glob="**/donateacry_corpus_cleaned_and_updated_data/*/*.wav",
    ),
    "minilibrispeech": Source(
        key="minilibrispeech",
        url="https://www.openslr.org/resources/31/dev-clean-2.tar.gz",
        filename="dev-clean-2.tar.gz",
        sha256="176ec501490eced2d6c1f89f4f0ddc7dfe799e649e5322f8ba49fe3ff50c8012",
        size=126_046_265,
        licence="CC BY 4.0 (OpenSLR SLR31, derived from LibriVox public-domain recordings)",
        note="Mini LibriSpeech dev-clean-2: adult read speech, 16 kHz FLAC",
        archive=True,
        content_digest="c474f14e3de92d82c106030972d3cc3e71333b72f655c65571eb66a8e49b9c35",
        audio_glob="**/*.flac",
    ),
}

NOT_USED = {
    "audioset": (
        "AudioSet 'Baby cry, infant cry' segments: the dataset is YouTube video ids plus labels (CC BY 4.0); the audio "
        "itself is only obtainable by downloading YouTube videos, which YouTube's terms do not allow. Skipped."
    ),
    "urbansound8k": "children_playing class would be a useful hard negative; 6 GB, CC BY-NC 3.0; not used in this spike.",
    "tv": "TV or film audio (which often contains crying babies) has no licensed source here; not evaluated.",
}
