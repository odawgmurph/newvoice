import { CryptoDigestAlgorithm, digestStringAsync, getRandomBytesAsync } from 'expo-crypto';
import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';

import { digestsEqual, isValidPin, pinHashInput, waitRemaining } from './pin';

// Lock settings live in the Keychain/Keystore, not the database, so the lock
// works even when the database can't be opened.
//
// The PIN is stored as a salted SHA-256. A 4–8 digit PIN can't resist an
// offline guess whatever the hash, so the protection is that the hash sits in
// the Keychain (device-only, unlocked-only) next to the database key, plus the
// retry wait in pin.ts. See decision D15.

const OPTS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};
const PIN_ITEM = 'lock.pin.v1';
const FAILURES_ITEM = 'lock.failures.v1';
const BIOMETRIC_ITEM = 'lock.biometric.v1';

type StoredPin = { salt: string; hash: string };
type Failures = { count: number; lastAt: number };

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

async function hash(salt: string, pin: string): Promise<string> {
  return digestStringAsync(CryptoDigestAlgorithm.SHA256, pinHashInput(salt, pin));
}

async function readJson<T>(item: string): Promise<T | null> {
  const raw = await SecureStore.getItemAsync(item, OPTS);
  if (raw == null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function hasPin(): Promise<boolean> {
  return (await readJson<StoredPin>(PIN_ITEM)) != null;
}

export async function setPin(pin: string): Promise<void> {
  if (!isValidPin(pin)) throw new Error('PIN must be 4–8 digits.');
  const salt = toHex(await getRandomBytesAsync(16));
  const stored: StoredPin = { salt, hash: await hash(salt, pin) };
  await SecureStore.setItemAsync(PIN_ITEM, JSON.stringify(stored), OPTS);
  await SecureStore.deleteItemAsync(FAILURES_ITEM, OPTS);
}

export async function removePin(): Promise<void> {
  await SecureStore.deleteItemAsync(PIN_ITEM, OPTS);
  await SecureStore.deleteItemAsync(FAILURES_ITEM, OPTS);
  await SecureStore.deleteItemAsync(BIOMETRIC_ITEM, OPTS);
}

export type CheckResult = { ok: true } | { ok: false; waitMs: number };

/** Checks a PIN, counting failures across restarts and enforcing the retry wait. */
export async function checkPin(pin: string, now = Date.now()): Promise<CheckResult> {
  const stored = await readJson<StoredPin>(PIN_ITEM);
  if (stored == null) return { ok: true };
  const failures = (await readJson<Failures>(FAILURES_ITEM)) ?? { count: 0, lastAt: 0 };
  const wait = waitRemaining(failures.count, failures.lastAt, now);
  if (wait > 0) return { ok: false, waitMs: wait };

  if (digestsEqual(await hash(stored.salt, pin), stored.hash)) {
    await SecureStore.deleteItemAsync(FAILURES_ITEM, OPTS);
    return { ok: true };
  }
  const next: Failures = { count: failures.count + 1, lastAt: now };
  await SecureStore.setItemAsync(FAILURES_ITEM, JSON.stringify(next), OPTS);
  return { ok: false, waitMs: waitRemaining(next.count, next.lastAt, now) };
}

export async function biometricAvailable(): Promise<boolean> {
  return (await LocalAuthentication.hasHardwareAsync()) && (await LocalAuthentication.isEnrolledAsync());
}

export async function biometricEnabled(): Promise<boolean> {
  return (await SecureStore.getItemAsync(BIOMETRIC_ITEM, OPTS)) === '1';
}

export async function setBiometricEnabled(on: boolean): Promise<void> {
  if (on) await SecureStore.setItemAsync(BIOMETRIC_ITEM, '1', OPTS);
  else await SecureStore.deleteItemAsync(BIOMETRIC_ITEM, OPTS);
}

/** Face ID / Touch ID / fingerprint only; the app PIN is the fallback, not the phone passcode. */
export async function unlockWithBiometrics(): Promise<boolean> {
  const result = await LocalAuthentication.authenticateAsync({
    promptMessage: 'Unlock',
    cancelLabel: 'Use PIN',
    disableDeviceFallback: true,
  });
  return result.success;
}

/** Removes every lock item (used by delete-all-data). */
export async function clearLock(): Promise<void> {
  await removePin();
}
