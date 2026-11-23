// Words for an utterance summary (Stage 3). Pure, so the copy is tested.
//
// Knowledge of results (where it landed) plus knowledge of performance
// (which way it moved and why, handbook §2.5), in neutral words (§4.3),
// baseline-relative (Recommendations 1), and never a pass/fail verdict.

import { directionLabel } from '../labels.ts';
import { formantVisibility, utteranceScoresVisible } from '../readout.ts';
import type { Baseline, UtteranceSummary } from '../types.ts';
import { classifyPitch, classifyRange, type PitchZone, type Range } from '../zones.ts';

export type SummaryLine = {
  /** What the line is about. */
  label: string;
  text: string;
  tone: 'neutral' | 'zone' | 'caution' | 'dim';
};

/** Below this, a change from the baseline reads "about the same". */
const STEADY = {
  // Half the ±50-cent pitch-matching tolerance of E1 (§2.2).
  pitchSt: 0.5,
  // Single-token resonance scores are noisy (D11: median error 0.15).
  resonance: 0.15,
  // Weight index is in baseline SDs.
  weight: 0.5,
};

/** A rising terminal contour: slope over the last 300 ms above +2 ST/s (§3.5). */
export const RISING_ST_PER_S = 2;

const fmt = (v: number, d = 1) => (Math.round(v * 10 ** d) / 10 ** d).toFixed(d);

export function summaryLines(
  u: UtteranceSummary,
  opts: { baseline: Baseline | null; pitchZone: PitchZone | null; f2Zone: Range | null },
): SummaryLine[] {
  if (!utteranceScoresVisible(u)) {
    return [
      {
        label: 'Short phrase',
        text: 'Keep going: a summary needs about a second of voice.',
        tone: 'dim',
      },
    ];
  }
  const p = u.pitch!;
  const lines: SummaryLine[] = [];
  const { baseline, pitchZone, f2Zone } = opts;

  // Pitch.
  let pitch = `${fmt(p.medianHz, 0)} Hz`;
  if (baseline) {
    const d = p.medianSt - baseline.medianSt;
    const dir = directionLabel('pitch', d, STEADY.pitchSt);
    pitch += dir === 'about the same' ? ', about where you started' : `, ${fmt(Math.abs(d))} semitones ${dir} than where you started`;
  }
  let tone: SummaryLine['tone'] = 'neutral';
  if (pitchZone) {
    const c = classifyPitch(p.medianSt, pitchZone);
    if (c === 'above-comfortable') {
      tone = 'caution';
      pitch += '. That is above your comfortable range; there is no need to go this high.';
    } else if (c === 'in') {
      tone = 'zone';
      pitch += '. In your zone.';
    } else {
      pitch += c === 'below' ? '. A little under your zone.' : '. A little over your zone.';
    }
  }
  lines.push({ label: 'Pitch', text: pitch, tone });

  // Melody (intonation, §1.6/§3.5): a style choice, described, not scored.
  let melody = `Range ${fmt(p.range5to95St)} semitones`;
  if (u.terminalSlopeStPerS != null) {
    const s = u.terminalSlopeStPerS;
    melody +=
      s > RISING_ST_PER_S ? ', ending on a rise' : s < -RISING_ST_PER_S ? ', ending on a fall' : ', ending level';
  }
  lines.push({ label: 'Melody', text: `${melody}.`, tone: 'neutral' });

  // Brightness: hidden when formants are unreliable (§3.9).
  const vis = formantVisibility(u.formantConfidence);
  if (vis === 'hidden') {
    lines.push({ label: 'Brightness', text: 'Not measured reliably on this phrase.', tone: 'dim' });
  } else {
    const parts: string[] = [];
    if (u.resonance != null && baseline?.resonance != null) {
      const dir = directionLabel('resonance', u.resonance - baseline.resonance, STEADY.resonance);
      parts.push(dir === 'about the same' ? 'about as bright as where you started' : `${dir} than where you started`);
    }
    if (u.f2Hz != null && f2Zone) {
      const c = classifyRange(u.f2Hz, f2Zone);
      parts.push(c === 'in' ? 'F2 in your zone' : c === 'below' ? 'F2 a little darker than your zone' : 'F2 a little brighter than your zone');
    } else if (u.f2Hz != null) {
      parts.push(`F2 ${fmt(u.f2Hz, 0)} Hz`);
    }
    if (parts.length > 0) {
      const text = parts.join('; ');
      lines.push({
        label: 'Brightness',
        text: `${text[0].toUpperCase()}${text.slice(1)}.`,
        tone: vis === 'dimmed' ? 'dim' : 'neutral',
      });
    }
  }

  // Weight: a proxy only (§1.4, §3.4).
  if (u.weightIndex != null) {
    const dir = directionLabel('weight', u.weightIndex, STEADY.weight);
    lines.push({
      label: 'Weight (rough guide)',
      text: dir === 'about the same' ? 'About where you started.' : `${dir[0].toUpperCase()}${dir.slice(1)} than where you started.`,
      tone: 'neutral',
    });
  }
  return lines;
}
