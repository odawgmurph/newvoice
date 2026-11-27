import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ShakeDetector } from './shake.ts';

test('three sharp jolts within a second exit', () => {
  const d = new ShakeDetector();
  assert.equal(d.push(3, 0, 0, 0), false);
  assert.equal(d.push(-3, 0, 1, 300), false);
  assert.equal(d.push(3, 1, 0, 600), true);
});

test('ordinary handling does not', () => {
  const d = new ShakeDetector();
  // Walking: 1–1.5 g for ten seconds.
  for (let t = 0; t < 10_000; t += 100) assert.equal(d.push(0.3, 1 + 0.4 * Math.sin(t / 150), 0.2, t), false);
  // Putting the phone down twice, far apart.
  assert.equal(d.push(0, 2.6, 0, 11_000), false);
  assert.equal(d.push(0, 2.6, 0, 15_000), false);
  // One jolt read over consecutive samples counts once.
  const e = new ShakeDetector();
  assert.equal(e.push(3, 0, 0, 0), false);
  assert.equal(e.push(3, 0, 0, 50), false);
  assert.equal(e.push(3, 0, 0, 100), false);
});
