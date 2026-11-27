// Ear-training and tone stimuli, synthesised on the phone (Stage 5,
// decision D21).
//
// The handbook asks for stimuli that differ in one parameter only: "holding
// F0 fixed and shifting formants ±5–20%, or the reverse" (§2.3). A source–
// filter vowel does exactly that: a harmonic source at F0, shaped by a
// formant envelope. Each parameter is set independently, so a pair differs
// only in the dimension being trained, at any size the staircase asks for.
// harness/tests/test_eartraining.py measures rendered stimuli with Praat to
// check that they do (F0 ratio, formant ratio, H1–H2 difference).
//
// Pure TypeScript and deterministic for a given seed, so it runs under Node.

import type { EarDimension } from '../curriculum/types.ts';
import { REFERENCE_NORMS } from '../feedback/referenceNorms.ts';

export const SAMPLE_RATE = 22050;

export type VoiceParams = {
  f0Hz: number;
  /** F1–F5 in Hz. */
  formantsHz: number[];
  /** Formant scale factor (1 = as given): brightness. */
  formantScale: number;
  /** Added H1–H2 in dB (positive = lighter): weight. */
  lightnessDb: number;
  durationS: number;
};

/** Formant bandwidths (Hz): typical modal-voice values (Hawks & Miller-like). */
const BANDWIDTHS = [80, 100, 140, 200, 250];

/** Magnitude of a Klatt digital resonator at frequency f. */
function resonatorGain(f: number, fc: number, bw: number, fs: number): number {
  const T = 1 / fs;
  const C = -Math.exp(-2 * Math.PI * bw * T);
  const B = 2 * Math.exp(-Math.PI * bw * T) * Math.cos(2 * Math.PI * fc * T);
  const A = 1 - B - C;
  const w = 2 * Math.PI * f * T;
  // |1 − B e^{−jw} − C e^{−2jw}|
  const re = 1 - B * Math.cos(w) - C * Math.cos(2 * w);
  const im = B * Math.sin(w) + C * Math.sin(2 * w);
  return Math.abs(A) / Math.hypot(re, im);
}

/** Cascade formant envelope at frequency f. */
export function envelope(f: number, formants: number[], fs = SAMPLE_RATE): number {
  return formants.reduce((g, fc, i) => g * resonatorGain(f, fc, BANDWIDTHS[i] ?? 250, fs), 1);
}

/**
 * Source spectrum of harmonic k (1-based): −12 dB/octave glottal roll-off
 * plus +6 dB/octave lip radiation, so −6 dB/octave overall. Lightness raises
 * H1 by 0.8·Δ and steepens the slope by 0.2·Δ dB/octave, so H1–H2 rises by
 * exactly Δ and high harmonics weaken too (lighter = less high-frequency
 * energy, the alpha-ratio direction in §3.4).
 */
export function sourceAmplitude(k: number, lightnessDb: number): number {
  const slopeDbPerOct = -6 - 0.2 * lightnessDb;
  const h1Boost = k === 1 ? 0.8 * lightnessDb : 0;
  return 10 ** ((slopeDbPerOct * Math.log2(k) + h1Boost) / 20);
}

/** Renders a vowel: a harmonic sum with 40 ms raised-cosine ramps, RMS-normalised. */
export function renderVowel(p: VoiceParams, fs = SAMPLE_RATE, rms = 0.1): Float32Array {
  const n = Math.round(p.durationS * fs);
  const out = new Float32Array(n);
  const formants = p.formantsHz.map((f) => f * p.formantScale);
  const nyq = fs / 2 - 200;
  for (let k = 1; k * p.f0Hz < nyq; k++) {
    const f = k * p.f0Hz;
    const amp = sourceAmplitude(k, p.lightnessDb) * envelope(f, formants, fs);
    const w = (2 * Math.PI * f) / fs;
    // Fixed phases (alternating) keep the waveform deterministic.
    const phase = (k % 2) * (Math.PI / 2);
    for (let i = 0; i < n; i++) out[i] += amp * Math.sin(w * i + phase);
  }
  applyRamps(out, fs);
  return normalise(out, rms);
}

/** A pure tone (E1 starts with sine tones). */
export function renderSine(f0Hz: number, durationS: number, fs = SAMPLE_RATE, rms = 0.1): Float32Array {
  const n = Math.round(durationS * fs);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = Math.sin((2 * Math.PI * f0Hz * i) / fs);
  applyRamps(out, fs);
  return normalise(out, rms);
}

function applyRamps(x: Float32Array, fs: number, rampS = 0.04) {
  const r = Math.min(Math.round(rampS * fs), x.length >> 1);
  for (let i = 0; i < r; i++) {
    const g = 0.5 - 0.5 * Math.cos((Math.PI * i) / r);
    x[i] *= g;
    x[x.length - 1 - i] *= g;
  }
}

function normalise(x: Float32Array, rms: number): Float32Array {
  let s = 0;
  for (const v of x) s += v * v;
  const cur = Math.sqrt(s / Math.max(1, x.length));
  if (cur > 0) for (let i = 0; i < x.length; i++) x[i] *= rms / cur;
  return x;
}

/** Concatenates clips with silence between them. */
export function sequence(clips: Float32Array[], gapS = 0.4, fs = SAMPLE_RATE): Float32Array {
  const gap = Math.round(gapS * fs);
  const total = clips.reduce((s, c) => s + c.length, 0) + gap * Math.max(0, clips.length - 1);
  const out = new Float32Array(total);
  let at = 0;
  clips.forEach((c, i) => {
    out.set(c, at);
    at += c.length + (i < clips.length - 1 ? gap : 0);
  });
  return out;
}

/** 16-bit PCM mono WAV. */
export function wavBytes(x: Float32Array, fs = SAMPLE_RATE): Uint8Array {
  const buf = new ArrayBuffer(44 + x.length * 2);
  const v = new DataView(buf);
  const str = (o: number, s: string) => [...s].forEach((ch, i) => v.setUint8(o + i, ch.charCodeAt(0)));
  str(0, 'RIFF');
  v.setUint32(4, 36 + x.length * 2, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, fs, true);
  v.setUint32(28, fs * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, 'data');
  v.setUint32(40, x.length * 2, true);
  for (let i = 0; i < x.length; i++) v.setInt16(44 + i * 2, Math.round(Math.max(-1, Math.min(1, x[i])) * 32767), true);
  return new Uint8Array(buf);
}

// ——— Trials ———

/** Vowels the stimuli rove over; open and front vowels keep F1/F2 apart. */
export const STIMULUS_VOWELS = ['ah', 'ae', 'eh', 'ih'] as const;

/**
 * F1–F4 midway (geometric) between the two Hillenbrand groups for a vowel,
 * so the base stimulus sits between the references, not at either.
 * F4 and F5 aren't in the norms; F3 × 1.3 and × 1.6 place them typically.
 * Without an F5 the spectrum above F4 is empty, and LPC analysis (Praat,
 * the core) spends its fifth pole between F1 and F2.
 */
export function midFormants(vowel: string): number[] {
  const v = REFERENCE_NORMS.vowels[vowel];
  const f = [0, 1, 2].map((i) => Math.exp((v.low.logMean[i] + v.high.logMean[i]) / 2));
  return [f[0], f[1], f[2], f[2] * 1.3, f[2] * 1.6];
}

/** Small deterministic PRNG (mulberry32), so a trial can be re-rendered from its seed. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type Trial = {
  dimension: EarDimension;
  format: 'ab' | 'odd-one-out';
  difference: number;
  /** Parameters of each sound, in play order. */
  sounds: VoiceParams[];
  /** Index of the right answer: the higher/brighter/lighter one (ab) or the odd one. */
  answer: number;
};

/**
 * One trial. Base F0 (130–220 Hz) and vowel rove from trial to trial, so the
 * listener compares the two sounds, not a sound with memory. The changed
 * sound is the one shifted up (higher, brighter, lighter); in odd-one-out
 * the odd sound goes up or down by the difference.
 */
export function makeTrial(dimension: EarDimension, format: 'ab' | 'odd-one-out', difference: number, seed: number): Trial {
  const r = rng(seed);
  const vowel = STIMULUS_VOWELS[Math.floor(r() * STIMULUS_VOWELS.length)];
  const f0 = 130 * 2 ** ((r() * 9) / 12);
  const base: VoiceParams = { f0Hz: f0, formantsHz: midFormants(vowel), formantScale: 1, lightnessDb: 0, durationS: 0.6 };
  const sign = format === 'odd-one-out' && r() < 0.5 ? -1 : 1;
  // Shift each sound half the difference either way, so the pair is centred on the base.
  const shifted = (s: number): VoiceParams => {
    const d = (s * difference) / 2;
    if (dimension === 'pitch') return { ...base, f0Hz: f0 * 2 ** (d / 12) };
    if (dimension === 'brightness') return { ...base, formantScale: (1 + difference / 100) ** (s / 2) };
    return { ...base, lightnessDb: d };
  };
  const up = shifted(sign);
  const down = shifted(-sign);
  if (format === 'ab') {
    const answer = r() < 0.5 ? 0 : 1;
    return { dimension, format, difference, sounds: answer === 0 ? [up, down] : [down, up], answer };
  }
  const answer = Math.floor(r() * 3);
  const sounds = [0, 1, 2].map((i) => (i === answer ? up : down));
  return { dimension, format, difference, sounds, answer };
}

export function renderTrial(t: Trial, fs = SAMPLE_RATE): Float32Array {
  return sequence(t.sounds.map((s) => renderVowel(s, fs)), 0.4, fs);
}

/** A voice-like tone for pitch matching (E1 progression: tones → voice). */
export function renderPromptTone(f0Hz: number, kind: 'sine' | 'voice', durationS = 1.5, fs = SAMPLE_RATE): Float32Array {
  if (kind === 'sine') return renderSine(f0Hz, durationS, fs);
  // A hummed "mm": low F1 and weak upper formants.
  return renderVowel({ f0Hz, formantsHz: [280, 1300, 2500, 3300, 4200], formantScale: 1, lightnessDb: 4, durationS }, fs);
}
