import assert from 'node:assert/strict';
import { test } from 'node:test';

import { digestsEqual, FREE_ATTEMPTS, isValidPin, lockoutMs, waitRemaining } from './pin.ts';

test('PINs are 4 to 8 digits', () => {
  for (const ok of ['0000', '1234', '12345678']) assert.ok(isValidPin(ok), ok);
  for (const bad of ['', '123', '123456789', '12a4', ' 1234', '12 34', '١٢٣٤']) assert.ok(!isValidPin(bad), bad);
});

test('no wait for the first five wrong PINs', () => {
  for (let n = 0; n < FREE_ATTEMPTS; n++) assert.equal(lockoutMs(n), 0);
});

test('wait starts at 30 s, doubles, and caps at an hour', () => {
  assert.equal(lockoutMs(5), 30_000);
  assert.equal(lockoutMs(6), 60_000);
  assert.equal(lockoutMs(7), 120_000);
  assert.equal(lockoutMs(12), 3_600_000);
  assert.equal(lockoutMs(100), 3_600_000);
});

test('remaining wait counts down from the last failure', () => {
  assert.equal(waitRemaining(4, 1000, 1000), 0);
  assert.equal(waitRemaining(5, 1000, 1000), 30_000);
  assert.equal(waitRemaining(5, 1000, 21_000), 10_000);
  assert.equal(waitRemaining(5, 1000, 40_000), 0);
});

test('digest comparison', () => {
  assert.ok(digestsEqual('abcd', 'abcd'));
  assert.ok(!digestsEqual('abcd', 'abce'));
  assert.ok(!digestsEqual('abcd', 'abc'));
});
