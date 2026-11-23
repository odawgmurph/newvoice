import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Baseline, UtteranceSummary } from '../types.ts';
import { hzToSt, pitchZone, stToHz } from '../zones.ts';
import { reasonLines, REST_BODY, STOP_RULES } from './restCopy.ts';
import { summaryLines } from './summaryText.ts';

const base: Baseline = {
  medianSt: hzToSt(150),
  p10St: hzToSt(130),
  p90St: hzToSt(170),
  comfortableP10St: hzToSt(110),
  comfortableP90St: hzToSt(200),
  vowelF2Hz: {},
  resonance: 0.2,
  source: 'baseline',
};

function utt(hz: number, extra: Partial<UtteranceSummary> = {}): UtteranceSummary {
  const st = hzToSt(hz);
  return {
    startS: 0,
    endS: 2,
    voicedS: 1.8,
    scored: true,
    pitch: { medianHz: stToHz(st), medianSt: st, p10St: st - 2, p90St: st + 2, sdSt: 1.4, range5to95St: 5 },
    terminalSlopeStPerS: 4,
    f1Hz: 450,
    f2Hz: 2400,
    f3Hz: 3000,
    formantConfidence: 0.8,
    resonance: 0.5,
    weightIndex: -1,
    h1cH2cDb: null,
    alphaRatioDb: null,
    cppsDb: 14,
    hnrDb: 20,
    jitterLocal: 0.005,
    shimmerLocal: 0.03,
    periods: 300,
    ...extra,
  };
}

const zone = pitchZone(base, 'feminine', 2);
const text = (lines: { text: string }[]) => lines.map((l) => l.text).join(' ');

test('a scored utterance gets baseline-relative, neutral lines', () => {
  const lines = summaryLines(utt(stToHz(zone.centre)), { baseline: base, pitchZone: zone, f2Zone: null });
  const all = text(lines);
  assert.match(all, /semitones higher than where you started/);
  assert.match(all, /In your zone/);
  assert.match(all, /ending on a rise/);
  assert.match(all, /Brighter than where you started/);
  assert.match(all, /Lighter than where you started/);
  assert.equal(lines.find((l) => l.label === 'Pitch')!.tone, 'zone');
});

test('above the comfortable range is a caution, not a success (§2.4)', () => {
  const lines = summaryLines(utt(230), { baseline: base, pitchZone: zone, f2Zone: null });
  const pitch = lines.find((l) => l.label === 'Pitch')!;
  assert.equal(pitch.tone, 'caution');
  assert.match(pitch.text, /no need to go this high/);
  assert.doesNotMatch(pitch.text, /In your zone/);
});

test('short utterances and unreliable formants are not scored (§3.1, §3.9)', () => {
  const short = summaryLines(utt(150, { scored: false }), { baseline: base, pitchZone: zone, f2Zone: null });
  assert.equal(short.length, 1);
  assert.equal(short[0].tone, 'dim');
  const unreliable = summaryLines(utt(150, { formantConfidence: 0.3 }), { baseline: null, pitchZone: null, f2Zone: null });
  assert.match(text(unreliable), /Not measured reliably/);
  assert.doesNotMatch(text(unreliable), /F2 \d/);
});

test('rest copy covers every reason and stays education-only (D3)', () => {
  const lines = reasonLines(['effort', 'jitter-rising', 'cpps-falling', 'shimmer-rising', 'above-comfortable-range']);
  assert.equal(lines.length, 5);
  assert.match(lines[0], /steady/);
  for (const s of [...lines, REST_BODY, STOP_RULES]) {
    assert.doesNotMatch(s, /\b(therapy|treatment|diagnos\w*|clinical|dysphonia)\b/i, s);
  }
});
