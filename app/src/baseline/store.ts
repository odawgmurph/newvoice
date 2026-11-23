import { and, eq, isNull } from 'drizzle-orm';
import { Directory, File, Paths } from 'expo-file-system';

import type { TaskResult } from '../../modules/newvoice-audio/src/NewVoiceAudio.types';
import type { Db } from '../db/client';
import { baseline, recording, session, user, type Baseline } from '../db/schema';
import type { BaselineSummary, BaselineTask } from './plan';

// Baseline rows, their recordings and kept audio. Audio, when the user keeps
// it, lives at Documents/recordings/baseline-<id>/<task>.wav; native code
// writes it (TaskAnalysis.swift), this file deletes it.

/** Path for `analyseLastClip({ saveAs })`, relative to Documents. */
export function audioPath(baselineId: number, task: BaselineTask): string {
  return `recordings/baseline-${baselineId}/${task.id}.wav`;
}

function audioDir(baselineId: number): Directory {
  return new Directory(Paths.document, 'recordings', `baseline-${baselineId}`);
}

/** Deletes a kept audio file, if there is one. */
export function deleteAudio(uri: string | null | undefined): void {
  if (!uri) return;
  const f = new File(uri);
  if (f.exists) f.delete();
}

/**
 * Starts a new baseline. An unfinished one from an earlier attempt is
 * deleted first, with its recordings and audio, so there's only ever one
 * baseline in progress.
 */
export async function startBaseline(db: Db): Promise<{ baselineId: number; sessionId: number; startedAt: Date }> {
  const stale = await db.select({ id: baseline.id }).from(baseline).where(isNull(baseline.completedAt));
  for (const { id } of stale) {
    await db.delete(recording).where(eq(recording.baselineId, id));
    await db.delete(baseline).where(eq(baseline.id, id));
    const dir = audioDir(id);
    if (dir.exists) dir.delete();
  }
  const startedAt = new Date();
  const [s] = await db.insert(session).values({ startedAt }).returning({ id: session.id });
  const [b] = await db.insert(baseline).values({ sessionId: s.id }).returning({ id: baseline.id });
  return { baselineId: b.id, sessionId: s.id, startedAt };
}

/** Stores one task's measurements, replacing an earlier attempt at the same task. */
export async function saveTask(
  db: Db,
  ids: { baselineId: number; sessionId: number },
  task: BaselineTask,
  result: TaskResult,
): Promise<void> {
  const where = and(eq(recording.baselineId, ids.baselineId), eq(recording.taskId, task.taskId));
  const earlier = await db.select({ uri: recording.localUri }).from(recording).where(where);
  await db.delete(recording).where(where);
  // The new attempt overwrote the same file name, so only delete other paths.
  for (const { uri } of earlier) if (uri !== result.audioUri) deleteAudio(uri);
  await db.insert(recording).values({
    baselineId: ids.baselineId,
    sessionId: ids.sessionId,
    taskId: task.taskId,
    localUri: result.audioUri,
    features: result,
    confidence: result.vowel?.confidence ?? null,
    analysisVersion: result.coreVersion,
  });
}

/** Marks the baseline complete and makes it the user's current one. */
export async function completeBaseline(
  db: Db,
  ids: { baselineId: number; sessionId: number; startedAt: Date },
  summary: BaselineSummary,
): Promise<void> {
  const now = new Date();
  await db
    .update(baseline)
    .set({ completedAt: now, summary, analysisVersion: summary.coreVersion })
    .where(eq(baseline.id, ids.baselineId));
  await db
    .update(session)
    .set({ durationS: (now.getTime() - ids.startedAt.getTime()) / 1000 })
    .where(eq(session.id, ids.sessionId));
  await db.update(user).set({ baselineId: ids.baselineId }).where(eq(user.id, 1));
}

/** The user's current baseline, or null. */
export async function currentBaseline(db: Db, baselineId: number | null | undefined): Promise<Baseline | null> {
  if (baselineId == null) return null;
  const row = await db.query.baseline.findFirst({ where: eq(baseline.id, baselineId) });
  return row ?? null;
}

