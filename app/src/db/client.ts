import { getRandomBytesAsync } from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { deleteDatabaseAsync, openDatabaseAsync, type SQLiteDatabase } from 'expo-sqlite';
import { drizzle, type ExpoSQLiteDatabase } from 'drizzle-orm/expo-sqlite';
import { migrate } from 'drizzle-orm/expo-sqlite/migrator';

import migrations from '../../drizzle/migrations';
import * as schema from './schema';

// The database is encrypted with SQLCipher (decision D14). The key is 32
// random bytes kept in the Keychain/Keystore, readable only while the phone
// is unlocked and never copied to backups or another device. The app PIN
// gates the UI; it does not derive this key.

export const DB_NAME = 'newvoice.db';
const KEY_ITEM = 'db.key.v1';
const KEY_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

export type Db = ExpoSQLiteDatabase<typeof schema>;
export type OpenDb = { raw: SQLiteDatabase; db: Db };

export class DbOpenError extends Error {
  constructor(
    message: string,
    /** "no-cipher": this build lacks SQLCipher. "unreadable": the file exists but this key can't open it. */
    readonly kind: 'no-cipher' | 'unreadable' | 'other',
  ) {
    super(message);
  }
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

async function getOrCreateKey(): Promise<string> {
  const existing = await SecureStore.getItemAsync(KEY_ITEM, KEY_OPTIONS);
  if (existing && /^[0-9a-f]{64}$/.test(existing)) return existing;
  const key = toHex(await getRandomBytesAsync(32));
  await SecureStore.setItemAsync(KEY_ITEM, key, KEY_OPTIONS);
  return key;
}

export async function openDb(): Promise<OpenDb> {
  const raw = await openDatabaseAsync(DB_NAME);
  try {
    const cipher = await raw.getFirstAsync<{ cipher_version: string }>('PRAGMA cipher_version');
    if (cipher == null) {
      // Without SQLCipher, PRAGMA key is silently ignored and data would be
      // stored in the clear. Refuse rather than do that.
      throw new DbOpenError('This build has no SQLCipher, so the database would not be encrypted.', 'no-cipher');
    }
    const key = await getOrCreateKey();
    // A raw 256-bit key (x'…') skips SQLCipher's passphrase KDF.
    await raw.execAsync(`PRAGMA key = "x'${key}'"`);
    try {
      // The first read after keying is where a wrong key shows up.
      await raw.getFirstAsync('SELECT count(*) FROM sqlite_master');
    } catch (e) {
      throw new DbOpenError(`Saved data can't be unlocked on this phone (${String(e)}).`, 'unreadable');
    }
    await raw.execAsync('PRAGMA foreign_keys = ON');
    const db = drizzle(raw, { schema });
    await migrate(db, migrations);
    return { raw, db };
  } catch (e) {
    await raw.closeAsync().catch(() => {});
    if (e instanceof DbOpenError) throw e;
    throw new DbOpenError(String(e), 'other');
  }
}

/** Deletes the database file and its key. The caller must have closed the database. */
export async function deleteDb(): Promise<void> {
  await deleteDatabaseAsync(DB_NAME).catch((e) => {
    // A missing file is fine; anything else is not.
    if (!/not.*(exist|found)/i.test(String(e))) throw e;
  });
  await SecureStore.deleteItemAsync(KEY_ITEM, KEY_OPTIONS);
}
