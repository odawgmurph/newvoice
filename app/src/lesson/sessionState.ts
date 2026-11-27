import { StrainMonitor } from '../feedback/strain';
import type { SessionSafety } from '../safety/rules';

// The practice session in progress (one sitting, possibly several lessons).
// It lives in memory: a session ends after 30 minutes without activity, so
// a warm-up covers back-to-back lessons but not a return later in the day.

export const SESSION_IDLE_MIN = 30;

type Live = SessionSafety & {
  sessionId: number | null;
  lastActivity: number;
  monitor: StrainMonitor | null;
  monitorCeiling: number | null;
  listenTrials: number;
  lessonsDone: number;
};

let live: Live = fresh();

function fresh(): Live {
  return {
    sessionId: null,
    lastActivity: 0,
    warmupAt: null,
    cooldownDone: false,
    voicedMinutes: 0,
    monitor: null,
    monitorCeiling: null,
    listenTrials: 0,
    lessonsDone: 0,
  };
}

/** The current session, starting a new one after a long pause. */
export function currentSession(now = Date.now()): Live {
  if (live.lastActivity && now - live.lastActivity > SESSION_IDLE_MIN * 60_000) live = fresh();
  live.lastActivity = now;
  return live;
}

export function endSession(): void {
  live = fresh();
}

/** The strain monitor for this session (D18), reset when the safety ceiling changes. */
export function strainMonitor(comfortableP90St: number | null): StrainMonitor {
  const s = currentSession();
  if (!s.monitor || s.monitorCeiling !== comfortableP90St) {
    s.monitor = new StrainMonitor({ comfortableP90St });
    s.monitorCeiling = comfortableP90St;
  }
  return s.monitor;
}
