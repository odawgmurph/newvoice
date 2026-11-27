import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { BaselineSummary } from '../baseline/plan.ts';
import { GENDERED_TERMS } from '../feedback/labels.ts';
import { compareBaselines } from './compare.ts';

const pitch = (hz: number) => ({ medianHz: hz, medianSt: 0, p10St: 0, p90St: 0, sdSt: 1, rangeSt: 5, voicedS: 10 });
const vowel = (f2: number) => ({ f1Hz: 500, f2Hz: f2, f3Hz: 2800, f0MedianHz: 150, ceilingHz: 5000, confidence: 0.8 });
const summary = (hz: number, span: number, f2: number): BaselineSummary => ({
  version: 1,
  coreVersion: null,
  speaking: { ...pitch(hz), source: 'spontaneous' },
  reading: pitch(hz),
  comfortableRange: { lowSt: 40, highSt: 40 + span, p10St: 41, ceilingSt: 39 + span, spanSt: span },
  vowels: { a: vowel(f2 * 0.6), i: vowel(f2), u: null },
  formantCeilingHz: 5000,
  vocalTract: null,
  resonance: null,
  weightBaseline: null,
  quality: { sustained: null, speech: null },
  speechLevelDbfs: null,
  reducedAccuracy: false,
});

test('changes are described neutrally, measured the same way', () => {
  const lines = compareBaselines(summary(130, 12, 2200), summary(160, 14, 2400));
  assert.deepEqual(
    lines.map((l) => l.label),
    ['Everyday pitch', 'Comfortable range', '“ee” brightness (F2)', '“ah” brightness (F2)'],
  );
  assert.match(lines[0].text, /3\.6 semitones higher/);
  assert.match(lines[1].text, /wider/);
  assert.match(lines[2].text, /brighter, 9%/);
  const words = new RegExp(`\\b(${GENDERED_TERMS.join('|')})\\b`, 'i');
  for (const l of lines) assert.doesNotMatch(`${l.label} ${l.text}`, words);
});

test('small changes read as about the same', () => {
  const lines = compareBaselines(summary(150, 12, 2200), summary(151, 12.2, 2210));
  assert.match(lines[0].text, /about the same/);
  assert.match(lines[1].text, /about the same/);
  assert.match(lines[2].text, /about the same/);
});
