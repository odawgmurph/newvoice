// Robust readouts (Stage 3).
//
// Handbook §3.9 "Robustness: medians, minimum voiced duration, outlier
// rejection, and a confidence indicator that suppresses the display when
// confidence is low"; §3.1 "requiring ≥ 1–2 s of voiced audio for
// utterance-level scores"; §3.3 and the caveats: formants at high F0 are
// unreliable, so show confidence.

import type { Frame, UtteranceSummary } from './types.ts';

/**
 * Frames in a live readout's median: 15 × 10 ms. Longer than the core's
 * 5-frame outlier median (D11), so a readout number holds still long enough
 * to read, short enough to follow a slide.
 */
export const READOUT_MEDIAN_FRAMES = 15;

/** A running median over the last `size` finite values; null-safe. */
export class RollingMedian {
  private values: number[] = [];
  private readonly size: number;
  constructor(size = READOUT_MEDIAN_FRAMES) {
    this.size = size;
  }

  /** Adds a value (null/NaN = a gap: skipped) and returns the current median. */
  push(v: number | null | undefined): number | null {
    if (v != null && Number.isFinite(v)) {
      this.values.push(v);
      if (this.values.length > this.size) this.values.shift();
    }
    return this.value();
  }

  /** Median of the window, or null when it is empty. */
  value(): number | null {
    return median(this.values);
  }

  reset(): void {
    this.values = [];
  }
}

export function median(values: number[]): number | null {
  const v = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (v.length === 0) return null;
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

/**
 * Formant readouts below this confidence are hidden: about a 50% chance
 * that F1 or F2 is off by >10% (D11's fitted confidence; the capture spike
 * hides below the same value).
 */
export const FORMANT_HIDE_BELOW = 0.5;
/**
 * Between the hide threshold and this, readouts are shown dimmed (roughly a
 * 30–50% chance of a >10% error).
 */
export const FORMANT_DIM_BELOW = 0.7;

export type Visibility = 'shown' | 'dimmed' | 'hidden';

export function formantVisibility(confidence: number | null | undefined): Visibility {
  if (confidence == null || !Number.isFinite(confidence) || confidence < FORMANT_HIDE_BELOW) return 'hidden';
  return confidence < FORMANT_DIM_BELOW ? 'dimmed' : 'shown';
}

/** Utterance scores need ≥ 1 s voiced (§3.1); the core sets `scored`. */
export function utteranceScoresVisible(u: UtteranceSummary): boolean {
  return u.scored && u.pitch != null;
}

/** The live readouts for the newest frames, each a median with its visibility. */
export type LiveReadout = {
  pitchSt: number | null;
  f2Hz: number | null;
  f2Visibility: Visibility;
  resonance: number | null;
  resonanceVisibility: Visibility;
};

/**
 * Feeds frames into running medians. Formant values only enter their
 * median when the frame is at least dim-confident, so a run of unreliable
 * frames can't drag the number; the visibility follows the median
 * confidence of recent voiced frames.
 */
export class LiveReadouts {
  private pitch = new RollingMedian();
  private f2 = new RollingMedian();
  private resonance = new RollingMedian();
  private confidence = new RollingMedian();
  private current: LiveReadout = {
    pitchSt: null,
    f2Hz: null,
    f2Visibility: 'hidden',
    resonance: null,
    resonanceVisibility: 'hidden',
  };

  push(frames: Frame[]): LiveReadout {
    for (const f of frames) {
      if (f.f0St == null) continue;
      this.pitch.push(f.f0St);
      this.confidence.push(f.formantConfidence);
      if (f.formantConfidence >= FORMANT_HIDE_BELOW) {
        this.f2.push(f.f2Hz);
        this.resonance.push(f.resonance);
      }
    }
    const vis = formantVisibility(this.confidence.value());
    const f2 = this.f2.value();
    const res = this.resonance.value();
    this.current = {
      pitchSt: this.pitch.value(),
      f2Hz: f2,
      f2Visibility: f2 == null ? 'hidden' : vis,
      resonance: res,
      resonanceVisibility: res == null ? 'hidden' : vis,
    };
    return this.current;
  }

  get value(): LiveReadout {
    return this.current;
  }

  reset(): void {
    for (const m of [this.pitch, this.f2, this.resonance, this.confidence]) m.reset();
    this.current = { pitchSt: null, f2Hz: null, f2Visibility: 'hidden', resonance: null, resonanceVisibility: 'hidden' };
  }
}
