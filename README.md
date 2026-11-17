# NewVoice

An offline voice-training app for transfeminine and nonbinary voice goals, built for iOS and Android. It gives live feedback on pitch, resonance, vocal weight and intonation relative to your own baseline, and runs a sequenced curriculum with fixed vocal-safety limits. Audio never leaves the device.

NewVoice is an education app. It is not therapy and does not diagnose or treat anything.

**Status:** Stage 1 (analysis core) in progress. Pitch, formants, vocal tract length and the voice-quality measures (H1–H2, alpha ratio, CPPS, HNR, jitter, shimmer, weight index) are built and validated against Praat; see the [report](docs/validation/stage1-synthetic.md). Next: pYIN, the resonance score, and real recordings in the corpus. See [`docs/build-plan.md`](docs/build-plan.md).

## Repository

| Path | What |
|---|---|
| [`core/`](core/) | Rust analysis core (`newvoice-core`), native bindings (`newvoice-ffi`, UniFFI) and a test CLI (`newvoice-cli`) |
| [`app/`](app/) | React Native app (Expo, development build) |
| [`harness/`](harness/) | Python validation harness and reference-norms tooling (test-only, never shipped) |
| [`content/`](content/) | Curriculum JSON and reference norms |
| [`docs/`](docs/) | Domain handbook, tech stack, build plan, [decisions log](docs/decisions.md) |

## Development

Rust (the toolchain is pinned by `core/rust-toolchain.toml`):

```bash
cd core && cargo test --workspace
```

Harness, including the Praat golden tests (needs the Rust toolchain; builds `newvoice-cli`):

```bash
cd harness && uv sync && uv run pytest
```

Validation report (after any analysis change):

```bash
cd harness && uv run python -m validation.report
```

Reference norms:

```bash
cd harness && uv run python -m norms.build_norms
```

App:

```bash
cd app && npm ci && npm run typecheck
```

## License

Apache-2.0. See [`LICENSE`](LICENSE) and [`NOTICE`](NOTICE), which includes the Margarita Clause. The NewVoice name and icon are covered separately; see [`TRADEMARKS.md`](TRADEMARKS.md).
