# Stage 2 device matrix

One row per phone and input (built-in mic, wired headset, Bluetooth), scored by `harness/validation/device.py` from a test clip exported by the app. Under D14 the owner's iPhone is the only tested device, so its rows decide the Stage 2 exit; anyone else is welcome to add a row for their phone in a PR. The Stage 2 exit criteria are in [`../build-plan.md`](../build-plan.md) (Stage 2): mic-to-screen under 100 ms, a steady 60 fps, and per-frame cost well inside the 10 ms hop.

## Recording a clip (on the phone)

1. Open NewVoice in a quiet room. Pick the input you're testing (plug in the headset, connect the Bluetooth device, or neither).
2. Under **Test clip**, tap **Record test clip**. It stops by itself after 30 s.
3. While it records: hold "ah" for about 3 s, slide from low to high and back, then read a sentence or two aloud at your normal pitch.
4. Optionally type a note (room, mic, anything odd), tap **Export diagnostics**, and send both files to your computer (AirDrop, Save to Files, Mail…).

The export is two files with the same name: `nv-<model>-<input>-<time>.json` and `.wav`. The WAV is your voice, and it stays on the phone until you send it. Each new export deletes the previous one from the phone. Don't commit the clips: only the scored row below goes in the repo.

## Scoring a clip

Put both files in one folder, then:

```bash
cd harness && uv run python -m validation.device ~/Downloads/nv-*.json
```

It prints a summary for each clip and a table row to paste below. What each column measures:

- **Meas. mode:** iOS kept the unprocessed measurement mode for the whole clip.
- **Mic→screen p95:** the app's estimate (input latency + analysis look-ahead + bridge to JavaScript + one UI frame), 95th percentile over the clip. Target: under 100 ms.
- **UI fps:** median frame rate of the trace. Target: about 60.
- **µs/frame:** the clip re-analysed on the phone as fast as it can go (best of 3). Must stay under 25% of the 10 ms hop, the same share CI holds the x86 build to.
- **Dropped:** samples lost because analysis fell behind. Should be 0.
- **F0 ≤1% vs Praat / F0 gross:** the phone's live pitch against Praat `To Pitch (ac)` on the same audio, scored like the LibriSpeech tests. The handbook's tolerance is ±1%; gross errors are off by more than 20%.
- **F2 ≤10% vs Praat:** F2 on the frames the app would show (formant confidence ≥ 0.5) against Praat `To Formant (burg)` at the same ceiling and bandwidth filter.
- **Phone = core:** the desktop core run on the same WAV reproduces the phone's F0 (within 0.1%) on this share of frames. Anything below 100% means the phone build, the FFI or capture changed the result.

Praat sees the same audio as the phone, so the Praat columns measure the tracker on this phone's signal. Whether a mic or route colours the voice shows up when rows for the same speaker and material differ.

## Results

| Device | OS | Input | Meas. mode | Mic→screen p95 | UI fps | µs/frame | Dropped | F0 ≤1% vs Praat | F0 gross | F2 ≤10% vs Praat | Phone = core |
|---|---|---|---|---|---|---|---|---|---|---|---|
