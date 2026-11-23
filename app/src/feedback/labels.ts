// Feedback labels (Stage 3, decision D2).
//
// Handbook §3.6 and §4.3: never label the user's voice by gender by default;
// use "lighter/heavier", "brighter/darker", "higher/lower". Reference bands
// named after the reference groups appear only when the user opts in
// (user.genderedBands). Every user-facing label for the feedback views comes
// from here, and labels.test.ts fails if a gendered word appears anywhere
// else in src/feedback or the practice screen.

import type { Dimension } from './types.ts';

/** Words that gender a voice. The audit test searches for these. */
// <audit-list>
export const GENDERED_TERMS = [
  'male',
  'female',
  'man',
  'men',
  'woman',
  'women',
  'masculine',
  'feminine',
  'masc',
  'femme',
  'boy',
  'girl',
  'guy',
  'lady',
  'ladies',
  'gentleman',
  'gentlemen',
] as const;
// </audit-list>

/** Neutral words for each dimension: the label for a positive and a negative change. */
export const NEUTRAL_LABELS: Record<Dimension, { up: string; down: string; noun: string }> = {
  // Pitch in semitones: up = higher.
  pitch: { up: 'higher', down: 'lower', noun: 'pitch' },
  // Resonance score and F2: up = brighter (shorter apparent vocal tract, §1.3).
  resonance: { up: 'brighter', down: 'darker', noun: 'brightness' },
  // Weight index: positive = heavier than the baseline (WEIGHT_INDEX_VERSION 1).
  weight: { up: 'heavier', down: 'lighter', noun: 'weight' },
  // Terminal F0 slope: positive = rising (§3.5).
  intonation: { up: 'rising', down: 'falling', noun: 'melody' },
};

/**
 * The neutral word for a change of `delta` in a dimension, or "about the
 * same" when it is smaller than `steady` (in the dimension's own units).
 */
export function directionLabel(dimension: Dimension, delta: number, steady: number): string {
  if (!Number.isFinite(delta) || Math.abs(delta) < steady) return 'about the same';
  const l = NEUTRAL_LABELS[dimension];
  return delta > 0 ? l.up : l.down;
}

/** Names of the two ends of the resonance scale and the vowel chart's reference areas. */
export type ReferenceLabels = {
  /** The 0 end of the resonance scale. */
  low: string;
  /** The 1 end. */
  high: string;
  /** Where the names come from, for a caption. */
  source: string;
};

const NEUTRAL_REFERENCES: ReferenceLabels = {
  low: 'darker reference',
  high: 'brighter reference',
  source: 'Reference vowels: Hillenbrand et al. (1995).',
};

// <gendered-opt-in>
// Shown only when the user has opted in to gendered reference bands
// (Settings). The groups are the Hillenbrand (1995) adult speakers.
const OPT_IN_REFERENCES: ReferenceLabels = {
  low: 'typical adult men',
  high: 'typical adult women',
  source: 'Reference groups: adult men and women in Hillenbrand et al. (1995), American English.',
};
// </gendered-opt-in>

/** Labels for the reference areas: neutral unless the user opted in. */
export function referenceLabels(genderedBands: boolean): ReferenceLabels {
  return genderedBands ? OPT_IN_REFERENCES : NEUTRAL_REFERENCES;
}

/**
 * Whether views may draw the reference groups' pitch/resonance bands on the
 * pitch × resonance map. Only with the opt-in (§3.6: TruVox users liked
 * not having their voice gendered).
 */
export function showReferenceBands(genderedBands: boolean): boolean {
  return genderedBands;
}

/** Axis captions for the views; always neutral. */
export const AXIS_LABELS = {
  pitch: { low: 'lower', high: 'higher', unit: 'semitones' },
  resonance: { low: 'darker', high: 'brighter' },
  vowelF2: { low: 'darker', high: 'brighter', unit: 'F2 (Hz)' },
  vowelF1: { low: 'closer', high: 'more open', unit: 'F1 (Hz)' },
} as const;
