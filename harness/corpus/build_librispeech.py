"""Build the real-speech validation subset from LibriSpeech dev-clean.

LibriSpeech (Panayotov, Chen, Povey & Khudanpur 2015, ICASSP) is read
English audiobook speech, CC BY 4.0, so a small subset may be committed with
attribution (see corpus/librispeech/README.md and NOTICE). Committing it
keeps CI offline and the golden tests reproducible.

The subset is the first 10 men and first 10 women by speaker ID, one
utterance each: the first, in file order, lasting 3.5-6 s. The FLAC files
are copied byte for byte from the tarball, pinned by SHA-256.

Usage (from harness/):
    uv run python -m corpus.build_librispeech           # (re)build the subset
    uv run python -m corpus.build_librispeech --check   # verify committed files
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
import tarfile
import urllib.request
from pathlib import Path

import parselmouth

URL = "https://www.openslr.org/resources/12/dev-clean.tar.gz"
SHA256 = "76f87d090650617fca0cac8f88b9416e0ebf80350acb97b343a85fa903728ab3"

HARNESS_DIR = Path(__file__).resolve().parent.parent
CACHE_PATH = HARNESS_DIR / ".cache" / "dev-clean.tar.gz"
OUT_DIR = HARNESS_DIR / "corpus" / "librispeech"
MANIFEST = OUT_DIR / "manifest.json"

PER_SEX = 10
MIN_S, MAX_S = 3.5, 6.0


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def fetch(cache: Path = CACHE_PATH) -> Path:
    if not cache.exists():
        cache.parent.mkdir(parents=True, exist_ok=True)
        tmp = cache.with_suffix(".part")
        with urllib.request.urlopen(URL, timeout=120) as r, tmp.open("wb") as f:
            while chunk := r.read(1 << 20):
                f.write(chunk)
        tmp.rename(cache)
    h = hashlib.sha256()
    with cache.open("rb") as f:
        while chunk := f.read(1 << 20):
            h.update(chunk)
    if h.hexdigest() != SHA256:
        raise SystemExit(f"{cache}: SHA-256 mismatch; delete it and rerun")
    return cache


def duration_s(flac: bytes) -> float:
    tmp = HARNESS_DIR / ".cache" / "probe.flac"
    tmp.write_bytes(flac)
    try:
        return parselmouth.Sound(str(tmp)).duration
    finally:
        tmp.unlink()


def select(tar_path: Path) -> list[dict]:
    with tarfile.open(tar_path) as tar:
        members = {m.name: m for m in tar.getmembers() if m.isfile()}

        def read(name: str) -> bytes:
            return tar.extractfile(members[name]).read()

        sexes = {}
        for line in read("LibriSpeech/SPEAKERS.TXT").decode().splitlines():
            parts = [p.strip() for p in line.split("|")]
            if len(parts) >= 3 and parts[2] == "dev-clean":
                sexes[parts[0]] = parts[1]
        chosen = []
        for sex in ("M", "F"):
            speakers = sorted((s for s, x in sexes.items() if x == sex), key=int)[:PER_SEX]
            for spk in speakers:
                flacs = sorted(
                    n
                    for n in members
                    if n.startswith(f"LibriSpeech/dev-clean/{spk}/") and n.endswith(".flac")
                )
                for name in flacs:
                    data = read(name)
                    dur = duration_s(data)
                    if MIN_S <= dur <= MAX_S:
                        utt = Path(name).stem
                        trans_name = str(
                            Path(name).parent / f"{'-'.join(utt.split('-')[:2])}.trans.txt"
                        )
                        text = next(
                            line.split(" ", 1)[1]
                            for line in read(trans_name).decode().splitlines()
                            if line.startswith(utt + " ")
                        )
                        chosen.append(
                            {
                                "file": f"{utt}.flac",
                                "speaker": spk,
                                "sex": sex,
                                "duration_s": round(dur, 3),
                                "sha256": sha256(data),
                                "transcript": text,
                                "_data": data,
                            }
                        )
                        break
    return chosen


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--check", action="store_true", help="verify the committed files")
    args = parser.parse_args(argv)

    if args.check:
        manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
        bad = [
            u["file"]
            for u in manifest["utterances"]
            if not (OUT_DIR / u["file"]).exists()
            or sha256((OUT_DIR / u["file"]).read_bytes()) != u["sha256"]
        ]
        for f in bad:
            print(f"{OUT_DIR / f}: missing or modified")
        print(
            "LibriSpeech subset OK"
            if not bad
            else "rebuild: uv run python -m corpus.build_librispeech"
        )
        return 1 if bad else 0

    chosen = select(fetch())
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for old in OUT_DIR.glob("*.flac"):
        old.unlink()
    for u in chosen:
        (OUT_DIR / u["file"]).write_bytes(u.pop("_data"))
    manifest = {
        "source": {
            "corpus": "LibriSpeech dev-clean",
            "citation": "Panayotov, V., Chen, G., Povey, D., & Khudanpur, S. (2015). "
            "LibriSpeech: an ASR corpus based on public domain audio books. ICASSP.",
            "license": "CC BY 4.0",
            "url": URL,
            "sha256": SHA256,
        },
        "selection": f"First {PER_SEX} men and {PER_SEX} women by speaker ID; per speaker "
        f"the first utterance in file order lasting {MIN_S}-{MAX_S} s; files unmodified.",
        "utterances": chosen,
    }
    MANIFEST.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"wrote {len(chosen)} utterances to {OUT_DIR}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
