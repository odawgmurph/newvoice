// Pure geometry for the feedback views (Stage 3): axes, the pitch ×
// resonance map, and F1×F2 reference ellipses. No drawing code, so it is
// tested under Node.

export type Axis = { min: number; max: number };
export type Size = { width: number; height: number };
export type Point = { x: number; y: number };

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** Semitone axis: higher pitch is higher on screen (§1.2: pitch in ST). */
export function stToY(st: number, axis: Axis, height: number): number {
  return height * (1 - (st - axis.min) / (axis.max - axis.min));
}

export function yToSt(y: number, axis: Axis, height: number): number {
  return axis.min + (1 - y / height) * (axis.max - axis.min);
}

/** Trace x: the newest time at the right edge, `windowS` seconds across. */
export function traceX(t: number, tEnd: number, windowS: number, width: number): number {
  return width * (1 - (tEnd - t) / windowS);
}

/**
 * A semitone axis that shows `around` (a baseline or zone) with room for
 * intonation, at least `span` semitones (an octave and a half by default).
 */
export function pitchAxis(around: number[], span = 18): Axis {
  const v = around.filter(Number.isFinite);
  if (v.length === 0) return { min: 40, max: 80 };
  const lo = Math.min(...v);
  const hi = Math.max(...v);
  const pad = Math.max(0, (span - (hi - lo)) / 2);
  return { min: Math.floor(lo - pad), max: Math.ceil(hi + pad) };
}

/** Octave gridlines (every C, MIDI multiples of 12) inside an axis. */
export function octaveLines(axis: Axis): number[] {
  const out = [];
  for (let st = Math.ceil(axis.min / 12) * 12; st <= axis.max; st += 12) out.push(st);
  return out;
}

/**
 * The pitch × resonance map (handbook §3.9, like AcousticGender.space's 2D
 * plot): resonance score across (darker left, brighter right), pitch up.
 * The resonance axis spans −0.5…1.5 so both reference means (0 and 1) sit
 * well inside it; points outside are pinned to the edge.
 */
export const RESONANCE_AXIS: Axis = { min: -0.5, max: 1.5 };

export function mapPoint(st: number, resonance: number, pitch: Axis, size: Size, res: Axis = RESONANCE_AXIS): Point {
  return {
    x: size.width * clamp01((resonance - res.min) / (res.max - res.min)),
    y: size.height * (1 - clamp01((st - pitch.min) / (pitch.max - pitch.min))),
  };
}

/**
 * The F1×F2 vowel chart in the phonetic orientation: F2 decreasing to the
 * right (front vowels left), F1 increasing downwards (close vowels at the
 * top). Log-frequency axes, as the resonance score is log-based (D11).
 */
export type VowelAxes = { f1: Axis; f2: Axis };

export const VOWEL_AXES: VowelAxes = { f1: { min: 200, max: 1200 }, f2: { min: 700, max: 3200 } };

export function vowelPoint(f1: number, f2: number, size: Size, axes: VowelAxes = VOWEL_AXES): Point {
  const lx = (Math.log(axes.f2.max) - Math.log(f2)) / (Math.log(axes.f2.max) - Math.log(axes.f2.min));
  const ly = (Math.log(f1) - Math.log(axes.f1.min)) / (Math.log(axes.f1.max) - Math.log(axes.f1.min));
  return { x: size.width * clamp01(lx), y: size.height * clamp01(ly) };
}

/**
 * Points (in Hz) on the k-SD ellipse of a 2D Gaussian with the given mean
 * and covariance [[var1, cov], [cov, var2]], from the covariance's
 * eigen-decomposition. k = 1 holds about 39% of tokens, k = 2 about 86%.
 */
export function ellipse(mean: [number, number], cov: [[number, number], [number, number]], k = 1, n = 48): [number, number][] {
  const [[a, b], [, d]] = cov;
  const tr = a + d;
  const disc = Math.sqrt(Math.max(0, ((a - d) / 2) ** 2 + b * b));
  const l1 = tr / 2 + disc;
  const l2 = Math.max(0, tr / 2 - disc);
  // Eigenvector of l1.
  const theta = b === 0 ? (a >= d ? 0 : Math.PI / 2) : Math.atan2(l1 - a, b);
  const r1 = k * Math.sqrt(l1);
  const r2 = k * Math.sqrt(l2);
  const out: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const t = (2 * Math.PI * i) / n;
    const u = r1 * Math.cos(t);
    const v = r2 * Math.sin(t);
    out.push([mean[0] + u * Math.cos(theta) - v * Math.sin(theta), mean[1] + u * Math.sin(theta) + v * Math.cos(theta)]);
  }
  return out;
}
