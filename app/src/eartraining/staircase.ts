// Adaptive staircase for ear training (Stage 5; handbook §2.3: "make items
// adaptive with a staircase that shrinks the difference after correct
// answers"; build plan: "an adaptive staircase targets ~80%").
//
// Three correct in a row make the difference one level smaller; one wrong
// makes it one level larger. A 3-down/1-up rule converges on 79.4% correct
// (Levitt 1971), the handbook's ~80%.

import type { EarDimension } from '../curriculum/types.ts';

export const LEVELS = 10;

/**
 * The difference between the two sounds at each level, easiest first.
 * - pitch: semitones of F0, with formants held (from 4 ST down to 0.15 ST);
 * - brightness: formant scale in percent, with F0 held. The handbook's
 *   stimuli shift formants by ±5–20% (§2.3); the ladder starts at 20% and
 *   goes below 5% for listeners who get there. Level 4 (8%) is the Unit 1
 *   checkpoint, the same size as Unit 4's +8% whisper target;
 * - weight: dB of H1–H2 (lighter = larger), with F0 and formants held.
 *   H1–H2 rises with lighter, less pressed phonation (§3.4); spans of
 *   10 dB and more separate breathy from pressed voices.
 */
export const DIFFERENCES: Record<EarDimension, readonly number[]> = {
  pitch: [4, 3, 2, 1.5, 1, 0.75, 0.5, 0.35, 0.25, 0.15],
  brightness: [20, 16, 13, 10, 8, 6, 5, 4, 3, 2],
  weight: [12, 10, 8, 6, 5, 4, 3, 2, 1.5, 1],
};

export const UNITS: Record<EarDimension, string> = { pitch: 'semitones', brightness: '%', weight: 'dB' };

export type StaircaseState = {
  level: number;
  /** Correct answers in a row at this level. */
  streak: number;
  /** Fixed-level blocks (checkpoints) never move. */
  fixed: boolean;
  trials: { level: number; correct: boolean }[];
};

export function startStaircase(fixedLevel?: number): StaircaseState {
  return { level: fixedLevel ?? 0, streak: 0, fixed: fixedLevel != null, trials: [] };
}

export function answer(s: StaircaseState, correct: boolean): StaircaseState {
  const trials = [...s.trials, { level: s.level, correct }];
  if (s.fixed) return { ...s, trials };
  if (!correct) return { ...s, level: Math.max(0, s.level - 1), streak: 0, trials };
  if (s.streak + 1 >= 3) return { ...s, level: Math.min(LEVELS - 1, s.level + 1), streak: 0, trials };
  return { ...s, streak: s.streak + 1, trials };
}

export const difference = (dimension: EarDimension, level: number) => DIFFERENCES[dimension][level];
