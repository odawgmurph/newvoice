// Strain monitor (Stage 3, handbook §2.4, decision D18).
//
// Any one warning sign asks for a rest: jitter or shimmer rising over the
// session, CPPS falling, an utterance's F0 above the user's comfortable
// 90th percentile, or self-reported effort of 6/10 or more. Trends compare
// the median of the last few scored utterances with the median of the
// first few since the session started (or since the last rest). The
// thresholds are calibrated in harness/validation/strain.py; the evidence
// is docs/validation/stage3-strain.md. Pure TypeScript, run by `npm test`.

import type { UtteranceSummary } from './types.ts';

export const STRAIN_RULES = {
  /** Scored utterances in the reference and recent windows. */
  window: 3,
  /** Trend rules start once this many scored utterances are in. */
  minScored: 6,
  /**
   * Jitter: recent / reference ratio and absolute rise (fraction). Healthy
   * read speech reached ×1.82 (+1.1 points) at most; deliberately strained
   * voices reached ×3.6 or more.
   */
  jitterRatio: 2.0,
  jitterRise: 0.005,
  /** Shimmer: healthy speech reached ×1.54 (+3.8 points); strained ×2.65 or more. */
  shimmerRatio: 1.8,
  shimmerRise: 0.03,
  /** CPPS drop (dB): healthy speech reached 3.7 dB; noisy (strained) voices 7.3 dB or more. */
  cppsDropDb: 5,
  /** Self-reported effort (0-10) at or above this asks for a rest. */
  effortLimit: 6,
} as const;

export type StrainReason =
  | 'jitter-rising'
  | 'shimmer-rising'
  | 'cpps-falling'
  | 'above-comfortable-range'
  | 'effort';

function median(values: number[]): number | null {
  const v = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (v.length === 0) return null;
  const mid = v.length >> 1;
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

type Measure = 'jitterLocal' | 'shimmerLocal' | 'cppsDb';

function windowMedian(part: UtteranceSummary[], key: Measure): number | null {
  return median(part.map((u) => u[key]).filter((v): v is number => v != null));
}

type Trend = { jitter: Pair; shimmer: Pair; cpps: Pair };
type Pair = { ref: number; recent: number } | null;

function trend(scored: UtteranceSummary[]): Trend | null {
  const w = STRAIN_RULES.window;
  if (scored.length < STRAIN_RULES.minScored) return null;
  const first = scored.slice(0, w);
  const last = scored.slice(-w);
  const pair = (key: Measure): Pair => {
    const ref = windowMedian(first, key);
    const recent = windowMedian(last, key);
    return ref == null || recent == null ? null : { ref, recent };
  };
  return { jitter: pair('jitterLocal'), shimmer: pair('shimmerLocal'), cpps: pair('cppsDb') };
}

/**
 * Last-window against first-window change of a list of utterances (scored
 * ones only): jitter and shimmer as ratios, CPPS as a drop in dB. `null`
 * until there are `minScored` scored utterances.
 */
export function trendRatios(
  utterances: UtteranceSummary[],
): { jitter: number; shimmer: number; cppsDrop: number } | null {
  const t = trend(utterances.filter((u) => u.scored));
  if (t == null) return null;
  const ratio = (p: Pair) => (p == null || p.ref <= 0 ? 1 : p.recent / p.ref);
  return {
    jitter: ratio(t.jitter),
    shimmer: ratio(t.shimmer),
    cppsDrop: t.cpps == null ? 0 : t.cpps.ref - t.cpps.recent,
  };
}

function rising(p: Pair, ratio: number, rise: number): boolean {
  return p != null && p.ref > 0 && p.recent / p.ref >= ratio && p.recent - p.ref >= rise;
}

export class StrainMonitor {
  private readonly comfortableP90St: number | null;
  /** Scored utterances since the session start or the last rest. */
  private scored: UtteranceSummary[] = [];
  /** Reasons already raised since the last rest (each is raised once). */
  private raised = new Set<StrainReason>();
  private pending = false;

  constructor(opts: { comfortableP90St: number | null }) {
    this.comfortableP90St = opts.comfortableP90St;
  }

  /** True from a trigger until `acknowledgeRest`. */
  get restPending(): boolean {
    return this.pending;
  }

  /** Feeds one finished utterance; returns the reasons it newly triggered. */
  addUtterance(u: UtteranceSummary): StrainReason[] {
    if (!u.scored) return [];
    this.scored.push(u);
    const found: StrainReason[] = [];
    if (
      this.comfortableP90St != null &&
      u.pitch != null &&
      u.pitch.medianSt > this.comfortableP90St
    ) {
      found.push('above-comfortable-range');
    }
    const t = trend(this.scored);
    if (t != null) {
      const r = STRAIN_RULES;
      if (rising(t.jitter, r.jitterRatio, r.jitterRise)) found.push('jitter-rising');
      if (rising(t.shimmer, r.shimmerRatio, r.shimmerRise)) found.push('shimmer-rising');
      if (t.cpps != null && t.cpps.ref - t.cpps.recent >= r.cppsDropDb) found.push('cpps-falling');
    }
    return this.raise(found);
  }

  /** Self-reported effort, 0-10. */
  reportEffort(rating: number): StrainReason[] {
    return rating >= STRAIN_RULES.effortLimit ? this.raise(['effort'], true) : [];
  }

  /**
   * The user rested. Trends start over: the next `window` scored
   * utterances become the new reference, so a voice that recovered is not
   * compared with its pre-rest best, and one that didn't is caught again.
   */
  acknowledgeRest(): void {
    this.pending = false;
    this.scored = [];
    this.raised.clear();
  }

  private raise(found: StrainReason[], always = false): StrainReason[] {
    // Effort is a direct report: every high rating counts. The acoustic
    // signs are raised once per rest period, so a persisting trend doesn't
    // prompt after every utterance.
    const fresh = always ? found : found.filter((r) => !this.raised.has(r));
    for (const r of fresh) this.raised.add(r);
    if (fresh.length > 0) this.pending = true;
    return fresh;
  }
}
