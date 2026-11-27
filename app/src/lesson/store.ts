import { desc, eq, gte, inArray } from 'drizzle-orm';

import type { AttemptRecord, Outcome } from '../curriculum/criteria';
import type { Db } from '../db/client';
import { attempt, journal, restDay, session, skillState, symptomReport, type Attempt } from '../db/schema';
import { currentMastery, DEFAULT_WEIGHTS, halfLifeDays, newMemory, update, type SkillMemory, type Weights } from '../learning/hlr';
import { nextLevel } from '../learning/practice';
import { dayKey, isHardStop, type DayState, type Symptom, type SymptomReport } from '../safety/rules';

// Lesson data on the encrypted database (Stage 5–6): attempts, skill state,
// symptom reports, rest days and today's voice use.

export const toRecord = (a: Attempt): AttemptRecord => ({
  exerciseId: a.exerciseId,
  sessionId: a.sessionId,
  at: a.at.getTime(),
  outcome: a.outcome as Outcome,
});

export async function loadAttempts(db: Db): Promise<Attempt[]> {
  return db.select().from(attempt).orderBy(attempt.at);
}

/** Evidence of the latest attempt at an exercise (a reference whisper or reading). */
export async function latestEvidence<T>(db: Db, exerciseId: string): Promise<T | null> {
  const [row] = await db.select().from(attempt).where(eq(attempt.exerciseId, exerciseId)).orderBy(desc(attempt.at)).limit(1);
  return (row?.evidence as T) ?? null;
}

export async function saveAttempt(
  db: Db,
  a: { sessionId: number | null; lessonId: string; exerciseId: string; refresher: boolean; outcome: Outcome; evidence?: unknown },
): Promise<void> {
  await db.insert(attempt).values({
    at: new Date(),
    sessionId: a.sessionId,
    lessonId: a.lessonId,
    exerciseId: a.exerciseId,
    refresher: a.refresher,
    passed: a.outcome.passed,
    outcome: a.outcome,
    evidence: a.evidence ?? null,
  });
}

// ——— Skill state: lessons (refreshers, mastery) and units (challenge-point level) ———

export const lessonSkill = (lessonId: string) => `lesson:${lessonId}`;
export const unitSkill = (unitId: string) => `unit:${unitId}`;

export type Skill = { skillId: string; mastery: number; level: number; memory: SkillMemory };

function toSkill(row: typeof skillState.$inferSelect): Skill {
  return {
    skillId: row.skillId,
    mastery: row.mastery,
    level: row.level,
    memory: {
      weights: (row.weights as Weights | null) ?? [...DEFAULT_WEIGHTS],
      successes: row.successes,
      failures: row.failures,
      lastSuccessAt: row.lastSuccessAt?.getTime() ?? null,
    },
  };
}

export async function loadSkills(db: Db): Promise<Map<string, Skill>> {
  const rows = await db.select().from(skillState);
  return new Map(rows.map((r) => [r.skillId, toSkill(r)]));
}

export async function getSkill(db: Db, skillId: string): Promise<Skill> {
  const row = await db.query.skillState.findFirst({ where: eq(skillState.skillId, skillId) });
  return row ? toSkill(row) : { skillId, mastery: 0, level: 0, memory: newMemory() };
}

async function putSkill(db: Db, s: Skill): Promise<void> {
  const values = {
    skillId: s.skillId,
    mastery: s.mastery,
    level: s.level,
    weights: s.memory.weights,
    successes: s.memory.successes,
    failures: s.memory.failures,
    lastSuccessAt: s.memory.lastSuccessAt != null ? new Date(s.memory.lastSuccessAt) : null,
    halfLifeDays: halfLifeDays(s.memory),
  };
  await db.insert(skillState).values(values).onConflictDoUpdate({ target: skillState.skillId, set: values });
}

/**
 * After a lesson run: the lesson skill learns from its measured performance
 * (hlr.ts), its mastery moves halfway to that performance, and the unit's
 * target level follows the challenge-point rule over recent attempts.
 */
export async function recordLessonRun(
  db: Db,
  lessonId: string,
  unitId: string,
  performance: number,
  passed: boolean,
  recentPassed: boolean[],
): Promise<void> {
  const now = Date.now();
  const s = await getSkill(db, lessonSkill(lessonId));
  const decayed = currentMastery(s.mastery, s.memory, now);
  await putSkill(db, { ...s, mastery: 0.5 * decayed + 0.5 * performance, memory: update(s.memory, performance, passed, now) });
  const u = await getSkill(db, unitSkill(unitId));
  await putSkill(db, { ...u, level: nextLevel(u.level, recentPassed) });
}

// ——— Safety: today's voice use, symptoms, rest days ———

const startOfToday = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};

export async function dayState(db: Db): Promise<DayState & { checkedInToday: boolean }> {
  const since = startOfToday();
  const sessions = await db.select({ v: session.voicedS }).from(session).where(gte(session.startedAt, since));
  const reports = await db.select().from(symptomReport).where(gte(symptomReport.at, since));
  const rest = await db.query.restDay.findFirst({ where: eq(restDay.day, dayKey(Date.now())) });
  return {
    voicedMinutesToday: sessions.reduce((s, r) => s + r.v, 0) / 60,
    hardStopToday: rest?.reason === 'hard-stop' || reports.some((r) => isHardStop(r.symptoms as Symptom[])),
    checkedInToday: reports.length > 0,
  };
}

export async function reportSymptoms(db: Db, symptoms: Symptom[]): Promise<void> {
  await db.insert(symptomReport).values({ at: new Date(), symptoms });
  if (isHardStop(symptoms)) {
    await db.insert(restDay).values({ day: dayKey(Date.now()), reason: 'hard-stop' }).onConflictDoNothing();
  }
}

export async function symptomHistory(db: Db): Promise<SymptomReport[]> {
  const rows = await db.select().from(symptomReport).orderBy(symptomReport.at);
  return rows.map((r) => ({ at: r.at.getTime(), symptoms: r.symptoms as Symptom[] }));
}

export async function markRestDay(db: Db, reason: 'voice-rest' | 'illness'): Promise<void> {
  const day = dayKey(Date.now());
  await db.insert(restDay).values({ day, reason }).onConflictDoUpdate({ target: restDay.day, set: { reason } });
}

export async function restDays(db: Db): Promise<Set<string>> {
  return new Set((await db.select({ day: restDay.day }).from(restDay)).map((r) => r.day));
}

// ——— Sessions ———

export async function startSession(db: Db, kind: 'lesson' | 'practice'): Promise<number> {
  const [row] = await db.insert(session).values({ startedAt: new Date(), kind }).returning({ id: session.id });
  return row.id;
}

export async function updateSession(
  db: Db,
  id: number,
  set: Partial<{ voicedS: number; durationS: number; warmupDone: boolean; cooldownDone: boolean; listenTrials: number; lessonsDone: number; effortRating: number }>,
): Promise<void> {
  await db.update(session).set(set).where(eq(session.id, id));
}

/** Per-day activity for streaks, XP and process metrics. */
export async function activityByDay(db: Db): Promise<Map<string, { voicedMinutes: number; listenTrials: number; lessonsDone: number }>> {
  const rows = await db.select().from(session);
  const out = new Map<string, { voicedMinutes: number; listenTrials: number; lessonsDone: number }>();
  for (const r of rows) {
    const k = dayKey(r.startedAt.getTime());
    const a = out.get(k) ?? { voicedMinutes: 0, listenTrials: 0, lessonsDone: 0 };
    a.voicedMinutes += r.voicedS / 60;
    a.listenTrials += r.listenTrials;
    a.lessonsDone += r.lessonsDone;
    out.set(k, a);
  }
  return out;
}

// ——— Journal ———

export async function addJournal(db: Db, entry: { text: string; mood?: number | null; prompt?: string | null; lessonId?: string | null }) {
  await db.insert(journal).values({ text: entry.text, mood: entry.mood ?? null, prompt: entry.prompt ?? null, lessonId: entry.lessonId ?? null });
}

export async function journalEntries(db: Db) {
  return db.select().from(journal).orderBy(desc(journal.createdAt));
}

export async function deleteJournal(db: Db, id: number) {
  await db.delete(journal).where(eq(journal.id, id));
}

/** Recent pass/fail of a unit's scored exercises (those with a criterion), oldest first, for the challenge-point rule. */
export async function recentPassed(db: Db, exerciseIds: string[], n = 5): Promise<boolean[]> {
  if (exerciseIds.length === 0) return [];
  const rows = await db
    .select({ passed: attempt.passed })
    .from(attempt)
    .where(inArray(attempt.exerciseId, exerciseIds))
    .orderBy(desc(attempt.at))
    .limit(n);
  return rows.map((r) => r.passed).reverse();
}

