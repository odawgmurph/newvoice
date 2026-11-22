// Baseline- and goal-relative target zones (Stage 3).
//
// Handbook §3.9: "personalized zones from the baseline and goal, raised
// gradually (for example +1 ST or +3% F2 per mastered level)", and the
// safety coupling: "never reward F0 above the user's comfortable 90th
// percentile" (§2.4, §3.9). Zones are a coaching aid, never a pass/fail
// verdict (Recommendations 1).

import { REFERENCE_NORMS } from './referenceNorms.ts';
import type { Baseline, Goal, UtteranceSummary } from './types.ts';

/** Pitch target rises this much per mastered level (§3.9). */
export const PITCH_STEP_ST = 1;
/** Vowel F2 target rises this much per mastered level (§3.9). */
export const F2_STEP = 0.03;
/**
 * Half-width of the pitch zone around its centre. Speech that varies less
 * than about 2 ST (F0 SD) counts as monotone (§2.6), so a zone narrower
 * than ±2 ST would punish ordinary intonation.
 */
export const PITCH_HALF_WIDTH_ST = 2;
/** Half-width of the F2 zone: ±3%, one level's step (§3.9). */
export const F2_HALF_WIDTH = 0.03;

export const hzToSt = (hz: number) => 69 + 12 * Math.log2(hz / 440);
export const stToHz = (st: number) => 440 * 2 ** ((st - 69) / 12);

/**
 * Where each goal's pitch progression stops. The handbook's thresholds are
 * graded, not a cliff (Key Findings 2), so these only stop the automatic
 * +1 ST steps; the comfortable p90 always caps them first if lower.
 * - feminine / flexible: about 200 Hz (≈G3), the training pitch Sumian
 *   suggests for most learners (§1.2: coach sweet spot 170–200 Hz).
 *   "Flexible" trains the same range so the user can move within it.
 * - androgynous: the middle of the "gender-ambiguous" zone, about
 *   145–175 Hz (§1.2), i.e. its geometric centre ≈159 Hz.
 * - own: no goal ceiling; baseline-relative steps capped only by safety.
 */
export const GOAL_PITCH_CEILING_ST: Record<Goal, number | null> = {
  feminine: hzToSt(200), // audit: goal key
  flexible: hzToSt(200),
  androgynous: (hzToSt(145) + hzToSt(175)) / 2,
  own: null,
};

/**
 * Where each goal's F2 progression stops, as a position between the two
 * reference groups' vowel means on a log scale (0 = the low reference,
 * 1 = the high reference; the resonance score's scale, decision D11).
 * Feminine/flexible: the high reference mean (§1.3 table; E9 "F2 moves
 * toward the women's reference value"). Androgynous: the geometric
 * midpoint. Own: none.
 */
export const GOAL_RESONANCE_POSITION: Record<Goal, number | null> = {
  feminine: 1, // audit: goal key
  flexible: 1,
  androgynous: 0.5,
  own: null,
};

export type Range = { lo: number; hi: number; centre: number };

export type PitchZone = Range & {
  /** Frames and utterances above this are never rewarded (§2.4). */
  comfortableP90St: number;
};

/**
 * The pitch zone at a mastery level (0 = baseline). The centre climbs
 * +1 ST per level from the baseline median until the goal ceiling, and the
 * zone's top never passes the comfortable p90 (§2.4, §3.9). The centre
 * never goes below the baseline: zones raise targets, they don't lower a
 * voice that is already past the goal.
 */
export function pitchZone(baseline: Baseline, goal: Goal | null, level: number): PitchZone {
  const p90 = baseline.comfortableP90St;
  const ceiling = goal ? GOAL_PITCH_CEILING_ST[goal] : null;
  let centre = baseline.medianSt + PITCH_STEP_ST * Math.max(0, Math.floor(level));
  if (ceiling != null) centre = Math.min(centre, Math.max(ceiling, baseline.medianSt));
  centre = Math.min(centre, p90);
  const hi = Math.min(centre + PITCH_HALF_WIDTH_ST, p90);
  const lo = Math.min(centre - PITCH_HALF_WIDTH_ST, hi);
  return { lo, hi, centre, comfortableP90St: p90 };
}

/** F2 (Hz) at a position between the two references for a vowel (log scale). */
export function referenceF2(vowel: string, position: number): number | null {
  const v = REFERENCE_NORMS.vowels[vowel];
  if (!v) return null;
  const lo = v.low.logMean[1];
  const hi = v.high.logMean[1];
  return Math.exp(lo + position * (hi - lo));
}

/**
 * An F2's position between the two references for a vowel (0 = low mean,
 * 1 = high mean, log scale): the F2 term of the resonance score (D11), for
 * placing an F2 target on the pitch × resonance map.
 */
export function f2Position(vowel: string, f2Hz: number): number | null {
  const v = REFERENCE_NORMS.vowels[vowel];
  if (!v || !(f2Hz > 0)) return null;
  const lo = v.low.logMean[1];
  const hi = v.high.logMean[1];
  return (Math.log(f2Hz) - lo) / (hi - lo);
}

/**
 * The F2 zone for a vowel at a mastery level: baseline F2 × 1.03^level
 * (§3.9), capped at the goal's reference F2, never below the baseline.
 * `null` without a baseline F2 for that vowel.
 */
export function f2Zone(baseline: Baseline, goal: Goal | null, vowel: string, level: number): Range | null {
  const base = baseline.vowelF2Hz[vowel];
  if (base == null) return null;
  let centre = base * (1 + F2_STEP) ** Math.max(0, Math.floor(level));
  const pos = goal ? GOAL_RESONANCE_POSITION[goal] : null;
  const cap = pos != null ? referenceF2(vowel, pos) : null;
  if (cap != null) centre = Math.min(centre, Math.max(cap, base));
  return { lo: centre * (1 - F2_HALF_WIDTH), hi: centre * (1 + F2_HALF_WIDTH), centre };
}

export type ZoneClass = 'below' | 'in' | 'above' | 'above-comfortable';

/**
 * Where a pitch sits relative to the zone. 'above-comfortable' (over the
 * comfortable p90) is a caution, never a success (§2.4, §3.9).
 */
export function classifyPitch(st: number, zone: PitchZone): ZoneClass {
  if (st > zone.comfortableP90St) return 'above-comfortable';
  if (st > zone.hi) return 'above';
  if (st < zone.lo) return 'below';
  return 'in';
}

export function classifyRange(value: number, zone: Range): Exclude<ZoneClass, 'above-comfortable'> {
  if (value > zone.hi) return 'above';
  if (value < zone.lo) return 'below';
  return 'in';
}

/** Only 'in' earns credit; above the comfortable range never does. */
export const isRewarded = (c: ZoneClass) => c === 'in';

/**
 * Share of voiced pitch values in the zone. E14 ("lock and speak") counts
 * an attempt when ≥70% of voiced frames are in the personal zones (§2.2).
 */
export function inZoneShare(st: (number | null)[], zone: PitchZone): number | null {
  const voiced = st.filter((v): v is number => v != null && Number.isFinite(v));
  if (voiced.length === 0) return null;
  return voiced.filter((v) => classifyPitch(v, zone) === 'in').length / voiced.length;
}

/** E14's success share (§2.2). */
export const IN_ZONE_TARGET = 0.7;

/**
 * Voiced speech a provisional baseline needs: ten 1 s utterance scores'
 * worth (§3.1 asks ≥1–2 s per utterance score; a baseline pools several).
 */
export const PROVISIONAL_MIN_VOICED_S = 10;

function weightedMedian(pairs: [number, number][]): number | null {
  const v = pairs.filter(([x, w]) => Number.isFinite(x) && w > 0).sort((a, b) => a[0] - b[0]);
  const total = v.reduce((s, [, w]) => s + w, 0);
  if (total === 0) return null;
  let acc = 0;
  for (const [x, w] of v) {
    acc += w;
    if (acc >= total / 2) return x;
  }
  return v[v.length - 1][0];
}

/**
 * A provisional baseline from a practice session's scored utterances, until
 * Stage 4's baseline capture (sustained vowels, glide, passage) exists.
 * Pitch statistics are voiced-time-weighted medians of the utterances'.
 * The comfortable range should come from a glide (E2); without one, the
 * speaking p10/p90 stand in, which is conservative: speech covers less of
 * the range than a glide, so the safety ceiling sits lower. `null` until
 * there are 10 s of scored voiced speech.
 */
export function provisionalBaseline(utterances: UtteranceSummary[], vowel?: string): Baseline | null {
  const scored = utterances.filter((u) => u.scored && u.pitch != null);
  const voiced = scored.reduce((s, u) => s + u.voicedS, 0);
  if (voiced < PROVISIONAL_MIN_VOICED_S) return null;
  const wm = (get: (u: UtteranceSummary) => number | null) =>
    weightedMedian(scored.map((u) => [get(u) ?? Number.NaN, u.voicedS]));
  const medianSt = wm((u) => u.pitch!.medianSt)!;
  const p10St = wm((u) => u.pitch!.p10St)!;
  const p90St = wm((u) => u.pitch!.p90St)!;
  const f2 = wm((u) => (u.formantConfidence >= 0.5 ? u.f2Hz : null));
  const resonance = wm((u) => u.resonance);
  return {
    medianSt,
    p10St,
    p90St,
    comfortableP10St: p10St,
    comfortableP90St: p90St,
    vowelF2Hz: vowel && f2 != null ? { [vowel]: f2 } : {},
    resonance,
    source: 'provisional',
  };
}

/** Accepts stored JSON as a Baseline, or null when it isn't one. */
export function parseBaseline(value: unknown): Baseline | null {
  if (typeof value !== 'object' || value == null) return null;
  const b = value as Record<string, unknown>;
  const nums = ['medianSt', 'p10St', 'p90St', 'comfortableP10St', 'comfortableP90St'];
  if (!nums.every((k) => typeof b[k] === 'number' && Number.isFinite(b[k]))) return null;
  return {
    medianSt: b.medianSt as number,
    p10St: b.p10St as number,
    p90St: b.p90St as number,
    comfortableP10St: b.comfortableP10St as number,
    comfortableP90St: b.comfortableP90St as number,
    vowelF2Hz: typeof b.vowelF2Hz === 'object' && b.vowelF2Hz != null ? (b.vowelF2Hz as Record<string, number>) : {},
    resonance: typeof b.resonance === 'number' ? b.resonance : null,
    source: b.source === 'baseline' ? 'baseline' : 'provisional',
  };
}
