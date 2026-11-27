// Pass criteria (Stage 5): the handbook's machine-checkable checks (§2.2,
// §4.1), as pure functions over what an exercise measured.
//
// Two levels:
// - `evaluate*` decides one attempt from its evidence;
// - `gateMet` decides a unit's unlock criterion from the stored attempts,
//   since some criteria span sessions ("over 3 sessions", "stable").
//
// Safety coupling everywhere (§2.4, §3.9): nothing above the comfortable
// p90 counts as success.

import { classifyPitch, classifyRange, type PitchZone, type Range } from '../feedback/zones.ts';
import type { Criterion } from './types.ts';

/** What an attempt is stored as (`attempt.outcome`). */
export type Outcome = {
  passed: boolean;
  /** The criterion's main number (share, cents, ratio…), for progress and refreshers. */
  value: number | null;
  /** 0–1: how close to passing, for the scheduler's performance measure (Stage 6). */
  performance: number;
  /** Knowledge of performance: why, in one neutral line (§2.5). */
  why: string;
};

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

export function median(values: number[]): number | null {
  const v = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (v.length === 0) return null;
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

// ——— E1 / Unit 2: pitch matching ———

/** Voiced runs may bridge this many unvoiced frames (30 ms), as the jitter tracker does (D10). */
export const MAX_GAP_FRAMES = 3;

/**
 * Longest hold (ms) whose median F0 is within `toleranceCents` of the
 * target: E1's "median F0 within ±50 cents of target for ≥600 ms of voiced
 * audio". Windows slide over runs of voiced frames (short gaps bridged);
 * a window whose median is above the comfortable p90 never counts.
 */
export function longestMatchMs(
  st: (number | null)[],
  hopS: number,
  targetSt: number,
  toleranceCents: number,
  comfortableP90St: number,
  capMs = 2000,
): number {
  const runs: number[][] = [];
  let run: number[] = [];
  let gap = 0;
  for (const v of st) {
    if (v == null || !Number.isFinite(v)) {
      gap++;
      if (gap > MAX_GAP_FRAMES && run.length) {
        runs.push(run);
        run = [];
      }
      continue;
    }
    gap = 0;
    run.push(v);
  }
  if (run.length) runs.push(run);
  const tol = toleranceCents / 100;
  const cap = Math.max(1, Math.round(capMs / 1000 / hopS));
  const ok = (m: number) => Math.abs(m - targetSt) <= tol && m <= comfortableP90St;
  let best = 0;
  for (const r of runs) {
    // Grow the window length until no window of that length matches (or the cap).
    for (let n = best + 1; n <= Math.min(r.length, cap); n++) {
      if (!anyWindowMedian(r, n, ok)) break;
      best = n;
    }
  }
  return best * hopS * 1000;
}

/** Whether some window of `n` consecutive values has a median passing `ok` (sorted sliding window). */
function anyWindowMedian(values: number[], n: number, ok: (median: number) => boolean): boolean {
  const win = values.slice(0, n).sort((a, b) => a - b);
  const med = () => (n % 2 ? win[n >> 1] : (win[(n >> 1) - 1] + win[n >> 1]) / 2);
  if (ok(med())) return true;
  for (let i = n; i < values.length; i++) {
    win.splice(lowerBound(win, values[i - n]), 1);
    win.splice(lowerBound(win, values[i]), 0, values[i]);
    if (ok(med())) return true;
  }
  return false;
}

function lowerBound(sorted: number[], x: number): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export type PitchMatchItem = { targetSt: number; holdMs: number };

export function evaluatePitchMatch(
  c: Extract<Criterion, { kind: 'pitch-match' }>,
  items: PitchMatchItem[],
): Outcome {
  const hits = items.filter((i) => i.holdMs >= c.holdMs).length;
  return {
    passed: hits >= c.required,
    value: hits,
    performance: clamp01(hits / c.required),
    why: `${hits} of ${items.length} notes held for ${(c.holdMs / 1000).toFixed(1)} s within ${c.toleranceCents} cents.`,
  };
}

// ——— E14 / Unit 6: staying in the zones ———

export type ZoneFrame = { st: number | null; f2Hz: number | null; formantConfidence: number };

/** Formant frames below this confidence don't count either way (readout.ts hides them). */
export const ZONE_MIN_FORMANT_CONFIDENCE = 0.5;

export type ZoneShares = { pitch: number | null; f2: number | null; voicedS: number; aboveComfortable: number };

/** Shares of voiced frames in each zone; frames above the comfortable p90 count as out. */
export function zoneShares(frames: ZoneFrame[], hopS: number, pitch: PitchZone | null, f2: Range | null): ZoneShares {
  const voiced = frames.filter((f) => f.st != null && Number.isFinite(f.st));
  const above = pitch ? voiced.filter((f) => f.st! > pitch.comfortableP90St).length : 0;
  const pitchShare =
    pitch && voiced.length ? voiced.filter((f) => classifyPitch(f.st!, pitch) === 'in').length / voiced.length : null;
  const formant = voiced.filter((f) => f.f2Hz != null && f.formantConfidence >= ZONE_MIN_FORMANT_CONFIDENCE);
  const f2Share =
    f2 && formant.length
      ? formant.filter((f) => classifyRange(f.f2Hz!, f2) === 'in' && !(pitch && f.st! > pitch.comfortableP90St))
          .length / formant.length
      : null;
  return {
    pitch: pitchShare,
    f2: f2Share,
    voicedS: voiced.length * hopS,
    aboveComfortable: voiced.length ? above / voiced.length : 0,
  };
}

export function evaluateInZone(c: Extract<Criterion, { kind: 'in-zone' }>, s: ZoneShares): Outcome {
  if (s.voicedS < c.minVoicedS) {
    return { passed: false, value: null, performance: 0, why: 'Not enough voice to score yet. Keep going.' };
  }
  const shares = c.zones.map((z) => s[z]);
  // A zone that can't be measured (no baseline F2, or formants unreliable at
  // this pitch) is left out rather than failed; pitch is always required.
  if (shares[c.zones.indexOf('pitch')] === null && c.zones.includes('pitch')) {
    return { passed: false, value: null, performance: 0, why: 'No pitch zone yet: record your starting point first.' };
  }
  const known = shares.filter((v): v is number => v != null);
  const worst = known.length ? Math.min(...known) : 0;
  const parts = c.zones.map((z, i) =>
    shares[i] == null ? `${z === 'f2' ? 'brightness' : 'pitch'} not measurable` : `${Math.round(shares[i]! * 100)}% ${z === 'f2' ? 'brightness' : 'pitch'}`,
  );
  return {
    passed: known.length > 0 && worst >= c.share,
    value: worst,
    performance: clamp01(worst / c.share),
    why: `In your zones: ${parts.join(', ')} (aim: ${Math.round(c.share * 100)}%).`,
  };
}

// ——— Unit 1: ear-training staircase ———

export type Trial = { level: number; correct: boolean };

export function evaluateStaircase(c: Extract<Criterion, { kind: 'staircase' }>, trials: Trial[]): Outcome {
  const at = trials.filter((t) => t.level >= c.level).slice(-c.trials);
  const acc = at.length ? at.filter((t) => t.correct).length / at.length : 0;
  const enough = at.length >= c.trials;
  return {
    passed: enough && acc >= c.accuracy,
    value: at.length ? acc : null,
    performance: clamp01((acc / c.accuracy) * (at.length / c.trials)),
    why: enough
      ? `${Math.round(acc * 100)}% right on the finer differences.`
      : `${at.length} of ${c.trials} answers so far at the finer differences.`,
  };
}

// ——— Unit 3: lighter weight ———

export type WeightEvidence = { weightIndexes: number[]; aboveComfortable: boolean };

export function evaluateWeightLighter(c: Extract<Criterion, { kind: 'weight-lighter' }>, e: WeightEvidence): Outcome {
  const m = median(e.weightIndexes);
  if (m == null) return { passed: false, value: null, performance: 0, why: 'No weight reading yet: speak a little longer.' };
  const passed = m <= -c.sd && !e.aboveComfortable;
  return {
    passed,
    value: m,
    performance: clamp01(-m / c.sd),
    why: e.aboveComfortable
      ? 'Lighter, but above your comfortable range. Bring it down a little.'
      : m < 0
        ? `Lighter than your starting point by ${(-m).toFixed(1)} SD.`
        : 'About as heavy as your starting point.',
  };
}

// ——— Unit 4: whispered size ———

export function evaluateWhisperRise(
  c: Extract<Criterion, { kind: 'whisper-rise' }>,
  referenceF2Hz: number | null,
  targetF2Hz: number | null,
): Outcome {
  if (referenceF2Hz == null || targetF2Hz == null) {
    return { passed: false, value: null, performance: 0, why: 'The whisper was too quiet to measure. Try a little closer to the phone.' };
  }
  const ratio = targetF2Hz / referenceF2Hz;
  const pct = Math.round((ratio - 1) * 100);
  return {
    passed: ratio >= c.ratio,
    value: ratio,
    performance: clamp01((ratio - 1) / (c.ratio - 1)),
    why: `${pct >= 0 ? pct + '% brighter' : -pct + '% darker'} than your ordinary whisper (aim: ${Math.round((c.ratio - 1) * 100)}%).`,
  };
}

// ——— Unit 5: brightness across vowels ———

/**
 * The resonance target for the user's goal. The handbook's Unit 5 criterion
 * is a score ≥ 0.5 (§4.1), the midpoint between the reference groups; for
 * the "own" goal, which has no reference position, it is the baseline
 * score + 0.15 (half a single token's median error, D11), capped at 0.5.
 */
export function resonanceTarget(score: number, goalPosition: number | null, baselineScore: number | null): number {
  if (goalPosition != null) return Math.min(score, goalPosition);
  if (baselineScore != null) return Math.min(score, baselineScore + 0.15);
  return score;
}

export function evaluateResonanceVowels(
  c: Extract<Criterion, { kind: 'resonance-vowels' }>,
  scores: Record<string, number | null>,
  target: number,
): Outcome {
  const measured = Object.values(scores).filter((v): v is number => v != null);
  const hits = measured.filter((v) => v >= target).length;
  return {
    passed: hits >= c.vowels,
    value: hits,
    performance: clamp01(hits / c.vowels),
    why: `${hits} of ${c.vowels} vowels bright enough${measured.length < Object.keys(scores).length ? '; some could not be measured at this pitch' : ''}.`,
  };
}

// ——— Unit 7: melody ———

export type MelodyUtterance = { rangeSt: number; terminalSlopeStPerS: number | null; question: boolean };

/** Rising terminal contour: the last 300 ms rise faster than +2 ST/s (§3.5). */
export const RISING_SLOPE_ST_PER_S = 2;

export function evaluateStRange(
  c: Extract<Criterion, { kind: 'st-range' }>,
  utterances: MelodyUtterance[],
  referenceRangeSt: number | null,
): Outcome {
  const range = median(utterances.map((u) => u.rangeSt));
  if (range == null || referenceRangeSt == null) {
    return { passed: false, value: null, performance: 0, why: 'Record your everyday version first, then try again.' };
  }
  const gain = range - referenceRangeSt;
  const questions = utterances.filter((u) => u.question && u.terminalSlopeStPerS != null);
  const rising = questions.length
    ? questions.filter((u) => u.terminalSlopeStPerS! > RISING_SLOPE_ST_PER_S).length / questions.length
    : null;
  const risingOk = c.risingShare == null || (rising != null && rising >= c.risingShare);
  return {
    passed: gain >= c.overReferenceSt && risingOk,
    value: gain,
    performance: clamp01(gain / c.overReferenceSt),
    why:
      `Melody range ${gain >= 0 ? '+' : ''}${gain.toFixed(1)} semitones over your everyday reading` +
      (rising != null ? `; ${Math.round(rising * 100)}% of questions rose at the end.` : '.'),
  };
}

// ——— Unit 9: free speech ———

export type FreeSpeechEvidence = { medianSt: number | null; voicedS: number };

export function evaluateFreeSpeech(
  c: Extract<Criterion, { kind: 'free-speech-stable' }>,
  e: FreeSpeechEvidence,
  zone: PitchZone | null,
): Outcome {
  if (e.voicedS < c.minVoicedS || e.medianSt == null) {
    return { passed: false, value: null, performance: clamp01(e.voicedS / c.minVoicedS) * 0.5, why: 'Talk a little longer so there is enough to measure.' };
  }
  if (!zone) return { passed: false, value: e.medianSt, performance: 0, why: 'No pitch zone yet: record your starting point first.' };
  const cls = classifyPitch(e.medianSt, zone);
  return {
    passed: cls === 'in',
    value: e.medianSt,
    performance: cls === 'in' ? 1 : 0.5,
    why:
      cls === 'in'
        ? 'Your talking pitch stayed in your zone.'
        : cls === 'above-comfortable'
          ? 'Above your comfortable range. Ease down.'
          : cls === 'above'
            ? 'A little above your zone.'
            : 'A little below your zone.',
  };
}

// ——— Unit 8: self-rated with metrics ———

export function evaluateSelfRated(c: Extract<Criterion, { kind: 'self-rated' }>, rating: number | null, share: number | null): Outcome {
  const r = rating ?? 0;
  const s = share ?? 0;
  return {
    passed: rating != null && r >= c.minRating && s >= c.share,
    value: s,
    performance: clamp01(Math.min(r / c.minRating, share == null ? 0 : s / c.share)),
    why: `You rated it ${r}/10; ${Math.round(s * 100)}% of it was in your pitch zone.`,
  };
}

export const completed = (why = 'Done.'): Outcome => ({ passed: true, value: null, performance: 1, why });

// ——— Unlock criteria across attempts ———

/** A stored attempt, as far as gates need it. */
export type AttemptRecord = { exerciseId: string; sessionId: number | null; at: number; outcome: Outcome };

/**
 * Whether a unit's unlock criterion is met by the stored attempts of its
 * gate exercise. Most criteria need one passing attempt; "weight-lighter"
 * needs passes in N separate sessions (§4.1 "over 3 sessions"), and
 * "free-speech-stable" needs N passing sessions whose medians agree within
 * spreadSt ("stable metrics in free speech").
 */
export function gateMet(c: Criterion, attempts: AttemptRecord[], ctx: { baselineStored: boolean }): boolean {
  if (c.kind === 'baseline-stored') return ctx.baselineStored;
  const passed = attempts.filter((a) => a.outcome.passed);
  if (c.kind === 'weight-lighter') {
    return new Set(passed.map((a) => a.sessionId ?? `t${a.at}`)).size >= c.sessions;
  }
  if (c.kind === 'free-speech-stable') {
    // The latest passing attempt from each session, most recent sessions first.
    const bySession = new Map<string, AttemptRecord>();
    for (const a of [...passed].sort((x, y) => y.at - x.at)) {
      const k = String(a.sessionId ?? `t${a.at}`);
      if (!bySession.has(k)) bySession.set(k, a);
    }
    const recent = [...bySession.values()].slice(0, c.sessions).map((a) => a.outcome.value!);
    if (recent.length < c.sessions) return false;
    return Math.max(...recent) - Math.min(...recent) <= c.spreadSt;
  }
  return passed.length > 0;
}
