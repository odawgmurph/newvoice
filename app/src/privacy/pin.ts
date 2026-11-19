// Pure PIN rules, kept free of native imports so `npm test` can run them
// under Node. Storage lives in pinStore.ts.

export const PIN_MIN = 4;
export const PIN_MAX = 8;

export function isValidPin(pin: string): boolean {
  return new RegExp(`^\\d{${PIN_MIN},${PIN_MAX}}$`).test(pin);
}

/** Wrong guesses allowed before a wait is imposed. */
export const FREE_ATTEMPTS = 5;
const FIRST_WAIT_MS = 30_000;
const MAX_WAIT_MS = 60 * 60_000;

/**
 * How long to wait before the next attempt after `failures` wrong PINs in a
 * row: none for the first five, then 30 s, doubling, capped at an hour.
 * There is deliberately no wipe-after-N: a partner or parent guessing
 * shouldn't be able to destroy someone's data.
 */
export function lockoutMs(failures: number): number {
  if (failures < FREE_ATTEMPTS) return 0;
  return Math.min(FIRST_WAIT_MS * 2 ** (failures - FREE_ATTEMPTS), MAX_WAIT_MS);
}

/** Milliseconds left before another attempt is allowed (0 = allowed now). */
export function waitRemaining(failures: number, lastFailureAt: number, now: number): number {
  const wait = lockoutMs(failures);
  return wait === 0 ? 0 : Math.max(0, lastFailureAt + wait - now);
}

/** The string that is hashed: salt and PIN, so equal PINs on two phones differ. */
export function pinHashInput(saltHex: string, pin: string): string {
  return `newvoice-pin-v1:${saltHex}:${pin}`;
}

/** Compares two equal-length hex digests without an early exit. */
export function digestsEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
