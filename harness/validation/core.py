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
WASM_CLI = CORE_DIR / "target" / "wasm32-wasip1" / "release" / "newvoice-cli.wasm"
WASI_RUNNER = REPO_ROOT / "harness" / "tools" / "wasi-run.mjs"


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


@cache
def build_wasm() -> Path:
    """Builds the CLI for WebAssembly (WASI), once per process."""
    result = subprocess.run(
        [
            "cargo",
            "build",
            "--release",
            "--locked",
            "-p",
            "newvoice-cli",
            "--target",
            "wasm32-wasip1",
        ],
        cwd=CORE_DIR,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        raise RuntimeError(f"building newvoice-cli for WASI failed:\n{result.stderr}")
    return WASM_CLI


def run(command: str, wav: Path, *options: str, wasm: bool = False) -> dict | None:
    program = (
        ["node", "--no-warnings", str(WASI_RUNNER), str(build_wasm())] if wasm else [str(build())]
    )
    out = subprocess.run(
        [*program, command, str(wav.resolve()), *options],
        check=True,
        capture_output=True,
        text=True,
    )
    return json.loads(out.stdout)


def on_case(case: Case, command: str, *options: str) -> dict | None:
    return run_signal(case.name, case.signal, case.rate, command, *options)


def run_signal(
    name: str, signal, rate: int, command: str, *options: str, wasm: bool = False
) -> dict | None:
    with tempfile.TemporaryDirectory() as tmp:
        wav = Path(tmp) / f"{name}.wav"
        synth.write_wav(wav, signal, rate)
        return run(command, wav, *options, wasm=wasm)
