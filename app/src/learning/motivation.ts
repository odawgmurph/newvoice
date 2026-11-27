// Streaks, XP and process metrics with guardrails (Stage 6; handbook §4.2,
// §2.7; decision D22). Pure.
//
// - Streaks credit rest days and freeze for voice rest or illness, so a
//   streak never pushes anyone to practise while their voice needs a break.
// - XP for voice use is capped per day, so practising past the limits earns
//   nothing. Listening has its own small cap.
// - No hearts or lives anywhere: failing a production task never costs
//   anything (§4.2).
// - What gets celebrated is process: minutes, consistency, range comfort
//   (§2.7), never how the voice "sounds" to others.

import { dayKey } from '../safety/rules.ts';

export const XP = {
  perVoicedMinute: 2,
  /** 20 voiced minutes' worth: practising past one session's soft cap earns nothing more. */
  voicedDailyCap: 40,
  perListenTrial: 0.5,
  listenDailyCap: 15,
  perLesson: 5,
  lessonDailyCap: 15,
} as const;

/** Missed days credited as rest per trailing 7 days, without breaking a streak. */
export const REST_CREDITS_PER_WEEK = 2;

export type DayActivity = { voicedMinutes: number; listenTrials: number; lessonsDone: number };

export function dailyXp(a: DayActivity): number {
  return (
    Math.min(XP.voicedDailyCap, Math.floor(a.voicedMinutes * XP.perVoicedMinute)) +
    Math.min(XP.listenDailyCap, Math.floor(a.listenTrials * XP.perListenTrial)) +
    Math.min(XP.lessonDailyCap, a.lessonsDone * XP.perLesson)
  );
}

export const MAX_DAILY_XP = XP.voicedDailyCap + XP.listenDailyCap + XP.lessonDailyCap;

export type StreakInput = {
  /** Day keys (YYYY-MM-DD) with any practice, listening included. */
  practiceDays: ReadonlySet<string>;
  /** Day keys the user marked as voice rest or illness, plus hard-stop days. */
  freezeDays: ReadonlySet<string>;
};

export type StreakDay = 'practice' | 'freeze' | 'rest' | 'missed';

/**
 * Days back from today. Today never breaks a streak (there's still time);
 * an earlier missed day is credited as rest while there are rest credits
 * left in the trailing week.
 */
export function streak(input: StreakInput, now: number): { days: number; history: StreakDay[] } {
  const history: StreakDay[] = [];
  const day = (i: number) => dayKey(now - i * 86_400_000);
  let days = 0;
  for (let i = 0; i < 3650; i++) {
    const k = day(i);
    let kind: StreakDay;
    if (input.practiceDays.has(k)) kind = 'practice';
    else if (input.freezeDays.has(k)) kind = 'freeze';
    else if (i === 0) {
      history.push('missed');
      continue;
    } else {
      const window = history.slice(Math.max(0, history.length - 6));
      kind = window.filter((d) => d === 'rest').length < REST_CREDITS_PER_WEEK ? 'rest' : 'missed';
    }
    if (kind === 'missed') break;
    history.push(kind);
    if (kind === 'practice') days++;
    // Rest and freeze days keep the streak alive but don't add to it.
  }
  // A streak can't start with rest: trailing rest credits before the first practice don't count.
  while (history.length && history[history.length - 1] !== 'practice') history.pop();
  return { days, history };
}

export type ProcessMetrics = {
  minutesThisWeek: number;
  daysPractisedLast7: number;
  /** Comfortable range span (ST) from the latest baseline, and the change since the first. */
  rangeSt: number | null;
  rangeChangeSt: number | null;
};

/** Process metrics to celebrate (§2.7), from voiced minutes per day and baseline ranges (oldest first). */
export function processMetrics(minutesByDay: ReadonlyMap<string, number>, ranges: number[], now: number): ProcessMetrics {
  let minutes = 0;
  let days = 0;
  for (let i = 0; i < 7; i++) {
    const m = minutesByDay.get(dayKey(now - i * 86_400_000)) ?? 0;
    minutes += m;
    if (m > 0) days++;
  }
  return {
    minutesThisWeek: Math.round(minutes),
    daysPractisedLast7: days,
    rangeSt: ranges.length ? ranges[ranges.length - 1] : null,
    rangeChangeSt: ranges.length >= 2 ? ranges[ranges.length - 1] - ranges[0] : null,
  };
}

/** One line celebrating process, never outcome. */
export function celebration(m: ProcessMetrics, streakDays: number): string {
  if (m.daysPractisedLast7 >= 5) return `You practised on ${m.daysPractisedLast7} of the last 7 days. That consistency is what builds a voice.`;
  if (streakDays >= 3) return `${streakDays} practice days in a row, rest days included.`;
  if (m.rangeChangeSt != null && m.rangeChangeSt >= 1) return `Your comfortable range is ${m.rangeChangeSt.toFixed(1)} semitones wider than when you started.`;
  if (m.minutesThisWeek > 0) return `${m.minutesThisWeek} minutes of practice this week.`;
  return 'Short, regular sessions work best. Even five minutes counts.';
}
