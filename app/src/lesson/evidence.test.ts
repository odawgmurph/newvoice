import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Frame, UtteranceSummary } from '../feedback/types.ts';
import { freeSpeech, melodyUtterances, vowelScore, weightEvidence, whisperF2 } from './evidence.ts';

const frame = (o: Partial<Frame>): Frame => ({
  t: 0,
  levelDbfs: -30,
  periodicity: 0,
  voiced: false,
  f0Hz: null,
  f0St: null,
  f1Hz: null,
  f2Hz: null,
  formantConfidence: 0,
  h1cH2cDb: null,
  alphaRatioDb: null,
  resonance: null,
  weightIndex: null,
  ...o,
});

const utt = (o: Partial<UtteranceSummary>): UtteranceSummary => ({
  startS: 0,
  endS: 1,
  voicedS: 1.2,
  scored: true,
  pitch: { medianHz: 200, medianSt: 55, p10St: 54, p90St: 56, sdSt: 1, range5to95St: 4 },
  terminalSlopeStPerS: 0,
  f1Hz: null,
  f2Hz: null,
  f3Hz: null,
  formantConfidence: 0.8,
  resonance: null,
  weightIndex: null,
  h1cH2cDb: null,
  alphaRatioDb: null,
  cppsDb: null,
  hnrDb: null,
  jitterLocal: null,
  shimmerLocal: null,
  periods: 100,
  ...o,
});

test('whispered F2 needs half a second of confident frames', () => {
  const whisper = Array.from({ length: 60 }, (_, i) => frame({ t: i / 100, f2Hz: 2000 + i, formantConfidence: 0.5 }));
  assert.equal(whisperF2(whisper), 2029.5);
  assert.equal(whisperF2(whisper.slice(0, 30)), null);
  assert.equal(whisperF2(whisper.map((f) => ({ ...f, formantConfidence: 0.3 }))), null);
});

test('weight evidence uses scored utterances and flags anything above p90', () => {
  const us = [utt({ weightIndex: -0.6 }), utt({ weightIndex: -0.8, scored: false }), utt({ weightIndex: -0.4 })];
  assert.deepEqual(weightEvidence(us, 60), { weightIndexes: [-0.6, -0.4], aboveComfortable: false });
  assert.equal(weightEvidence(us, 54.5).aboveComfortable, true);
});

test('melody utterances take the line showing when they started', () => {
  const lines = ['I made soup.', 'Are you coming?'];
  const us = [utt({ startS: 0.5 }), utt({ startS: 3.1, terminalSlopeStPerS: 4 })];
  const m = melodyUtterances(us, [0, 3], lines);
  assert.deepEqual(m.map((x) => x.question), [false, true]);
  assert.equal(m[1].terminalSlopeStPerS, 4);
});

test('free speech: median of voiced frames and voiced time', () => {
  const fs = [...Array(30).fill(0).map(() => frame({ f0St: 55 })), ...Array(10).fill(0).map(() => frame({}))];
  assert.deepEqual(freeSpeech(fs), { medianSt: 55, voicedS: 0.3 });
});

test('vowel score prefers a confident utterance, else confident frames', () => {
  assert.equal(vowelScore([utt({ resonance: 0.6 })], []), 0.6);
  assert.equal(vowelScore([utt({ resonance: 0.6, formantConfidence: 0.2 })], []), null);
  const fr = Array.from({ length: 60 }, () => frame({ resonance: 0.4, formantConfidence: 0.7 }));
  assert.equal(vowelScore([], fr), 0.4);
});
