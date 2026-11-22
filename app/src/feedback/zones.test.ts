import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Baseline, UtteranceSummary } from './types.ts';
import {
  classifyPitch,
  f2Position,
  f2Zone,
  GOAL_PITCH_CEILING_ST,
  hzToSt,
  inZoneShare,
  isRewarded,
  parseBaseline,
  pitchZone,
  provisionalBaseline,
  referenceF2,
  stToHz,
} from './zones.ts';

const close = (a: number, b: number, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol, `${a} vs ${b}`);

// A voice at 130 Hz (about the low reference's speaker median, §1.2) with a
// comfortable range up to 210 Hz.
const base: Baseline = {
  medianSt: hzToSt(130),
  p10St: hzToSt(115),
  p90St: hzToSt(150),
  comfortableP10St: hzToSt(90),
  comfortableP90St: hzToSt(210),
  vowelF2Hz: { iy: 2300 },
  resonance: 0.1,
  source: 'baseline',
};

test('semitone conversion', () => {
  close(hzToSt(440), 69);
  close(stToHz(hzToSt(187)), 187);
  // §1.2's worked example: 120 → 200 Hz is about 8.8 ST.
  close(hzToSt(200) - hzToSt(120), 8.84, 0.01);
});

test('the pitch zone climbs 1 ST per level from the baseline (§3.9)', () => {
  const z0 = pitchZone(base, 'feminine', 0);
  close(z0.centre, base.medianSt);
  close(z0.hi - z0.lo, 4);
  const z3 = pitchZone(base, 'feminine', 3);
  close(z3.centre, base.medianSt + 3);
});

test('the pitch zone stops at the goal ceiling', () => {
  const far = pitchZone(base, 'feminine', 40);
  close(far.centre, hzToSt(200));
  const andro = pitchZone(base, 'androgynous', 40);
  close(stToHz(andro.centre), Math.sqrt(145 * 175), 0.5);
  // "own" has no ceiling but the comfortable p90.
  const own = pitchZone(base, 'own', 40);
  close(own.centre, base.comfortableP90St);
  assert.equal(GOAL_PITCH_CEILING_ST.own, null);
});

test('the zone never reaches above the comfortable p90 (§2.4)', () => {
  for (let level = 0; level < 30; level++) {
    for (const goal of ['feminine', 'androgynous', 'flexible', 'own'] as const) {
      const z = pitchZone({ ...base, comfortableP90St: hzToSt(160) }, goal, level);
      assert.ok(z.hi <= hzToSt(160) + 1e-9, `${goal} ${level}`);
      assert.ok(z.lo <= z.hi);
    }
  }
});

test('a voice already past the goal is not pulled down', () => {
  const high = { ...base, medianSt: hzToSt(205), comfortableP90St: hzToSt(260) };
  close(pitchZone(high, 'feminine', 3).centre, hzToSt(205));
});

test('above the comfortable p90 is a caution, never rewarded', () => {
  const z = pitchZone(base, 'feminine', 2);
  assert.equal(classifyPitch(z.centre, z), 'in');
  assert.equal(classifyPitch(z.lo - 0.1, z), 'below');
  assert.equal(classifyPitch(base.comfortableP90St + 0.1, z), 'above-comfortable');
  assert.ok(!isRewarded('above-comfortable'));
  assert.ok(!isRewarded('above'));
  assert.ok(isRewarded('in'));
  // A zone squeezed by the p90 still never classes p90+ as in.
  const tight = pitchZone({ ...base, comfortableP90St: base.medianSt + 0.5 }, 'own', 5);
  assert.equal(classifyPitch(tight.comfortableP90St + 0.01, tight), 'above-comfortable');
});

test('in-zone share counts voiced frames only (E14)', () => {
  const z = pitchZone(base, 'feminine', 0);
  assert.equal(inZoneShare([z.centre, z.centre, null, z.hi + 1], z), 2 / 3);
  assert.equal(inZoneShare([null], z), null);
});

test('F2 climbs 3% per level up to the goal reference (§3.9)', () => {
  const z1 = f2Zone(base, 'feminine', 'iy', 1)!;
  close(z1.centre, 2300 * 1.03);
  const far = f2Zone(base, 'feminine', 'iy', 50)!;
  close(far.centre, referenceF2('iy', 1)!);
  // The high reference /i/ F2 is about 2761 Hz (§1.3).
  close(referenceF2('iy', 1)!, 2761, 30);
  const mid = f2Zone(base, 'androgynous', 'iy', 50)!;
  close(mid.centre, Math.sqrt(referenceF2('iy', 0)! * referenceF2('iy', 1)!), 1);
  assert.equal(f2Zone(base, 'feminine', 'uw', 1), null);
  assert.equal(referenceF2('zz', 1), null);
  close(f2Position('iy', referenceF2('iy', 0.3)!)!, 0.3);
  assert.equal(f2Position('zz', 2000), null);
});

function utt(medianSt: number, voicedS: number, scored = true): UtteranceSummary {
  return {
    startS: 0,
    endS: voicedS,
    voicedS,
    scored,
    pitch: { medianHz: stToHz(medianSt), medianSt, p10St: medianSt - 2, p90St: medianSt + 2, sdSt: 1.5, range5to95St: 5 },
    terminalSlopeStPerS: null,
    f1Hz: 400,
    f2Hz: 2200,
    f3Hz: 2900,
    formantConfidence: 0.8,
    resonance: 0.3,
    weightIndex: null,
    h1cH2cDb: null,
    alphaRatioDb: null,
    cppsDb: 14,
    hnrDb: 20,
    jitterLocal: 0.005,
    shimmerLocal: 0.03,
    periods: 300,
  };
}

test('a provisional baseline needs 10 s of scored speech', () => {
  assert.equal(provisionalBaseline([utt(50, 3), utt(50, 3), utt(60, 5, false)]), null);
  const b = provisionalBaseline([utt(50, 3), utt(52, 4), utt(51, 4)], 'iy')!;
  assert.equal(b.medianSt, 51);
  assert.equal(b.comfortableP90St, 53);
  assert.equal(b.vowelF2Hz.iy, 2200);
  assert.equal(b.source, 'provisional');
  assert.deepEqual(parseBaseline(JSON.parse(JSON.stringify(b))), b);
  assert.equal(parseBaseline({ medianSt: 'x' }), null);
});
