// Vocal-safety layer (Stage 5; handbook §2.4 and §4.2; decision D2).
//
// Hard-coded, not configurable: there is no setting that changes these
// numbers. They are the handbook's limits at their conservative ends:
// - a 3–5 minute SOVT warm-up before voiced practice, and a cool-down after;
// - short sessions: a ~20 minute soft cap per session, and a daily maximum
//   (10–20 minutes, two or three times a day → 60 minutes);
// - a hard stop on pain, a raw throat, hoarseness, rising effort, loss of
//   upper range or the voice cutting out;
// - referral copy (ENT/laryngologist + speech-language pathologist) for
//   hoarseness lasting more than about 2 weeks, pain on speaking, or blood.
// The strain monitor (feedback/strain.ts) adds the in-session rest prompts.

export const SAFETY = {
  /** Warm-up length: the low end of the handbook's 3–5 minutes. */
  warmupMinS: 180,
  /** Cool-down length; the handbook names the content, not a duration. */
  cooldownMinS: 60,
  /** A warm-up stays valid this long, so back-to-back lessons share one. */
  warmupValidMin: 60,
  /** Soft cap: at this much voiced practice in a session, the lesson moves to the cool-down. */
  sessionSoftCapMin: 20,
  /** Daily maximum of voiced practice: three 20-minute sessions. */
  dailyMaxMin: 60,
  /** Hoarseness reported over at least this span → referral copy. */
  referralHoarseDays: 14,
} as const;

export type Symptom =
  | 'pain'
  | 'raw-throat'
  | 'hoarse'
  | 'effort-rising'
  | 'lost-upper-range'
  | 'cutting-out'
  | 'blood';

export const SYMPTOMS: readonly Symptom[] = [
  'pain',
  'raw-throat',
  'hoarse',
  'effort-rising',
  'lost-upper-range',
  'cutting-out',
  'blood',
];

/** Signs that need someone to look at the voice now, not in two weeks. */
const URGENT: ReadonlySet<Symptom> = new Set(['pain', 'blood']);

export type SymptomReport = { at: number; symptoms: Symptom[] };

export type DayState = {
  /** Voiced practice so far today, in minutes. */
  voicedMinutesToday: number;
  /** A symptom was reported today: no voiced practice until tomorrow. */
  hardStopToday: boolean;
};

export type SessionSafety = {
  /** When the last warm-up finished (ms), or null. */
  warmupAt: number | null;
  cooldownDone: boolean;
  /** Voiced practice in this session, in minutes. */
  voicedMinutes: number;
};

export type Block = 'hard-stop' | 'daily-limit' | 'soft-cap' | 'warmup-needed';

/**
 * Whether a voiced exercise may start now. The cool-down is always allowed
 * unless there was a hard stop (then the voice rests completely). Silent
 * exercises (ear training, reading, journal) are never blocked.
 */
export function voicedBlock(
  kind: 'warmup' | 'cooldown' | 'practice',
  session: SessionSafety,
  day: DayState,
  now: number,
): Block | null {
  if (day.hardStopToday) return 'hard-stop';
  if (kind === 'cooldown') return null;
  if (day.voicedMinutesToday >= SAFETY.dailyMaxMin) return 'daily-limit';
  if (kind === 'warmup') return null;
  if (session.voicedMinutes >= SAFETY.sessionSoftCapMin) return 'soft-cap';
  if (!warmupValid(session.warmupAt, now)) return 'warmup-needed';
  return null;
}

export function warmupValid(warmupAt: number | null, now: number): boolean {
  return warmupAt != null && now - warmupAt <= SAFETY.warmupValidMin * 60_000 && now >= warmupAt;
}

/** A voiced session should end with the cool-down (§2.4). */
export function needsCooldown(session: SessionSafety): boolean {
  return session.voicedMinutes > 0 && !session.cooldownDone;
}

/** Any reported symptom stops voiced practice for the rest of the day (§2.4 stop rules). */
export function isHardStop(symptoms: Symptom[]): boolean {
  return symptoms.length > 0;
}

export type Referral = { urgent: boolean; reasons: Symptom[] } | null;

/**
 * Referral copy is shown for pain or blood at once, and for hoarseness
 * reported across at least two weeks (§2.4: "hoarseness lasting more than
 * about 2 weeks, pain on speaking, or blood → refer to an ENT/laryngologist
 * and an SLP").
 */
export function referral(reports: SymptomReport[], now: number): Referral {
  const recent = reports.filter((r) => r.at <= now);
  const latest = recent.reduce<SymptomReport | null>((a, r) => (a == null || r.at > a.at ? r : a), null);
  const urgent = latest ? latest.symptoms.filter((s) => URGENT.has(s)) : [];
  if (urgent.length) return { urgent: true, reasons: urgent };
  const hoarse = recent.filter((r) => r.symptoms.includes('hoarse')).map((r) => r.at);
  if (hoarse.length >= 2) {
    const span = (Math.max(...hoarse) - Math.min(...hoarse)) / 86_400_000;
    // Still hoarse: the latest report must be recent (within 3 days).
    if (span >= SAFETY.referralHoarseDays && now - Math.max(...hoarse) <= 3 * 86_400_000) {
      return { urgent: false, reasons: ['hoarse'] };
    }
  }
  return null;
}

/** Local calendar day key (YYYY-MM-DD) for day-based limits. */
export function dayKey(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
