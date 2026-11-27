# content/

Data the app bundles and can update over the air. It's kept separate from code so curriculum fixes don't need an app release.

- `norms/reference_norms.json` holds group vowel and F0 statistics computed from Hillenbrand (1995). **Generated; don't edit by hand.** To regenerate it:

  ```bash
  cd harness && uv run python -m norms.build_norms
  ```

  The same run regenerates `core/newvoice-core/src/reference_norms.rs`, the table the analysis core's resonance score reads. CI fails if either is out of date. See `docs/decisions.md` (D6, D11) for the method.

- `curriculum/curriculum.json` is the curriculum: Units 0–10 → lessons → exercises, the shared warm-up and cool-down, and the two tracks (default and resonance first). Each exercise names its handbook source and its pass criterion; each unit's checkpoint holds the handbook's unlock criterion (§4.1). Bump `contentVersion` with every change. `npm test` in `app/` validates it (`app/src/curriculum/validate.ts`): ids, tracks, safety lengths, criteria that each exercise type can measure, known vowels, and copy with no gendered or clinical words. See `docs/decisions.md` (D21) for how each criterion was read.
