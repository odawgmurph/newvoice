import assert from 'node:assert/strict';
import { test } from 'node:test';

import { answer, DIFFERENCES, LEVELS, startStaircase } from './staircase.ts';
import { envelope, makeTrial, renderTrial, renderVowel, rng, SAMPLE_RATE, sourceAmplitude, wavBytes } from './synth.ts';

test('3-down/1-up converges near 79% correct (handbook ~80%)', () => {
  // A simulated listener whose accuracy falls with level: threshold near level 5.
  const r = rng(7);
  let s = startStaircase();
  for (let i = 0; i < 4000; i++) {
    const p = 0.5 + 0.5 / (1 + Math.exp(1.6 * (s.level - 5.5)));
    s = answer(s, r() < p);
  }
  const late = s.trials.slice(500);
  const acc = late.filter((t) => t.correct).length / late.length;
  assert.ok(Math.abs(acc - 0.794) < 0.04, `accuracy ${acc}`);
});

test('the staircase stays within its levels; fixed blocks never move', () => {
  let s = startStaircase();
  for (let i = 0; i < 100; i++) s = answer(s, true);
  assert.equal(s.level, LEVELS - 1);
  for (let i = 0; i < 100; i++) s = answer(s, false);
  assert.equal(s.level, 0);
  let f = startStaircase(4);
  for (let i = 0; i < 10; i++) f = answer(f, i % 2 === 0);
  assert.ok(f.trials.every((t) => t.level === 4) && f.level === 4);
});

test('difference ladders shrink and span the handbook’s ±5–20% formant shifts', () => {
  for (const d of Object.values(DIFFERENCES)) {
    assert.equal(d.length, LEVELS);
    for (let i = 1; i < d.length; i++) assert.ok(d[i] < d[i - 1]);
  }
  assert.equal(DIFFERENCES.brightness[0], 20);
  assert.ok(DIFFERENCES.brightness.includes(5));
});

test('lightness changes H1–H2 by exactly the asked amount', () => {
  for (const d of [1, 5, 12]) {
    const h1h2 = (l: number) => 20 * Math.log10(sourceAmplitude(1, l) / sourceAmplitude(2, l));
    assert.ok(Math.abs(h1h2(d) - h1h2(0) - d) < 1e-9);
  }
});

test('a trial differs only in its dimension, by the difference asked', () => {
  for (const dim of ['pitch', 'brightness', 'weight'] as const) {
    const t = makeTrial(dim, 'ab', DIFFERENCES[dim][4], 42);
    const [a, b] = t.sounds;
    const up = t.sounds[t.answer];
    const down = t.sounds[1 - t.answer];
    assert.deepEqual(a.formantsHz, b.formantsHz);
    if (dim === 'pitch') {
      assert.ok(Math.abs(12 * Math.log2(up.f0Hz / down.f0Hz) - 1) < 1e-9);
      assert.equal(up.formantScale, down.formantScale);
    } else if (dim === 'brightness') {
      assert.ok(Math.abs(up.formantScale / down.formantScale - 1.08) < 1e-9);
      assert.equal(up.f0Hz, down.f0Hz);
    } else {
      assert.ok(Math.abs(up.lightnessDb - down.lightnessDb - 5) < 1e-9);
      assert.equal(up.f0Hz, down.f0Hz);
    }
  }
});

test('odd-one-out has exactly one odd sound', () => {
  for (let seed = 0; seed < 20; seed++) {
    const t = makeTrial('brightness', 'odd-one-out', 10, seed);
    const odd = t.sounds[t.answer];
    assert.equal(t.sounds.filter((s) => s === odd).length, 1);
    assert.equal(new Set(t.sounds.map((s) => s.formantScale)).size, 2);
  }
});

test('rendered stimuli are deterministic, level-matched and bounded', () => {
  const t = makeTrial('brightness', 'ab', 8, 3);
  const x = renderTrial(t);
  const y = renderTrial(makeTrial('brightness', 'ab', 8, 3));
  assert.deepEqual(x, y);
  const v = renderVowel(t.sounds[0]);
  const rms = Math.sqrt(v.reduce((s, s2) => s + s2 * s2, 0) / v.length);
  assert.ok(Math.abs(rms - 0.1) < 1e-3);
  assert.ok(v.every((s) => Math.abs(s) < 1));
  const wav = wavBytes(v);
  assert.equal(wav.length, 44 + v.length * 2);
  assert.equal(new DataView(wav.buffer).getUint32(24, true), SAMPLE_RATE);
});

test('the formant envelope peaks near each formant', () => {
  const f = [700, 1200, 2600, 3400];
  assert.ok(envelope(700, f) > envelope(450, f) && envelope(700, f) > envelope(950, f));
  assert.ok(envelope(1200, f) > envelope(1000, f));
});
