import assert from 'node:assert/strict';
import { test } from 'node:test';

import { drawsLiveTrace, fade, initialFading, TRACE_WINDOW_S, type FadingState } from './fading.ts';
import type { UtteranceSummary } from './types.ts';

const frames = (from: number, to: number) => {
  const out = [];
  for (let t = from; t <= to + 1e-9; t += 0.01) out.push({ t: Math.round(t * 100) / 100, f0St: 52 });
  return out;
};
const utt = (startS: number, endS: number) => ({ startS, endS, scored: true }) as UtteranceSummary;

function run(mode: 'live' | 'summary' | 'delayed'): FadingState[] {
  const states: FadingState[] = [];
  let s = initialFading(mode);
  s = fade(s, { type: 'frames', frames: frames(0, 1) });
  states.push(s);
  s = fade(s, { type: 'frames', frames: frames(1.01, 1.5) });
  s = fade(s, { type: 'utterance', utterance: utt(0.2, 1.2) });
  states.push(s);
  return states;
}

test('live draws as you speak and shows summaries', () => {
  const [speaking, after] = run('live');
  assert.ok(speaking.trace.length > 90);
  assert.equal(after.summaries.length, 1);
  assert.ok(drawsLiveTrace('live'));
});

test('live keeps only the last 4 s of trace', () => {
  const s = fade(initialFading('live'), { type: 'frames', frames: frames(0, 10) });
  assert.ok(s.trace[0].t >= 10 - TRACE_WINDOW_S - 1e-9);
});

test('summary mode never shows a trace (§2.5 KR only)', () => {
  const [speaking, after] = run('summary');
  assert.equal(speaking.trace.length, 0);
  assert.equal(after.trace.length, 0);
  assert.equal(after.summaries.length, 1);
  assert.ok(!drawsLiveTrace('summary'));
});

test('delayed mode reveals an utterance only once it ends', () => {
  const [speaking, after] = run('delayed');
  assert.equal(speaking.trace.length, 0);
  assert.ok(after.trace.length > 0);
  assert.ok(after.trace.every((p) => p.t >= 0.15 && p.t <= 1.25));
  // Frames after the utterance stay pending for the next one.
  assert.ok(after.pending.every((p) => p.t > 1.25));
  assert.equal(after.summaries.length, 1);
});

test('switching mode clears the trace but keeps summaries', () => {
  const [, live] = run('live');
  const s = fade(live, { type: 'mode', mode: 'summary' });
  assert.equal(s.mode, 'summary');
  assert.equal(s.trace.length, 0);
  assert.equal(s.summaries.length, 1);
  assert.equal(fade(s, { type: 'reset' }).summaries.length, 0);
});
