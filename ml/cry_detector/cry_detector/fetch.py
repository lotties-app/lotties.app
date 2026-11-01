"""Download, verify and safely extract the pinned sources into a cache directory outside the repository.

    python -I -m cry_detector.fetch --cache C:/path/outside/the/repo/cry-cache [--only yamnet esc50] [--no-ast]

Downloaded files are untrusted data: archives are extracted with path checks (zip) or the tarfile "data" filter, and
nothing in them is ever executed or imported.
"""

from __future__ import annotations

import argparse
import hashlib
import os
import sys
import tarfile
import urllib.request
import zipfile
from pathlib import Path

from .sources import SOURCES, Source


def sha256_of(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def content_digest(root: Path, pattern: str) -> tuple[str, int]:
    lines = []
    for f in sorted(root.glob(pattern), key=lambda p: p.relative_to(root).as_posix()):
        lines.append(f"{f.name} {sha256_of(f)}\n")
    return hashlib.sha256("".join(lines).encode()).hexdigest(), len(lines)


def cache_dir(arg: str | None) -> Path:
    value = arg or os.environ.get("BR_CRY_CACHE")
    if not value:
        raise SystemExit("set --cache or BR_CRY_CACHE to a directory outside the repository")
    path = Path(value).resolve()
    repo = Path(__file__).resolve().parents[3]
    if path == repo or repo in path.parents:
        raise SystemExit(f"the cache must be outside the repository ({repo})")
    return path


def _download(src: Source, dest: Path) -> None:
    tmp = dest.with_suffix(dest.suffix + ".part")
    with urllib.request.urlopen(src.url, timeout=120) as resp, tmp.open("wb") as out:
        while chunk := resp.read(1 << 20):
            out.write(chunk)
    tmp.replace(dest)


def _extract(archive: Path, dest: Path) -> None:
    dest.mkdir(parents=True, exist_ok=False)
    root = dest.resolve()
    if archive.suffix == ".zip":
        with zipfile.ZipFile(archive) as z:
            for member in z.infolist():
                target = (dest / member.filename).resolve()
                if target != root and root not in target.parents:
                    raise SystemExit(f"unsafe path in {archive.name}: {member.filename}")
            z.extractall(dest)
    else:
        with tarfile.open(archive) as t:
            t.extractall(dest, filter="data")


def fetch(src: Source, cache: Path, strict: bool) -> dict:
    downloads = cache / "downloads"
    downloads.mkdir(parents=True, exist_ok=True)
    file = downloads / src.filename
    if not file.exists():
        print(f"downloading {src.key} from {src.url}")
        _download(src, file)
    digest = sha256_of(file)
    report = {"key": src.key, "file": src.filename, "size": file.stat().st_size, "sha256": digest}
    if src.sha256 and digest != src.sha256:
        message = f"{src.key}: sha256 {digest} differs from the pinned {src.sha256}"
        if strict or not src.archive:
            raise SystemExit(message)
        print("warning:", message, "(GitHub archive; the content digest decides)")
    if src.archive:
        data = cache / "data" / src.key
        if not data.exists():
            _extract(file, data)
        cdigest, count = content_digest(data, src.audio_glob or "**/*")
        report.update({"content_digest": cdigest, "audio_files": count})
        if src.content_digest and cdigest != src.content_digest:
            raise SystemExit(f"{src.key}: content digest {cdigest} differs from the pinned {src.content_digest}")
    return report


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--cache")
    parser.add_argument("--only", nargs="*", choices=sorted(SOURCES))
    parser.add_argument("--no-ast", action="store_true", help="skip the 91 MB AST model")
    parser.add_argument("--strict", action="store_true", help="fail on an archive checksum drift too")
    args = parser.parse_args(argv)
    cache = cache_dir(args.cache)
    keys = args.only or [k for k in SOURCES if not (args.no_ast and k.startswith("ast"))]
    for key in keys:
        report = fetch(SOURCES[key], cache, args.strict)
        print(" ".join(f"{k}={v}" for k, v in report.items()))
    return 0


if __name__ == "__main__":
    sys.exit(main())
