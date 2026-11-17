# content/

Data the app bundles and can update over the air. It's kept separate from code so curriculum fixes don't need an app release.

- `norms/reference_norms.json` holds group vowel and F0 statistics computed from Hillenbrand (1995). **Generated; don't edit by hand.** To regenerate it:

  ```bash
  cd harness && uv run python -m norms.build_norms
  ```

  CI fails if the committed file is out of date. See `docs/decisions.md` (D6) for the method.

- The curriculum (units → skills → lessons → exercises) arrives in Stage 5.
