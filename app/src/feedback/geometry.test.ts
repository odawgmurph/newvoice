import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ellipse, mapPoint, octaveLines, pitchAxis, stToY, traceX, vowelPoint, yToSt } from './geometry.ts';
import { REFERENCE_NORMS } from './referenceNorms.ts';

const close = (a: number, b: number, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol, `${a} vs ${b}`);

test('semitone axis round trip, higher is up', () => {
  const axis = { min: 40, max: 80 };
  close(stToY(80, axis, 200), 0);
  close(stToY(40, axis, 200), 200);
  close(yToSt(stToY(55.3, axis, 200), axis, 200), 55.3);
  close(traceX(10, 10, 4, 300), 300);
  close(traceX(6, 10, 4, 300), 0);
  assert.deepEqual(octaveLines(axis), [48, 60, 72]);
});

test('pitch axis spans at least the requested range around its values', () => {
  const a = pitchAxis([50, 54]);
  assert.ok(a.max - a.min >= 18 && a.min <= 50 && a.max >= 54);
  assert.deepEqual(pitchAxis([]), { min: 40, max: 80 });
});

test('map: brighter right, higher up, pinned at the edges', () => {
  const size = { width: 200, height: 100 };
  const pitch = { min: 40, max: 70 };
  const dark = mapPoint(55, 0, pitch, size);
  const bright = mapPoint(55, 1, pitch, size);
  assert.ok(bright.x > dark.x);
  assert.ok(mapPoint(65, 0, pitch, size).y < dark.y);
  assert.equal(mapPoint(90, 5, pitch, size).x, 200);
  assert.equal(mapPoint(90, 5, pitch, size).y, 0);
});

test('vowel chart: front vowels left, open vowels low', () => {
  const size = { width: 300, height: 300 };
  const i = REFERENCE_NORMS.vowels.iy.high.f1f2MeanHz;
  const a = REFERENCE_NORMS.vowels.ah.high.f1f2MeanHz;
  const pi = vowelPoint(i[0], i[1], size);
  const pa = vowelPoint(a[0], a[1], size);
  assert.ok(pi.x < pa.x, 'iy is front');
  assert.ok(pi.y < pa.y, 'ah is open');
});

test('ellipse points lie at k SDs (Mahalanobis distance)', () => {
  const mean: [number, number] = [500, 1500];
  const cov: [[number, number], [number, number]] = [
    [2500, 1200],
    [1200, 10000],
  ];
  const det = cov[0][0] * cov[1][1] - cov[0][1] ** 2;
  for (const k of [1, 2]) {
    for (const [x, y] of ellipse(mean, cov, k)) {
      const dx = x - mean[0];
      const dy = y - mean[1];
      const m2 = (cov[1][1] * dx * dx - 2 * cov[0][1] * dx * dy + cov[0][0] * dy * dy) / det;
      close(Math.sqrt(m2), k, 1e-9);
    }
  }
  // Real reference data works too.
  const v = REFERENCE_NORMS.vowels.iy.low;
  assert.equal(ellipse(v.f1f2MeanHz, v.f1f2CovHz, 2).length, 48);
});
