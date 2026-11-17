"""Run the Rust core through `newvoice-cli`."""

from __future__ import annotations

import json
import subprocess
import tempfile
from functools import cache
from pathlib import Path

from validation import synth
from validation.corpus import REPO_ROOT, Case

CORE_DIR = REPO_ROOT / "core"
CLI = CORE_DIR / "target" / "release" / "newvoice-cli"


@cache
def build() -> Path:
    """Builds the CLI in release mode (once per process) and returns its path."""
    result = subprocess.run(
        ["cargo", "build", "--release", "--locked", "-p", "newvoice-cli"],
        cwd=CORE_DIR,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        raise RuntimeError(f"building newvoice-cli failed:\n{result.stderr}")
    return CLI


def run(command: str, wav: Path, *options: str) -> dict | None:
    out = subprocess.run(
        [str(build()), command, str(wav), *options],
        check=True,
        capture_output=True,
        text=True,
    )
    return json.loads(out.stdout)


def on_case(case: Case, command: str, *options: str) -> dict | None:
    with tempfile.TemporaryDirectory() as tmp:
        wav = Path(tmp) / f"{case.name}.wav"
        synth.write_wav(wav, case.signal, case.rate)
        return run(command, wav, *options)
