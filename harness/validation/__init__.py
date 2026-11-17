"""Validation harness: runs newvoice-core and Praat on the same audio and compares.

- `synth`: synthetic test signals with known F0 and formants.
- `corpus`: the cases the golden tests and the report use.
- `core`: builds and runs `newvoice-cli` (the Rust core).
- `praat`: reference measurements through Parselmouth (GPL; test-only).
- `report`: writes the error-versus-F0 tables to `docs/validation/`.
"""
