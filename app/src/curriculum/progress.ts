// Where the user is in the curriculum (Stage 5): which units and lessons
// are open, done or locked, from the stored attempts. Pure TypeScript.
//
// Rules (handbook §4.1):
// - Units open in track order; a unit opens when the one before it in the
//   track has met its unlock criterion (its gate).
// - Lessons in a unit open one after another; a lesson is done when each
//   of its exercises has met its criterion (completion counts for
//   exercises without one). The checkpoint lesson holds the gate.
// - Done lessons stay open for practice.

import { gateMet, type AttemptRecord } from './criteria.ts';
import type { Curriculum, Lesson, TrackId, Unit } from './types.ts';

export type LessonStatus = 'locked' | 'open' | 'done';
export type UnitStatus = 'locked' | 'open' | 'complete';

export type UnitProgress = {
  unit: Unit;
  status: UnitStatus;
  lessons: { lesson: Lesson; status: LessonStatus }[];
};

export type ProgressContext = { baselineStored: boolean };

export function exerciseMet(
  exercise: { id: string; pass: Parameters<typeof gateMet>[0] },
  attempts: AttemptRecord[],
  ctx: ProgressContext,
): boolean {
  return gateMet(
    exercise.pass,
    attempts.filter((a) => a.exerciseId === exercise.id),
    ctx,
  );
}

export function lessonDone(lesson: Lesson, attempts: AttemptRecord[], ctx: ProgressContext): boolean {
  return lesson.exercises.every((e) => exerciseMet(e, attempts, ctx));
}

export function unitComplete(unit: Unit, attempts: AttemptRecord[], ctx: ProgressContext): boolean {
  const gate = unit.lessons.flatMap((l) => l.exercises).find((e) => e.id === unit.gate);
  return gate != null && exerciseMet(gate, attempts, ctx);
}

/** Units in track order with their status and their lessons'. */
export function progress(c: Curriculum, track: TrackId, attempts: AttemptRecord[], ctx: ProgressContext): UnitProgress[] {
  const byId = new Map(c.units.map((u) => [u.id, u]));
  const order = (c.tracks[track] ?? c.tracks.default).map((id) => byId.get(id)!).filter(Boolean);
  let previousComplete = true;
  return order.map((unit) => {
    const complete = unitComplete(unit, attempts, ctx);
    const status: UnitStatus = complete ? 'complete' : previousComplete ? 'open' : 'locked';
    previousComplete = complete;
    let priorDone = status !== 'locked';
    const lessons = unit.lessons.map((lesson) => {
      const done = lessonDone(lesson, attempts, ctx);
      const s: LessonStatus = done && status !== 'locked' ? 'done' : priorDone ? 'open' : 'locked';
      priorDone = priorDone && done;
      return { lesson, status: s };
    });
    return { unit, status, lessons };
  });
}

/** The next lesson to take: the first open, unfinished lesson in track order. */
export function nextLesson(p: UnitProgress[]): { unit: Unit; lesson: Lesson } | null {
  for (const u of p) {
    const l = u.lessons.find((x) => x.status === 'open');
    if (l) return { unit: u.unit, lesson: l.lesson };
  }
  return null;
}

/** Finds a lesson and its unit by id. */
export function findLesson(c: Curriculum, lessonId: string): { unit: Unit; lesson: Lesson } | null {
  for (const unit of c.units) {
    const lesson = unit.lessons.find((l) => l.id === lessonId);
    if (lesson) return { unit, lesson };
  }
  return null;
}

/** Whether a lesson may be started in this track. */
export function lessonOpen(p: UnitProgress[], lessonId: string): boolean {
  return p.some((u) => u.lessons.some((l) => l.lesson.id === lessonId && l.status !== 'locked'));
}
