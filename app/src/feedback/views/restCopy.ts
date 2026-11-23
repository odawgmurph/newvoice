// Copy for the rest prompt (Stage 3 strain monitor, handbook §2.4).
// Education-only wording (decision D3): no diagnosis, no treatment claims.

import type { StrainReason } from '../strain.ts';

export const REASON_TEXT: Record<StrainReason, string> = {
  'jitter-rising': 'Your voice has become less steady from cycle to cycle over this session.',
  'shimmer-rising': 'The loudness of your voice has become less even from cycle to cycle over this session.',
  'cpps-falling': 'Your voice has become less clear (more air or noise in it) over this session.',
  'above-comfortable-range': 'That phrase went above your comfortable range.',
  effort: 'You said this is taking a lot of effort.',
};

export const REST_TITLE = 'Time for a short rest';

export const REST_BODY =
  'These are common signs that a voice is getting tired. Rest for a few minutes: sip some water, breathe, ' +
  'and hum gently if that feels good. Come back when your voice feels easy again.';

export const STOP_RULES =
  'Stop for today if practice hurts, your throat feels raw or scratchy, you sound hoarse afterwards, or your ' +
  'voice cuts out. If hoarseness lasts more than about two weeks, or speaking hurts, see a doctor (an ENT) ' +
  'and a speech-language pathologist.';

export const EFFORT_QUESTION = 'How much effort does this take right now? (0 = none, 10 = the most)';

/** Plain-words lines for the reasons raised, in a stable order. */
export function reasonLines(reasons: StrainReason[]): string[] {
  const order = Object.keys(REASON_TEXT) as StrainReason[];
  return order.filter((r) => reasons.includes(r)).map((r) => REASON_TEXT[r]);
}
