// From a capture (the core's frames and utterance summaries) to the
// evidence each criterion needs (Stage 5). Pure TypeScript, run by `npm test`.

import { median, ZONE_MIN_FORMANT_CONFIDENCE, type FreeSpeechEvidence, type MelodyUtterance, type WeightEvidence, type ZoneFrame } from '../curriculum/criteria.ts';
import type { Frame, UtteranceSummary } from '../feedback/types.ts';

export const HOP_S = 0.01;

/** Formant readings need at least half a second of confident frames (readout.ts uses rolling medians too). */
export const MIN_FORMANT_FRAMES = 50;

export const zoneFrames = (frames: Frame[]): ZoneFrame[] =>
  frames.map((f) => ({ st: f.f0St, f2Hz: f.f2Hz, formantConfidence: f.formantConfidence }));

export const pitchTrack = (frames: Frame[]) => frames.map((f) => f.f0St);

/**
 * Median F2 of a whisper. Whispered frames are unvoiced but above the
 * level gate, and the core gives them formants at confidence 0.5 (D11:
 * not yet calibrated); voiced frames count too if the user phonates.
 */
export function whisperF2(frames: Frame[]): number | null {
  const f2 = frames.filter((f) => f.f2Hz != null && f.formantConfidence >= ZONE_MIN_FORMANT_CONFIDENCE).map((f) => f.f2Hz!);
  return f2.length >= MIN_FORMANT_FRAMES ? median(f2) : null;
}

/** Weight indexes of scored utterances, and whether any went above the comfortable p90. */
export function weightEvidence(utterances: UtteranceSummary[], comfortableP90St: number | null): WeightEvidence {
  const scored = utterances.filter((u) => u.scored);
  return {
    weightIndexes: scored.map((u) => u.weightIndex).filter((v): v is number => v != null),
    aboveComfortable: comfortableP90St != null && scored.some((u) => u.pitch != null && u.pitch.medianSt > comfortableP90St),
  };
}

/**
 * Utterances of a line-by-line reading, each tagged with the line that was
 * showing when it started. `lineStarts[i]` is the stream time line i
 * appeared. Utterances need a pitch summary; scoring needs ≥1 s voiced
 * (§3.1), but short questions rarely reach it, so range uses any utterance
 * with ≥ 0.4 s voiced.
 */
export function melodyUtterances(utterances: UtteranceSummary[], lineStarts: number[], lines: string[]): MelodyUtterance[] {
  return utterances
    .filter((u) => u.pitch != null && u.voicedS >= 0.4)
    .map((u) => {
      let line = 0;
      for (let i = 0; i < lineStarts.length; i++) if (u.startS >= lineStarts[i] - 0.2) line = i;
      return {
        rangeSt: u.pitch!.range5to95St,
        terminalSlopeStPerS: u.terminalSlopeStPerS,
        question: (lines[line] ?? '').trim().endsWith('?'),
      };
    });
}

/** Median pitch and voiced time of free speech. */
export function freeSpeech(frames: Frame[]): FreeSpeechEvidence {
  const st = frames.map((f) => f.f0St).filter((v): v is number => v != null);
  return { medianSt: median(st), voicedS: st.length * HOP_S };
}

/**
 * A vowel's resonance score: the longest utterance scored against the
 * vowel when its formants are confident, else the median of confident
 * frames (at least half a second).
 */
export function vowelScore(utterances: UtteranceSummary[], frames: Frame[]): number | null {
  const u = utterances
    .filter((x) => x.resonance != null && x.formantConfidence >= ZONE_MIN_FORMANT_CONFIDENCE && x.voicedS >= 0.5)
    .sort((a, b) => b.voicedS - a.voicedS)[0];
  if (u) return u.resonance;
  const r = frames.filter((f) => f.resonance != null && f.formantConfidence >= ZONE_MIN_FORMANT_CONFIDENCE).map((f) => f.resonance!);
  return r.length >= MIN_FORMANT_FRAMES ? median(r) : null;
}

/** Median F2 of confident voiced frames (a vowel's brightness readout). */
export function voicedF2(frames: Frame[]): number | null {
  const f2 = frames.filter((f) => f.voiced && f.f2Hz != null && f.formantConfidence >= ZONE_MIN_FORMANT_CONFIDENCE).map((f) => f.f2Hz!);
  return f2.length >= MIN_FORMANT_FRAMES ? median(f2) : null;
}
