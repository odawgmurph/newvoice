// Today's session plan (Stage 6): warm-up, due refreshers, the next lesson,
// cool-down, sized to fit under the session soft cap (§2.4, §4.2). Pure.

import { DAY_MS, dueAt, type SkillMemory } from './hlr.ts';
import { SAFETY } from '../safety/rules.ts';

export type SkillRow = { skillId: string; memory: SkillMemory; minutes: number };

/** Refreshers per session; more would crowd out new learning. */
export const MAX_REFRESHERS = 2;
/** Warm-up plus cool-down minutes. */
export const BOOKEND_MIN = 4;

export type SessionPlan = {
  refreshers: string[];
  lesson: string | null;
  minutes: number;
};

/** Skills whose refresher is due now, most overdue first. */
export function dueSkills(skills: SkillRow[], now: number): SkillRow[] {
  return skills
    .map((s) => ({ s, due: dueAt(s.memory) }))
    .filter((x): x is { s: SkillRow; due: number } => x.due != null && x.due <= now)
    .sort((a, b) => a.due - b.due)
    .map((x) => x.s);
}

/**
 * A session that fits in what is left of the soft cap and of today's
 * maximum: refreshers first (retention), then the next lesson if it fits.
 */
export function planSession(
  skills: SkillRow[],
  next: { lessonId: string; minutes: number } | null,
  voicedMinutesToday: number,
  now: number,
): SessionPlan {
  const budget = Math.min(SAFETY.sessionSoftCapMin, SAFETY.dailyMaxMin - voicedMinutesToday) - BOOKEND_MIN;
  const plan: SessionPlan = { refreshers: [], lesson: null, minutes: 0 };
  if (budget <= 0) return plan;
  for (const s of dueSkills(skills, now)) {
    if (plan.refreshers.length >= MAX_REFRESHERS || plan.minutes + s.minutes > budget) break;
    plan.refreshers.push(s.skillId);
    plan.minutes += s.minutes;
  }
  if (next && plan.minutes + next.minutes <= budget) {
    plan.lesson = next.lessonId;
    plan.minutes += next.minutes;
  }
  if (plan.minutes > 0) plan.minutes += BOOKEND_MIN;
  return plan;
}

export const daysUntilDue = (m: SkillMemory, now: number) => {
  const d = dueAt(m);
  return d == null ? null : (d - now) / DAY_MS;
};
