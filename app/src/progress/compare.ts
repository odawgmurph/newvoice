// Comparing two starting points (Stage 7 progress timeline, opt-in).
// Neutral words only (D2, D19): higher/lower, brighter/darker, wider/narrower.
// Pure TypeScript, run by `npm test`.

import type { BaselineSummary } from '../baseline/plan.ts';
import { directionLabel } from '../feedback/labels.ts';

export type ChangeLine = { label: string; text: string };

const st = (a: number, b: number) => 12 * Math.log2(b / a);

/** What changed from `from` to `to`, measured the same way both times. */
export function compareBaselines(from: BaselineSummary, to: BaselineSummary): ChangeLine[] {
  const out: ChangeLine[] = [];
  if (from.speaking && to.speaking) {
    const d = st(from.speaking.medianHz, to.speaking.medianHz);
    out.push({
      label: 'Everyday pitch',
      text: `${Math.round(from.speaking.medianHz)} → ${Math.round(to.speaking.medianHz)} Hz (${Math.abs(d).toFixed(1)} semitones ${directionLabel('pitch', d, 0.3)})`.replace(' semitones about the same', ', about the same'),
    });
  }
  if (from.comfortableRange && to.comfortableRange) {
    const d = to.comfortableRange.spanSt - from.comfortableRange.spanSt;
    out.push({
      label: 'Comfortable range',
      text: `${from.comfortableRange.spanSt.toFixed(1)} → ${to.comfortableRange.spanSt.toFixed(1)} semitones${Math.abs(d) < 0.5 ? ', about the same' : d > 0 ? ' (wider)' : ' (narrower)'}`,
    });
  }
  for (const [k, word] of [['i', 'ee'], ['a', 'ah'], ['u', 'oo']] as const) {
    const a = from.vowels[k]?.f2Hz;
    const b = to.vowels[k]?.f2Hz;
    const conf = Math.min(from.vowels[k]?.confidence ?? 0, to.vowels[k]?.confidence ?? 0);
    if (a == null || b == null || conf < 0.5) continue;
    const pct = (b / a - 1) * 100;
    out.push({
      label: `“${word}” brightness (F2)`,
      text: `${Math.round(a)} → ${Math.round(b)} Hz (${directionLabel('resonance', pct, 2)}${Math.abs(pct) >= 2 ? `, ${Math.abs(pct).toFixed(0)}%` : ''})`,
    });
  }
  return out;
}
