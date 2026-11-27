// Stage 6 exit tests: simulated multi-week use shows refreshers scheduled
// sensibly and caps enforced, and no path rewards practising past the
// safety limits (build plan, Stage 6 exit).

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { isRewarded, classifyPitch } from '../feedback/zones.ts';
import { dayKey, SAFETY, voicedBlock } from '../safety/rules.ts';
import { DAY_MS, dueAt, halfLifeDays, newMemory, predicted, update, currentMastery } from './hlr.ts';
import { celebration, dailyXp, MAX_DAILY_XP, processMetrics, streak, XP } from './motivation.ts';
import { planSession, MAX_REFRESHERS } from './plan.ts';
import { feedbackMode, liveShare, nextLevel, practiceOrder, showWhy } from './practice.ts';

const T0 = Date.UTC(2026, 0, 5, 9);

test('half-life grows with successes and shrinks with failures', () => {
  let m = newMemory();
  m = update(m, 1, true, T0);
  const h1 = halfLifeDays(m);
  for (let i = 1; i <= 8; i++) m = update(m, 1, true, T0 + i * DAY_MS);
  assert.ok(halfLifeDays(m) > h1 * 2, `${h1} → ${halfLifeDays(m)}`);
  const failing = update(update(m, 0.2, false, T0 + 12 * DAY_MS), 0.2, false, T0 + 13 * DAY_MS);
  assert.ok(halfLifeDays(failing) < halfLifeDays(m));
});

test('predicted performance halves at the half-life; the refresher is due there', () => {
  const m = update(newMemory(), 1, true, T0);
  const h = halfLifeDays(m);
  assert.ok(Math.abs(predicted(m, h) - 0.5) < 1e-9);
  assert.ok(Math.abs((dueAt(m)! - T0) / DAY_MS - h) < 1e-6);
  assert.equal(dueAt(newMemory()), null);
});

test('measured decay teaches the model: fast forgetters get sooner refreshers', () => {
  // Two learners with the same history; one keeps the skill, one loses it fast.
  let keeper = update(newMemory(), 1, true, T0);
  let fader = keeper;
  for (let i = 1; i <= 20; i++) {
    const at = T0 + i * 3 * DAY_MS;
    keeper = update(keeper, 0.95, true, at);
    fader = update(fader, 0.45, true, at);
  }
  assert.ok(halfLifeDays(fader) < halfLifeDays(keeper), `${halfLifeDays(fader)} vs ${halfLifeDays(keeper)}`);
});

test('mastery decays with time since the last success (§4.2)', () => {
  const m = update(newMemory(), 1, true, T0);
  assert.equal(currentMastery(0.8, m, T0), 0.8);
  assert.ok(currentMastery(0.8, m, T0 + 10 * DAY_MS) < 0.2);
  assert.equal(currentMastery(0.8, newMemory(), T0), 0);
});

test('feedback fades 100% → 50% → summary only (§2.5)', () => {
  assert.equal(liveShare(0.1), 1);
  assert.equal(liveShare(0.5), 0.5);
  assert.equal(liveShare(0.9), 0);
  assert.equal(feedbackMode(0.9, 0), 'summary');
  assert.equal(showWhy(0.2), true);
  assert.equal(showWhy(0.8), false);
});

test('blocked while acquiring, random once acquired', () => {
  const items = Array.from({ length: 10 }, (_, i) => i);
  assert.deepEqual(practiceOrder(items, false, 1), items);
  const r = practiceOrder(items, true, 1);
  assert.notDeepEqual(r, items);
  assert.deepEqual([...r].sort((a, b) => a - b), items);
});

test('challenge point keeps success near 70–80%', () => {
  assert.equal(nextLevel(3, [true, true, true, true, true]), 4);
  assert.equal(nextLevel(3, [true, false, false, true, false]), 2);
  assert.equal(nextLevel(3, [true, true, false, true, true]), 3);
  assert.equal(nextLevel(0, [false, false, false, false, false]), 0);
  assert.equal(nextLevel(3, [true, true]), 3);
  // Simulated learner whose success falls with level: the level settles where success is 70–80%.
  let level = 0;
  const history: boolean[] = [];
  let seed = 3;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 2000; i++) {
    const p = 1 / (1 + Math.exp(0.9 * (level - 6)));
    history.push(rand() < p);
    if (history.length % 5 === 0) level = nextLevel(level, history);
  }
  const late = history.slice(500);
  const rate = late.filter(Boolean).length / late.length;
  assert.ok(rate > 0.6 && rate < 0.9, `success ${rate}`);
});

test('XP is capped per day; practising past the cap earns nothing', () => {
  assert.equal(dailyXp({ voicedMinutes: 20, listenTrials: 0, lessonsDone: 0 }), XP.voicedDailyCap);
  assert.equal(dailyXp({ voicedMinutes: 60, listenTrials: 0, lessonsDone: 0 }), XP.voicedDailyCap);
  assert.equal(dailyXp({ voicedMinutes: 600, listenTrials: 1000, lessonsDone: 50 }), MAX_DAILY_XP);
});

const keys = (days: number[]) => new Set(days.map((d) => dayKey(T0 + d * DAY_MS)));

test('streaks credit rest days and freeze for illness', () => {
  const now = T0 + 10 * DAY_MS;
  // Practised days 4–10 except 6 and 8: two credited rest days.
  assert.equal(streak({ practiceDays: keys([4, 5, 7, 9, 10]), freezeDays: keys([]) }, now).days, 5);
  // A third missed day in the same week breaks it.
  assert.equal(streak({ practiceDays: keys([3, 5, 7, 10]), freezeDays: keys([]) }, now).days, 2);
  // A week off ill doesn't break it.
  assert.equal(streak({ practiceDays: keys([1, 2, 10]), freezeDays: keys([3, 4, 5, 6, 7, 8, 9]) }, now).days, 3);
  // Today not yet practised doesn't break it.
  assert.equal(streak({ practiceDays: keys([8, 9]), freezeDays: keys([]) }, now).days, 2);
});

test('process metrics and celebration copy never mention outcomes', () => {
  const minutes = new Map([[dayKey(T0), 12], [dayKey(T0 - DAY_MS), 8]]);
  const m = processMetrics(minutes, [10, 12.5], T0);
  assert.deepEqual(m, { minutesThisWeek: 20, daysPractisedLast7: 2, rangeSt: 12.5, rangeChangeSt: 2.5 });
  const line = celebration(m, 2);
  assert.match(line, /range/);
  assert.doesNotMatch(line, /\b(pass|sound like|female|male|feminine|convincing)\b/i);
});

test('session plans fit the soft cap and today’s maximum', () => {
  const skills = Array.from({ length: 6 }, (_, i) => ({
    skillId: `s${i}`,
    memory: update(newMemory(), 1, true, T0 - (i + 5) * DAY_MS),
    minutes: 5,
  }));
  const p = planSession(skills, { lessonId: 'next', minutes: 6 }, 0, T0);
  assert.equal(p.refreshers.length, MAX_REFRESHERS);
  assert.equal(p.refreshers[0], 's5', 'most overdue first');
  assert.equal(p.lesson, 'next');
  assert.ok(p.minutes <= SAFETY.sessionSoftCapMin);
  // Near the daily maximum only what fits is planned.
  const late = planSession(skills, { lessonId: 'next', minutes: 6 }, 50, T0);
  assert.ok(late.minutes <= 10);
  assert.deepEqual(planSession(skills, null, 60, T0), { refreshers: [], lesson: null, minutes: 0 });
});

// ——— Multi-week simulation (Stage 6 exit) ———

test('eight simulated weeks: refreshers space out, caps hold, nothing past p90 is rewarded', () => {
  let seed = 11;
  const rand = () => ((seed = (seed * 48271) % 2147483647) / 2147483647);
  const lessons = Array.from({ length: 12 }, (_, i) => ({ id: `l${i}`, minutes: 5 }));
  const memory = new Map<string, ReturnType<typeof newMemory>>();
  const refreshGaps = new Map<string, number[]>();
  const lastRefresh = new Map<string, number>();
  const zone = { lo: 55, hi: 59, centre: 57, comfortableP90St: 59.5 };
  let nextIdx = 0;
  const minutesByDay = new Map<string, number>();

  for (let day = 0; day < 56; day++) {
    // Two sessions a day, morning and evening, skipping some days.
    if (rand() < 0.2) continue;
    for (const hour of [9, 19]) {
      const now = T0 + day * DAY_MS + (hour - 9) * 3_600_000;
      const today = minutesByDay.get(dayKey(now)) ?? 0;
      const skills = [...memory.entries()].map(([skillId, m]) => ({ skillId, memory: m, minutes: 5 }));
      const plan = planSession(skills, nextIdx < lessons.length ? { lessonId: lessons[nextIdx].id, minutes: 5 } : null, today, now);
      assert.ok(plan.minutes <= SAFETY.sessionSoftCapMin);
      // The safety layer agrees with the planner.
      const block = voicedBlock('practice', { warmupAt: now, cooldownDone: false, voicedMinutes: 0 }, { voicedMinutesToday: today, hardStopToday: false }, now);
      if (plan.minutes > 0) assert.equal(block, null);
      for (const id of plan.refreshers) {
        const m = memory.get(id)!;
        // The simulated learner forgets with a true half-life of 6 days.
        const lag = (now - m.lastSuccessAt!) / DAY_MS;
        const perf = Math.min(1, 2 ** (-lag / 6) + 0.25 * rand());
        memory.set(id, update(m, perf, perf >= 0.6, now));
        const prev = lastRefresh.get(id);
        if (prev != null) refreshGaps.set(id, [...(refreshGaps.get(id) ?? []), (now - prev) / DAY_MS]);
        lastRefresh.set(id, now);
      }
      if (plan.lesson) {
        memory.set(plan.lesson, update(newMemory(), 1, true, now));
        lastRefresh.set(plan.lesson, now);
        nextIdx++;
      }
      minutesByDay.set(dayKey(now), today + plan.minutes);
    }
  }
  // Daily voiced minutes never exceed the maximum.
  assert.ok([...minutesByDay.values()].every((m) => m <= SAFETY.dailyMaxMin));
  // Every lesson got learned, and refreshers happened.
  assert.equal(nextIdx, lessons.length);
  const gaps = [...refreshGaps.values()];
  assert.ok(gaps.length >= 6, `refreshed skills: ${gaps.length}`);
  // Refresher gaps are sensible: none under half a day; they lengthen over time for steady skills.
  for (const g of gaps) assert.ok(g.every((d) => d >= 0.4 && d <= 60), String(g));
  const lengthening = gaps.filter((g) => g.length >= 3 && g[g.length - 1] > g[0]).length;
  assert.ok(lengthening >= gaps.filter((g) => g.length >= 3).length / 2, 'spacing should expand for most skills');
  // XP never exceeds its cap on any day.
  for (const m of minutesByDay.values()) assert.ok(dailyXp({ voicedMinutes: m, listenTrials: 0, lessonsDone: 3 }) <= MAX_DAILY_XP);
  // Nothing above the comfortable p90 is rewarded, at any level.
  for (const st of [59.6, 60, 65]) assert.equal(isRewarded(classifyPitch(st, zone)), false);
});
