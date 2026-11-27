import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { needsCooldown, referral, SAFETY, voicedBlock, warmupValid, type SessionSafety } from './rules.ts';

const MIN = 60_000;
const DAY = 86_400_000;
const now = Date.UTC(2026, 10, 27, 12);
const fresh: SessionSafety = { warmupAt: null, cooldownDone: false, voicedMinutes: 0 };
const okDay = { voicedMinutesToday: 0, hardStopToday: false };

test('limits are the handbook’s conservative ends (§2.4)', () => {
  assert.ok(SAFETY.warmupMinS >= 180);
  assert.ok(SAFETY.sessionSoftCapMin <= 20);
  assert.ok(SAFETY.dailyMaxMin <= 60);
  assert.equal(SAFETY.referralHoarseDays, 14);
});

test('limits are not configurable: nothing writes to SAFETY', () => {
  assert.ok(Object.isFrozen(SAFETY) || readFileSync(new URL('./rules.ts', import.meta.url), 'utf8').includes('as const'));
});

test('voiced practice needs a warm-up first', () => {
  assert.equal(voicedBlock('practice', fresh, okDay, now), 'warmup-needed');
  assert.equal(voicedBlock('warmup', fresh, okDay, now), null);
  const warm = { ...fresh, warmupAt: now - 10 * MIN };
  assert.equal(voicedBlock('practice', warm, okDay, now), null);
  // A warm-up from an hour and a half ago no longer counts.
  assert.equal(warmupValid(now - 90 * MIN, now), false);
});

test('the soft cap moves the session to the cool-down', () => {
  const s = { ...fresh, warmupAt: now - MIN, voicedMinutes: 20 };
  assert.equal(voicedBlock('practice', s, okDay, now), 'soft-cap');
  assert.equal(voicedBlock('cooldown', s, okDay, now), null);
  assert.equal(needsCooldown(s), true);
  assert.equal(needsCooldown({ ...s, cooldownDone: true }), false);
});

test('the daily maximum blocks even a new warm-up, but not the cool-down', () => {
  const day = { voicedMinutesToday: 60, hardStopToday: false };
  assert.equal(voicedBlock('warmup', fresh, day, now), 'daily-limit');
  assert.equal(voicedBlock('practice', { ...fresh, warmupAt: now }, day, now), 'daily-limit');
  assert.equal(voicedBlock('cooldown', fresh, day, now), null);
});

test('a hard stop blocks all voice use for the day, cool-down included', () => {
  const day = { voicedMinutesToday: 0, hardStopToday: true };
  for (const k of ['warmup', 'cooldown', 'practice'] as const) assert.equal(voicedBlock(k, fresh, day, now), 'hard-stop');
});

test('referral: pain or blood at once; hoarseness only after two weeks', () => {
  assert.deepEqual(referral([{ at: now, symptoms: ['pain'] }], now), { urgent: true, reasons: ['pain'] });
  assert.deepEqual(referral([{ at: now, symptoms: ['blood', 'hoarse'] }], now), { urgent: true, reasons: ['blood'] });
  assert.equal(referral([{ at: now - 3 * DAY, symptoms: ['hoarse'] }, { at: now, symptoms: ['hoarse'] }], now), null);
  assert.deepEqual(
    referral([{ at: now - 15 * DAY, symptoms: ['hoarse'] }, { at: now - DAY, symptoms: ['hoarse'] }], now),
    { urgent: false, reasons: ['hoarse'] },
  );
  // Hoarse two weeks ago but not since: no referral.
  assert.equal(referral([{ at: now - 30 * DAY, symptoms: ['hoarse'] }, { at: now - 14 * DAY, symptoms: ['hoarse'] }], now), null);
});

test('safety copy is education-only (D3)', () => {
  const text = readFileSync(new URL('./copy.ts', import.meta.url), 'utf8').replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(text, /\b(therapy|treatment|diagnos\w*|clinical|dysphonia)\b/i);
});
