# NewVoice

An offline voice-training app for transfeminine and nonbinary voice goals, built for iOS and Android. It gives live feedback on pitch, resonance, vocal weight and intonation relative to your own baseline, and runs a sequenced curriculum with fixed vocal-safety limits. Audio never leaves the device.

NewVoice is an education app. It is not therapy and does not diagnose or treat anything.

**Status:** the analysis core (Stage 1) and the feedback engine (Stage 3) are done and validated; see the [synthetic](docs/validation/stage1-synthetic.md), [real-recording](docs/validation/stage1-real.md) and [strain-monitor](docs/validation/stage3-strain.md) reports. The product layer is built in code and waiting on a phone run:

- the app shell, privacy features and baseline capture (Stage 4);
- the curriculum, Units 0–10, with ear training and the hard-coded safety layer (Stages 5 and 7);
- the learning loop: refreshers, feedback fading and capped motivation (Stage 6, done).

Capture (Stage 2) works on the owner's iPhone; Android capture is still to come. Reviews and the beta (Stage 8) need people. See [`docs/build-plan.md`](docs/build-plan.md), [how the numbers work](docs/how-the-numbers-work.md) and the draft [privacy policy](docs/privacy-policy.md).

## Repository

| Path | What |
|---|---|
| [`core/`](core/) | Rust analysis core (`newvoice-core`), native bindings (`newvoice-ffi`, UniFFI) and a test CLI (`newvoice-cli`) |
| [`app/`](app/) | React Native app (Expo, development build) |
| [`harness/`](harness/) | Python validation harness and reference-norms tooling (test-only, never shipped) |
| [`content/`](content/) | Curriculum JSON (Units 0–10) and reference norms |
| [`docs/`](docs/) | Domain handbook, tech stack, build plan, [decisions log](docs/decisions.md) |

## Development

Rust (the toolchain is pinned by `core/rust-toolchain.toml`):

```bash
cd core && cargo test --workspace
```

Harness, including the Praat golden tests. It needs the Rust toolchain and Node 22 (for the WebAssembly check). It builds `newvoice-cli`, and on first run it downloads the Hillenbrand recordings (about 21 MB, pinned by SHA-256) into `harness/.cache`:

```bash
cd harness && uv sync && uv run pytest
```

Validation reports (after any analysis change):

```bash
cd harness && uv run python -m validation.report
```

```bash
cd harness && uv run python -m validation.report_real
```

Live look-ahead (streamed vs batch pitch; after any change to the jump guard or median filter):

```bash
cd harness && uv run python -m validation.lookahead
```

Strain-monitor sessions and report (after any change to the utterance summaries or the strain rules; `--real` also rebuilds the LibriSpeech sessions, which needs the 338 MB dev-clean download):

```bash
cd harness && uv run python -m validation.strain --real
```

```bash
cd harness && uv run python -m validation.strain --report
```

Reference norms:

```bash
cd harness && uv run python -m norms.build_norms
```

App (typecheck and unit tests):

```bash
cd app && npm ci && npm run typecheck && npm test
```

After changing the in-app "how the numbers work" or privacy copy (`app/src/content/`), regenerate the published pages:

```bash
cd app && node --experimental-strip-types scripts/copy-docs.mjs
```

Ear-training stimuli are checked against Praat by the harness (`tests/test_eartraining.py`, part of `uv run pytest`).

After changing the database schema (`app/src/db/schema.ts`), generate and commit a migration:

```bash
cd app && npm run db:generate
```

## License

Apache-2.0. See [`LICENSE`](LICENSE) and [`NOTICE`](NOTICE), which includes the Margarita Clause. The NewVoice name and icon are covered separately; see [`TRADEMARKS.md`](TRADEMARKS.md).
