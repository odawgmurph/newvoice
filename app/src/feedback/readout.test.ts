import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Frame, UtteranceSummary } from './types.ts';
import { formantVisibility, LiveReadouts, median, RollingMedian, utteranceScoresVisible } from './readout.ts';

test('rolling median ignores gaps and rejects a single outlier', () => {
  const m = new RollingMedian(5);
  for (const v of [50, 50.2, null, 62, 50.1, Number.NaN, 49.9]) m.push(v);
  // An octave-ish blip (62) does not move the readout (§3.9 outlier rejection).
  assert.equal(m.value(), 50.1);
  m.reset();
  assert.equal(m.value(), null);
  assert.equal(median([3, 1, 2, 4]), 2.5);
  assert.equal(median([]), null);
});

test('formant readouts hide below 0.5 confidence and dim below 0.7', () => {
  assert.equal(formantVisibility(0.2), 'hidden');
  assert.equal(formantVisibility(0.49), 'hidden');
  assert.equal(formantVisibility(0.5), 'dimmed');
  assert.equal(formantVisibility(0.69), 'dimmed');
  assert.equal(formantVisibility(0.9), 'shown');
  assert.equal(formantVisibility(null), 'hidden');
});

const frame = (f0St: number | null, conf: number, f2: number | null): Frame => ({
  t: 0,
  levelDbfs: -20,
  periodicity: 0.9,
  voiced: f0St != null,
  f0Hz: null,
  f0St,
  f1Hz: 500,
  f2Hz: f2,
  formantConfidence: conf,
  h1cH2cDb: null,
  alphaRatioDb: null,
  resonance: f2 == null ? null : 0.4,
  weightIndex: null,
});

test('live readouts keep unreliable formants out of the median', () => {
  const r = new LiveReadouts();
  r.push([frame(52, 0.9, 2000), frame(52, 0.9, 2010), frame(52, 0.1, 900)]);
  assert.equal(r.value.f2Hz, 2005);
  assert.equal(r.value.f2Visibility, 'shown');
  // A run of low-confidence frames (high F0, §3.3) hides the readout.
  for (let i = 0; i < 20; i++) r.push([frame(64, 0.2, 1200)]);
  assert.equal(r.value.f2Visibility, 'hidden');
  assert.equal(r.value.pitchSt, 64);
  // Unvoiced frames don't move anything.
  r.push([frame(null, 0.9, 3000)]);
  assert.equal(r.value.pitchSt, 64);
});

test('utterance scores only from scored utterances (≥1 s voiced, §3.1)', () => {
  const u = { scored: false, pitch: { medianSt: 50 } } as unknown as UtteranceSummary;
  assert.equal(utteranceScoresVisible(u), false);
  assert.equal(utteranceScoresVisible({ ...u, scored: true }), true);
  assert.equal(utteranceScoresVisible({ ...u, scored: true, pitch: null }), false);
});
