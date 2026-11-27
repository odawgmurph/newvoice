// Motor-learning rules (Stage 6; handbook §2.5; decision D22). Pure.

import type { FeedbackMode } from '../feedback/types.ts';

/**
 * Feedback fades as a skill is learned: "live visuals 100% of the time in
 * early levels, then 50%, then only an end-of-utterance score" (§2.5).
 * Mastery (0–1) is the skill's decayed mastery (hlr.ts), so a skill that
 * has faded gets live feedback back.
 */
export const FADE_AT = { half: 0.4, summaryOnly: 0.75 } as const;

export function feedbackMode(mastery: number, itemIndex: number): FeedbackMode {
  if (mastery >= FADE_AT.summaryOnly) return 'summary';
  if (mastery >= FADE_AT.half) return itemIndex % 2 === 0 ? 'live' : 'summary';
  return 'live';
}

/** Share of items with live feedback at a mastery, for tests and the "how it works" copy. */
export function liveShare(mastery: number, items = 100): number {
  let live = 0;
  for (let i = 0; i < items; i++) if (feedbackMode(mastery, i) === 'live') live++;
  return live / items;
}

/** "Use KP early and KR later" (§2.5): the why-line shows until a skill is half learned. */
export const showWhy = (mastery: number) => mastery < 0.5;

/** Small deterministic shuffle (Fisher–Yates with mulberry32). */
export function shuffled<T>(items: readonly T[], seed: number): T[] {
  let a = seed >>> 0;
  const r = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Blocked practice while a skill is being acquired (items in authored
 * order), random once it is acquired: "random practice gives better
 * retention than blocked practice" (§2.5).
 */
export function practiceOrder<T>(items: readonly T[], acquired: boolean, seed: number): T[] {
  return acquired ? shuffled(items, seed) : [...items];
}

/**
 * Challenge point (§2.5): keep success at about 70–80% by moving the
 * target level. Looks at the last few attempts of a skill: above 80% steps
 * up, below 70% steps down. Zones cap every level at the comfortable p90,
 * so a higher level never asks for more than is comfortable (zones.ts).
 */
export const CHALLENGE = { window: 5, raiseAbove: 0.8, lowerBelow: 0.7, maxLevel: 10 } as const;

export function nextLevel(level: number, recentPassed: boolean[]): number {
  const recent = recentPassed.slice(-CHALLENGE.window);
  if (recent.length < CHALLENGE.window) return level;
  const rate = recent.filter(Boolean).length / recent.length;
  if (rate > CHALLENGE.raiseAbove) return Math.min(CHALLENGE.maxLevel, level + 1);
  if (rate < CHALLENGE.lowerBelow) return Math.max(0, level - 1);
  return level;
}
