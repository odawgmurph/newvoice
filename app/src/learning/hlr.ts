// Skill refresher scheduling: half-life regression adapted to motor skills
// (Stage 6; handbook §4.2; decision D22).
//
// Settles & Meeder (ACL 2016) model recall as p = 2^(−Δ/h) with half-life
// h = 2^(θ·x), x a skill's practice history. The handbook asks for an
// adaptation: "motor skills decay differently, so … schedule skill
// refreshers from measured performance decay". So here p is not recall but
// how much of a skill's criterion the user still meets on a refresher
// (Outcome.performance, 0–1), and θ is learned per skill on the phone from
// those measurements, with the paper's loss, two changes for single online
// updates on a phone:
//   L = (p − p̂)² + α (log2 h − log2 ĥ)² + λ‖θ − θ₀‖²,  ĥ = −Δ / log2(p̂).
// The half-life term is in log space (the paper's (h − ĥ)² overshoots and
// diverges when updated one attempt at a time, because h is exponential in
// θ), and the regulariser pulls toward the starting weights, not zero.
// Written from the paper's equations, not from Duolingo's code (D5).

/** Features: bias, √(1 + successes), √(1 + failures) — the paper's count transform. */
export type Weights = [number, number, number];

/**
 * Starting weights, before any refresher has been measured: about a day
 * after the first success, ~3 days after 9 and ~12 days after 25. Failures
 * shorten it.
 */
export const DEFAULT_WEIGHTS: Weights = [-1, 1, -0.5];

/** The paper's hyperparameters (α, λ) and a learning rate small enough for single updates on a phone. */
export const HLR = { alpha: 0.1, lambda: 0.01, learningRate: 0.05, minHalfLifeDays: 0.25, maxHalfLifeDays: 120 } as const;

/** A refresher is due once predicted performance falls to this (half-life: 0.5). */
export const REFRESH_BELOW = 0.5;

export type SkillMemory = {
  weights: Weights;
  successes: number;
  failures: number;
  /** Last attempt that met the criterion (ms). */
  lastSuccessAt: number | null;
};

const features = (m: Pick<SkillMemory, 'successes' | 'failures'>): Weights => [1, Math.sqrt(1 + m.successes), Math.sqrt(1 + m.failures)];
const dot = (a: Weights, b: Weights) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const clampH = (h: number) => Math.min(HLR.maxHalfLifeDays, Math.max(HLR.minHalfLifeDays, h));

export function halfLifeDays(m: SkillMemory): number {
  return clampH(2 ** dot(m.weights, features(m)));
}

/** Predicted performance (0–1) after `lagDays` without practice. */
export function predicted(m: SkillMemory, lagDays: number): number {
  return 2 ** (-Math.max(0, lagDays) / halfLifeDays(m));
}

export const DAY_MS = 86_400_000;

/** When the next refresher is due: where predicted performance reaches REFRESH_BELOW. */
export function dueAt(m: SkillMemory): number | null {
  if (m.lastSuccessAt == null) return null;
  return m.lastSuccessAt + -Math.log2(REFRESH_BELOW) * halfLifeDays(m) * DAY_MS;
}

/**
 * Learns from one measured attempt at lag Δ (days since the last success).
 * Only attempts with a previous success carry decay information; the
 * first success just starts the clock.
 */
export function update(m: SkillMemory, performance: number, passed: boolean, at: number): SkillMemory {
  let weights = m.weights;
  if (m.lastSuccessAt != null && at > m.lastSuccessAt) {
    const lag = (at - m.lastSuccessAt) / DAY_MS;
    const pObs = Math.min(0.9999, Math.max(0.0001, performance));
    const hObs = clampH(-lag / Math.log2(pObs));
    const x = features(m);
    const h = halfLifeDays(m);
    const p = 2 ** (-lag / h);
    const ln2 = Math.LN2;
    // dL/dθ = 2(p − p̂)·p·ln²2·(Δ/h)·x + 2α(log2 h − log2 ĥ)·x + 2λ(θ − θ₀)
    const gp = 2 * (p - pObs) * p * ln2 * ln2 * (lag / h);
    const gh = 2 * HLR.alpha * (Math.log2(h) - Math.log2(hObs));
    weights = weights.map((w, i) => w - HLR.learningRate * ((gp + gh) * x[i] + 2 * HLR.lambda * (w - DEFAULT_WEIGHTS[i]))) as Weights;
  }
  return {
    weights,
    successes: m.successes + (passed ? 1 : 0),
    failures: m.failures + (passed ? 0 : 1),
    lastSuccessAt: passed ? at : m.lastSuccessAt,
  };
}

export const newMemory = (): SkillMemory => ({ weights: [...DEFAULT_WEIGHTS], successes: 0, failures: 0, lastSuccessAt: null });

/**
 * Mastery now: the stored mastery decayed by the predicted retention, so
 * "mastery levels decay with time since last successful performance" (§4.2).
 */
export function currentMastery(mastery: number, m: SkillMemory, now: number): number {
  if (m.lastSuccessAt == null) return 0;
  return mastery * predicted(m, (now - m.lastSuccessAt) / DAY_MS);
}
