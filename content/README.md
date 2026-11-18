# content/

Data the app bundles and can update over the air. It's kept separate from code so curriculum fixes don't need an app release.

- `norms/reference_norms.json` holds group vowel and F0 statistics computed from Hillenbrand (1995). **Generated; don't edit by hand.** To regenerate it:

  ```bash
  cd harness && uv run python -m norms.build_norms
  ```

  The same run regenerates `core/newvoice-core/src/reference_norms.rs`, the table the analysis core's resonance score reads. CI fails if either is out of date. See `docs/decisions.md` (D6, D11) for the method.

- The curriculum (units → skills → lessons → exercises) arrives in Stage 5.
