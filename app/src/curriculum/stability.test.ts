// Unit 9's "stable metrics in free speech" (§4.1) on real speech: the
// session-to-session spread the checkpoint allows must be one that most
// ordinary, consistent speakers meet (build plan Stage 7 exit: "carryover
// metrics are stable on test recordings"). Uses the 40 LibriSpeech dev-clean
// speakers already in the strain fixture (D18): each speaker's first 20 read
// utterances, split into three sessions of ~15 s voiced, the size of a
// Unit 9 checkpoint attempt.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import type { UtteranceSummary } from '../feedback/types.ts';
import { gateMet, type AttemptRecord } from './criteria.ts';
import type { Criterion, Curriculum } from './types.ts';

const fixture = JSON.parse(readFileSync(new URL('../feedback/fixtures/strain-sessions.json', import.meta.url), 'utf8'));
const curriculum: Curriculum = JSON.parse(readFileSync(new URL('../../../content/curriculum/curriculum.json', import.meta.url), 'utf8'));
const gate = curriculum.units[9].lessons.at(-1)!.exercises.find((e) => e.id === 'u9-check')!.pass as Extract<Criterion, { kind: 'free-speech-stable' }>;

/** Voiced-time-weighted median of utterance medians: a session's talking pitch. */
function sessionMedian(us: UtteranceSummary[]): number {
  const v = us.map((u) => [u.pitch!.medianSt, u.voicedS] as const).sort((a, b) => a[0] - b[0]);
  const total = v.reduce((s, [, w]) => s + w, 0);
  let acc = 0;
  for (const [x, w] of v) if ((acc += w) >= total / 2) return x;
  return v[v.length - 1][0];
}

test('most healthy, consistent speakers meet the Unit 9 stability spread', () => {
  const speakers = fixture.sessions.filter((s: { source: string; expectRest: boolean }) => s.source === 'librispeech' && !s.expectRest);
  assert.equal(speakers.length, 40);
  let stable = 0;
  for (const s of speakers) {
    const us: UtteranceSummary[] = s.utterances.filter((u: UtteranceSummary) => u.pitch);
    const n = Math.floor(us.length / 3);
    const attempts: AttemptRecord[] = [0, 1, 2].map((k) => ({
      exerciseId: 'u9-check',
      sessionId: k,
      at: k,
      outcome: { passed: true, value: sessionMedian(us.slice(k * n, (k + 1) * n)), performance: 1, why: '' },
    }));
    if (gateMet(gate, attempts, { baselineStored: true })) stable++;
  }
  // 33 of 40 at 2.5 ST; a 1.5 ST spread passed only 25 of 40 (D21).
  assert.ok(stable / speakers.length >= 0.8, `${stable} of ${speakers.length}`);
});
