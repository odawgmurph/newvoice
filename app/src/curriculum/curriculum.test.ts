import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { REFERENCE_NORMS } from '../feedback/referenceNorms.ts';
import type { PitchZone } from '../feedback/zones.ts';
import {
  evaluateFreeSpeech,
  evaluateInZone,
  evaluatePitchMatch,
  evaluateResonanceVowels,
  evaluateSelfRated,
  evaluateStaircase,
  evaluateStRange,
  evaluateWeightLighter,
  evaluateWhisperRise,
  gateMet,
  longestMatchMs,
  resonanceTarget,
  zoneShares,
  type AttemptRecord,
  type Outcome,
} from './criteria.ts';
import { pitchTargets } from './items.ts';
import { lessonOpen, nextLesson, progress } from './progress.ts';
import type { Curriculum, Criterion } from './types.ts';
import { allExercises, validateCurriculum } from './validate.ts';

const CURRICULUM: Curriculum = JSON.parse(
  readFileSync(new URL('../../../content/curriculum/curriculum.json', import.meta.url), 'utf8'),
);
const VOWELS = new Set(Object.keys(REFERENCE_NORMS.vowels));

// ——— The shipped curriculum ———

test('the shipped curriculum passes validation', () => {
  assert.deepEqual(validateCurriculum(CURRICULUM, VOWELS), []);
});

test('it has Units 0–10 and both tracks (handbook §4.1, §2.1)', () => {
  assert.deepEqual(
    CURRICULUM.units.map((u) => u.number),
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
  );
  assert.deepEqual(CURRICULUM.tracks['resonance-first'].slice(0, 4), ['u0', 'u1', 'u4', 'u5']);
});

test('unit gates are the handbook §4.1 unlock criteria', () => {
  const gate = (id: string) => allExercises(CURRICULUM).find((x) => x.exercise.id === CURRICULUM.units.find((u) => u.id === id)!.gate)!.exercise.pass;
  assert.deepEqual(gate('u0'), { kind: 'baseline-stored' });
  assert.deepEqual(gate('u1'), { kind: 'staircase', accuracy: 0.8, level: 4, trials: 10 });
  assert.deepEqual(gate('u2'), { kind: 'pitch-match', toleranceCents: 50, holdMs: 600, required: 8 });
  assert.deepEqual(gate('u3'), { kind: 'weight-lighter', sd: 0.5, sessions: 3 });
  assert.deepEqual(gate('u4'), { kind: 'whisper-rise', ratio: 1.08 });
  assert.deepEqual(gate('u5'), { kind: 'resonance-vowels', score: 0.5, vowels: 6 });
  assert.equal((gate('u6') as Extract<Criterion, { kind: 'in-zone' }>).share, 0.7);
  assert.equal(gate('u7').kind, 'st-range');
  assert.equal(gate('u8').kind, 'self-rated');
  assert.equal(gate('u9').kind, 'free-speech-stable');
  assert.equal(gate('u10').kind, 'self-report');
});

test('the U2 checkpoint has 10 items, 8 required (§4.1 "8/10 items")', () => {
  const e = allExercises(CURRICULUM).find((x) => x.exercise.id === 'u2-check')!.exercise;
  assert.equal(e.type, 'match-pitch');
  if (e.type === 'match-pitch') assert.equal(e.offsetsSt.length, 10);
});

test('the U6 checkpoint is a 20-word list (§4.1)', () => {
  const e = allExercises(CURRICULUM).find((x) => x.exercise.id === 'u6-check')!.exercise;
  assert.ok(e.type === 'hold' && e.items.length === 20);
});

// ——— Validation catches broken content ———

function broken(mutate: (c: Curriculum) => void): string[] {
  const c: Curriculum = JSON.parse(JSON.stringify(CURRICULUM));
  mutate(c);
  return validateCurriculum(c, VOWELS);
}

test('validation rejects unsafe or unusable content', () => {
  assert.ok(broken((c) => (c.warmup.steps = c.warmup.steps.slice(0, 1))).some((e) => e.includes('warm-up')));
  assert.ok(broken((c) => (c.units[2].lessons[3].exercises[0].pass = { kind: 'completion' })).some((e) => e.includes('machine-checkable')));
  assert.ok(broken((c) => (c.units[1].lessons[0].exercises[0].title = 'For women')).some((e) => e.includes('gendered')));
  assert.ok(broken((c) => (c.units[1].lessons[0].exercises[0].title = 'Voice therapy')).some((e) => e.includes('clinical')));
  assert.ok(broken((c) => (c.units[4].lessons[0].exercises[1] as { reference?: boolean }).reference = false).some((e) => e.includes('reference whisper')));
  assert.ok(broken((c) => (c.tracks.default = c.tracks.default.slice(1))).length > 0);
  assert.ok(broken((c) => (c.units[6].lessons[2].exercises[0].volume = 'loud')).some((e) => e.includes('loud')));
});

// ——— Criteria ———

const HOP = 0.01;
const frames = (st: (number | null)[]) => st;

test('pitch match: 600 ms within ±50 cents (E1)', () => {
  const target = 55;
  const steady = Array(70).fill(55.3);
  assert.ok(longestMatchMs(frames(steady), HOP, target, 50, 60) >= 600);
  assert.ok(longestMatchMs(frames(Array(70).fill(55.6)), HOP, target, 50, 60) === 0);
  // A 30 ms gap is bridged; a long one splits the hold.
  const gappy = [...Array(35).fill(55), null, null, null, ...Array(35).fill(55)];
  assert.ok(longestMatchMs(gappy, HOP, target, 50, 60) >= 600);
  const split = [...Array(35).fill(55), ...Array(10).fill(null), ...Array(35).fill(55)];
  assert.ok(longestMatchMs(split, HOP, target, 50, 60) < 600);
});

test('pitch match never counts a hold above the comfortable p90 (§2.4)', () => {
  assert.equal(longestMatchMs(Array(80).fill(60), HOP, 60, 50, 59.5), 0);
});

test('pitch-match outcome counts items', () => {
  const c = { kind: 'pitch-match', toleranceCents: 50, holdMs: 600, required: 8 } as const;
  const items = Array.from({ length: 10 }, (_, i) => ({ targetSt: 55, holdMs: i < 8 ? 700 : 200 }));
  assert.equal(evaluatePitchMatch(c, items).passed, true);
  assert.equal(evaluatePitchMatch(c, items.slice(1)).passed, false);
});

const zone: PitchZone = { lo: 53, hi: 57, centre: 55, comfortableP90St: 58 };

test('zone shares count frames above the comfortable p90 as out', () => {
  const f = [...Array(70).fill(55), ...Array(30).fill(59)].map((st) => ({ st, f2Hz: 2000, formantConfidence: 0.8 }));
  const s = zoneShares(f, HOP, zone, { lo: 1900, hi: 2100, centre: 2000 });
  assert.equal(s.pitch, 0.7);
  assert.equal(s.f2, 0.7);
  assert.equal(s.aboveComfortable, 0.3);
  const c = { kind: 'in-zone', share: 0.7, zones: ['pitch', 'f2'], minVoicedS: 0.5 } as const;
  assert.equal(evaluateInZone(c, s).passed, true);
  assert.equal(evaluateInZone({ ...c, minVoicedS: 5 }, s).passed, false);
});

test('unreliable formants are left out of the brightness share', () => {
  const f = Array(100).fill(0).map(() => ({ st: 55, f2Hz: 1000, formantConfidence: 0.2 }));
  const s = zoneShares(f, HOP, zone, { lo: 1900, hi: 2100, centre: 2000 });
  assert.equal(s.f2, null);
  // Pitch alone decides when brightness can't be measured.
  assert.equal(evaluateInZone({ kind: 'in-zone', share: 0.7, zones: ['pitch', 'f2'], minVoicedS: 0.5 }, s).passed, true);
});

test('staircase: ≥80% of the last 10 trials at the set level (§4.1 Unit 1)', () => {
  const c = { kind: 'staircase', accuracy: 0.8, level: 4, trials: 10 } as const;
  const trials = Array.from({ length: 10 }, (_, i) => ({ level: 4, correct: i !== 3 && i !== 7 }));
  assert.equal(evaluateStaircase(c, trials).passed, true);
  assert.equal(evaluateStaircase(c, trials.map((t, i) => ({ ...t, correct: i > 2 }))).passed, false);
  assert.equal(evaluateStaircase(c, trials.map((t) => ({ ...t, level: 3 }))).passed, false);
});

test('lighter weight: median ≤ −0.5 SD and never above the comfortable range', () => {
  const c = { kind: 'weight-lighter', sd: 0.5, sessions: 3 } as const;
  assert.equal(evaluateWeightLighter(c, { weightIndexes: [-0.4, -0.8, -0.6], aboveComfortable: false }).passed, true);
  assert.equal(evaluateWeightLighter(c, { weightIndexes: [-0.4, -0.8, -0.6], aboveComfortable: true }).passed, false);
  assert.equal(evaluateWeightLighter(c, { weightIndexes: [0.2, -0.3], aboveComfortable: false }).passed, false);
});

test('whisper: +8% F2 over the neutral whisper (§4.1 Unit 4)', () => {
  const c = { kind: 'whisper-rise', ratio: 1.08 } as const;
  assert.equal(evaluateWhisperRise(c, 2000, 2170).passed, true);
  assert.equal(evaluateWhisperRise(c, 2000, 2100).passed, false);
  assert.equal(evaluateWhisperRise(c, null, 2100).passed, false);
});

test('resonance target follows the goal', () => {
  assert.equal(resonanceTarget(0.5, 1, 0.1), 0.5);
  assert.equal(resonanceTarget(0.5, 0.5, 0.1), 0.5);
  assert.ok(Math.abs(resonanceTarget(0.5, null, 0.1) - 0.25) < 1e-9);
  const c = { kind: 'resonance-vowels', score: 0.5, vowels: 6 } as const;
  const scores = { iy: 0.6, ih: 0.55, ei: 0.7, eh: 0.5, ae: 0.52, ah: 0.4, uh: 0.61 };
  assert.equal(evaluateResonanceVowels(c, scores, 0.5).passed, true);
  assert.equal(evaluateResonanceVowels(c, { ...scores, uh: null }, 0.5).passed, false);
});

test('melody: +3 ST over the reference, and rising questions (E15, §3.5)', () => {
  const c = { kind: 'st-range', overReferenceSt: 3, risingShare: 0.5 } as const;
  const u = [
    { rangeSt: 8, terminalSlopeStPerS: -1, question: false },
    { rangeSt: 9, terminalSlopeStPerS: 4, question: true },
    { rangeSt: 7, terminalSlopeStPerS: 3, question: true },
  ];
  assert.equal(evaluateStRange(c, u, 5).passed, true);
  assert.equal(evaluateStRange(c, u, 6).passed, false);
  assert.equal(evaluateStRange(c, u.map((x) => ({ ...x, terminalSlopeStPerS: 0 })), 5).passed, false);
  assert.equal(evaluateStRange(c, u, null).passed, false);
});

test('free speech and self-rating', () => {
  const fs = { kind: 'free-speech-stable', sessions: 3, spreadSt: 1.5, minVoicedS: 20 } as const;
  assert.equal(evaluateFreeSpeech(fs, { medianSt: 55, voicedS: 25 }, zone).passed, true);
  assert.equal(evaluateFreeSpeech(fs, { medianSt: 58.5, voicedS: 25 }, zone).passed, false);
  assert.equal(evaluateFreeSpeech(fs, { medianSt: 55, voicedS: 10 }, zone).passed, false);
  const sr = { kind: 'self-rated', minRating: 6, share: 0.5 } as const;
  assert.equal(evaluateSelfRated(sr, 7, 0.6).passed, true);
  assert.equal(evaluateSelfRated(sr, 5, 0.6).passed, false);
  assert.equal(evaluateSelfRated(sr, 8, 0.3).passed, false);
});

const pass = (value: number | null = null): Outcome => ({ passed: true, value, performance: 1, why: '' });
const att = (exerciseId: string, sessionId: number, at: number, outcome = pass()): AttemptRecord => ({ exerciseId, sessionId, at, outcome });

test('multi-session gates: three sessions for weight, stable free speech', () => {
  const w = { kind: 'weight-lighter', sd: 0.5, sessions: 3 } as const;
  assert.equal(gateMet(w, [att('x', 1, 1), att('x', 1, 2), att('x', 2, 3)], { baselineStored: true }), false);
  assert.equal(gateMet(w, [att('x', 1, 1), att('x', 2, 2), att('x', 3, 3)], { baselineStored: true }), true);
  const f = { kind: 'free-speech-stable', sessions: 3, spreadSt: 1.5, minVoicedS: 20 } as const;
  const steady = [att('y', 1, 1, pass(55)), att('y', 2, 2, pass(55.5)), att('y', 3, 3, pass(56))];
  assert.equal(gateMet(f, steady, { baselineStored: true }), true);
  const drifting = [att('y', 1, 1, pass(54)), att('y', 2, 2, pass(55.5)), att('y', 3, 3, pass(56))];
  assert.equal(gateMet(f, drifting, { baselineStored: true }), false);
});

// ——— Progress ———

/** Passes every exercise of a lesson. */
function passLesson(lessonId: string, sessionId = 1): AttemptRecord[] {
  const lesson = CURRICULUM.units.flatMap((u) => u.lessons).find((l) => l.id === lessonId)!;
  return lesson.exercises.map((e, i) => att(e.id, sessionId, sessionId * 100 + i));
}

test('a fresh user starts at Unit 0 and the rest is locked', () => {
  const p = progress(CURRICULUM, 'default', [], { baselineStored: false });
  assert.equal(p[0].status, 'open');
  assert.ok(p.slice(1).every((u) => u.status === 'locked'));
  assert.equal(nextLesson(p)?.lesson.id, 'u0-l1');
  assert.equal(lessonOpen(p, 'u0-l2'), false);
});

test('storing a baseline completes Unit 0 and opens Unit 1', () => {
  const attempts = passLesson('u0-l1');
  const p = progress(CURRICULUM, 'default', attempts, { baselineStored: true });
  assert.equal(p[0].status, 'complete');
  assert.equal(p[1].status, 'open');
  assert.equal(nextLesson(p)?.lesson.id, 'u1-l1');
});

test('the resonance-first track opens Size after Hearing', () => {
  const attempts = [...passLesson('u0-l1'), ...['u1-l1', 'u1-l2', 'u1-l3', 'u1-l4', 'u1-l5'].flatMap((l) => passLesson(l))];
  const fwd = progress(CURRICULUM, 'resonance-first', attempts, { baselineStored: true });
  assert.equal(fwd[2].unit.id, 'u4');
  assert.equal(fwd[2].status, 'open');
  const def = progress(CURRICULUM, 'default', attempts, { baselineStored: true });
  assert.equal(def[2].unit.id, 'u2');
  assert.equal(def.find((u) => u.unit.id === 'u4')!.status, 'locked');
});

test('a failed checkpoint keeps the next unit locked', () => {
  const attempts = [
    ...passLesson('u0-l1'),
    ...['u1-l1', 'u1-l2', 'u1-l3', 'u1-l4'].flatMap((l) => passLesson(l)),
    att('u1-check', 2, 999, { passed: false, value: 0.6, performance: 0.75, why: '' }),
  ];
  const p = progress(CURRICULUM, 'default', attempts, { baselineStored: true });
  assert.equal(p[1].status, 'open');
  assert.equal(p[2].status, 'locked');
  assert.equal(nextLesson(p)?.lesson.id, 'u1-l5');
});

test('pitch targets stay under the comfortable p90 and inside the range', () => {
  const t = pitchTargets([0, 2, 4, -6], { lo: 53, hi: 56, centre: 55, comfortableP90St: 56 }, 50);
  assert.deepEqual(t, [55, 55.5, 55.5, 50]);
  assert.ok(t.every((x) => x <= 55.5));
});
