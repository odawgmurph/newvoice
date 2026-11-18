import { eq } from 'drizzle-orm';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { AppState as RNAppState } from 'react-native';

import { DbOpenError, deleteDb, openDb, type Db, type OpenDb } from '../db/client';
import { user as userTable, type User } from '../db/schema';
import { clearLock, hasPin } from '../privacy/pinStore';
import { deleteRecordings, isFreshInstall, markInstalled } from '../storage/files';

// App-wide state: the encrypted database, the user row, the PIN lock and the
// quick-exit cover. Screens only render once the database is open and the
// app is unlocked, so they can rely on `useDb()`.

type Status =
  | { kind: 'opening' }
  | { kind: 'error'; error: DbOpenError }
  | { kind: 'ready'; open: OpenDb };

type AppCtx = {
  status: Status;
  user: User | null;
  refreshUser: () => Promise<void>;
  pinSet: boolean;
  refreshPin: () => Promise<void>;
  locked: boolean;
  unlock: () => void;
  /** Quick exit: replace everything with a blank cover and lock. */
  covered: boolean;
  quickExit: () => void;
  uncover: () => void;
  /** Deletes the database, its key, all recordings and the PIN, then starts fresh. */
  deleteAllData: () => Promise<void>;
};

const Ctx = createContext<AppCtx | null>(null);

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>({ kind: 'opening' });
  const [user, setUser] = useState<User | null>(null);
  const [pinSet, setPinSet] = useState(false);
  // Start locked until we know whether a PIN exists, so nothing flashes.
  const [locked, setLocked] = useState(true);
  const [covered, setCovered] = useState(false);
  const openRef = useRef<OpenDb | null>(null);

  const loadUser = useCallback(async (db: Db) => {
    const row = await db.query.user.findFirst({ where: eq(userTable.id, 1) });
    setUser(row ?? null);
  }, []);

  const open = useCallback(async () => {
    setStatus({ kind: 'opening' });
    try {
      const o = await openDb();
      openRef.current = o;
      await loadUser(o.db);
      setStatus({ kind: 'ready', open: o });
    } catch (e) {
      setStatus({ kind: 'error', error: e instanceof DbOpenError ? e : new DbOpenError(String(e), 'other') });
    }
  }, [loadUser]);

  const refreshPin = useCallback(async () => {
    const has = await hasPin();
    setPinSet(has);
    return has;
  }, []);

  useEffect(() => {
    void (async () => {
      if (isFreshInstall()) {
        // Fresh install: drop Keychain items left by an earlier install.
        await clearLock();
        await deleteDb();
        markInstalled();
      }
      const has = await refreshPin();
      setLocked(has);
      await open();
    })();
    return () => {
      void openRef.current?.raw.closeAsync();
    };
  }, [open, refreshPin]);

  // Lock whenever the app goes to the background.
  useEffect(() => {
    const sub = RNAppState.addEventListener('change', (next) => {
      if (next === 'background' && pinSet) setLocked(true);
    });
    return () => sub.remove();
  }, [pinSet]);

  const refreshUser = useCallback(async () => {
    if (openRef.current) await loadUser(openRef.current.db);
  }, [loadUser]);

  const quickExit = useCallback(() => {
    setCovered(true);
    if (pinSet) setLocked(true);
  }, [pinSet]);

  const deleteAllData = useCallback(async () => {
    const o = openRef.current;
    openRef.current = null;
    setStatus({ kind: 'opening' });
    if (o) await o.raw.closeAsync();
    deleteRecordings();
    await deleteDb();
    await clearLock();
    setPinSet(false);
    setLocked(false);
    setUser(null);
    await open();
  }, [open]);

  const value: AppCtx = {
    status,
    user,
    refreshUser,
    pinSet,
    refreshPin: async () => {
      await refreshPin();
    },
    locked: locked && pinSet,
    unlock: () => setLocked(false),
    covered,
    quickExit,
    uncover: () => setCovered(false),
    deleteAllData,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): AppCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useApp outside AppStateProvider');
  return ctx;
}

/** The open database. Only call from screens rendered after the gate. */
export function useDb(): Db {
  const { status } = useApp();
  if (status.kind !== 'ready') throw new Error('Database not open');
  return status.open.db;
}
