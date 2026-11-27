// Safety copy (Stage 5). Education-only wording (decision D3): no
// diagnosis, no treatment claims. Shared by the check-in, the stop button,
// the referral card and the limits.

import type { Block, Symptom } from './rules.ts';

export const SYMPTOM_TEXT: Record<Symptom, string> = {
  pain: 'It hurts to speak or practise',
  'raw-throat': 'My throat feels raw or scratchy',
  hoarse: 'I sound hoarse',
  'effort-rising': 'Speaking is taking more and more effort',
  'lost-upper-range': 'I can’t reach notes I usually can',
  'cutting-out': 'My voice is cutting out',
  blood: 'I’ve coughed up or seen blood',
};

export const CHECK_IN_QUESTION = 'Before you start: does any of this apply today?';
export const CHECK_IN_NONE = 'No, my voice feels fine';

export const HARD_STOP_TITLE = 'Rest your voice today';
export const HARD_STOP_BODY =
  'These are signs your voice needs a break. Voice practice is off until tomorrow. Listening lessons, ' +
  'reading and your journal are still open. Drink water and talk as little as is comfortable.';

export const REFERRAL_TITLE = 'Please get your voice checked';
export const REFERRAL_URGENT =
  'Pain when speaking, or blood, should be looked at soon. Please see a doctor, ideally an ear, nose and ' +
  'throat specialist (ENT) or a laryngologist, and pause voice practice until then.';
export const REFERRAL_HOARSE =
  'You’ve reported hoarseness for more than two weeks. Please see an ear, nose and throat specialist (ENT) ' +
  'or a laryngologist, and a speech-language pathologist, before practising more.';
export const REFERRAL_NOTE = 'NewVoice is an education app. It can’t tell what is causing this.';

export const BLOCK_TEXT: Record<Block, { title: string; body: string }> = {
  'hard-stop': { title: HARD_STOP_TITLE, body: HARD_STOP_BODY },
  'daily-limit': {
    title: 'That’s today’s voice practice',
    body: 'You’ve reached today’s limit of an hour. Short sessions spread over days build a voice better than long ones. Listening lessons are still open.',
  },
  'soft-cap': {
    title: 'Time to cool down',
    body: 'You’ve practised for about 20 minutes. Finish with the cool-down, rest, and come back later or tomorrow.',
  },
  'warmup-needed': {
    title: 'Warm up first',
    body: 'A three-minute warm-up comes before voice practice: gentle hums, lip trills or straw phonation.',
  },
};

export const STOP_BUTTON = 'Stop: something doesn’t feel right';
