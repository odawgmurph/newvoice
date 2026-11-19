import { useEffect, useState } from 'react';
import { AppState, Pressable, StyleSheet, View } from 'react-native';

import { useApp } from '../state/AppState';
import { Body, Button, ErrorText, Field, Gap, Screen, Title } from '../ui/kit';
import { type } from '../ui/theme';
import { PIN_MAX } from './pin';
import { biometricEnabled, checkPin, unlockWithBiometrics } from './pinStore';

/** PIN (and optional Face ID) unlock. Shows no app name or content. */
export function LockScreen() {
  const { unlock } = useApp();
  const [pin, setPin] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [useBio, setUseBio] = useState(false);

  const tryBiometrics = async () => {
    try {
      if (await unlockWithBiometrics()) unlock();
    } catch {
      // Cancelled or unavailable: the PIN is the fallback.
    }
  };

  useEffect(() => {
    void (async () => {
      const on = await biometricEnabled();
      setUseBio(on);
      if (on) await tryBiometrics();
    })();
    // Run once when the lock appears.
  }, []);

  const submit = async () => {
    if (busy || pin.length === 0) return;
    setBusy(true);
    const result = await checkPin(pin);
    setBusy(false);
    setPin('');
    if (result.ok) {
      unlock();
    } else if (result.waitMs > 0) {
      setMessage(`Wrong PIN. Try again in ${formatWait(result.waitMs)}.`);
    } else {
      setMessage('Wrong PIN.');
    }
  };

  return (
    <Screen scroll={false} edges={['top', 'bottom']}>
      <View style={styles.center}>
        <Title>Enter PIN</Title>
        <Field
          value={pin}
          onChangeText={(t) => setPin(t.replace(/\D/g, ''))}
          keyboardType="number-pad"
          secureTextEntry
          maxLength={PIN_MAX}
          autoFocus
          onSubmitEditing={submit}
          accessibilityLabel="PIN"
          style={styles.pin}
        />
        {message ? <ErrorText>{message}</ErrorText> : null}
        <Button label="Unlock" onPress={submit} disabled={busy || pin.length === 0} />
        {useBio ? <Button label="Use Face ID" kind="secondary" onPress={tryBiometrics} /> : null}
        <Gap size={24} />
        <Body muted>
          Forgot it? The PIN can't be recovered. Deleting and reinstalling the app starts fresh, without the old data.
        </Body>
      </View>
    </Screen>
  );
}

function formatWait(ms: number): string {
  const s = Math.ceil(ms / 1000);
  return s < 90 ? `${s} seconds` : `${Math.ceil(s / 60)} minutes`;
}

/**
 * Quick-exit cover: a blank screen with nothing identifying on it. Everything
 * behind it is unmounted (so the mic stops). A long press brings the app back,
 * through the PIN if one is set.
 */
export function Cover() {
  const { uncover } = useApp();
  return (
    <Pressable
      style={styles.cover}
      onLongPress={uncover}
      delayLongPress={1500}
      accessible={false}
      importantForAccessibility="no-hide-descendants"
    />
  );
}

/** Hides content while the app is inactive, so the app switcher snapshot is blank. */
export function SwitcherShield() {
  const [active, setActive] = useState(AppState.currentState === 'active');
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => setActive(s === 'active'));
    return () => sub.remove();
  }, []);
  if (active) return null;
  return <View style={[StyleSheet.absoluteFill, styles.cover]} pointerEvents="none" />;
}

/** Shown when the encrypted database can't be opened. */
export function DbErrorScreen() {
  const { status, deleteAllData } = useApp();
  const [confirm, setConfirm] = useState(false);
  if (status.kind !== 'error') return null;
  const { error } = status;

  return (
    <Screen edges={['top', 'bottom']}>
      <Title>Can't open your saved data</Title>
      {error.kind === 'no-cipher' ? (
        <Body>
          This build doesn't include database encryption, so NewVoice won't store anything. Install a build made with
          the project's app config (it turns SQLCipher on).
        </Body>
      ) : error.kind === 'unreadable' ? (
        <Body>
          The saved data on this phone is encrypted with a key this phone no longer has, for example after restoring
          from a backup. It can't be recovered. You can start fresh, which deletes it.
        </Body>
      ) : (
        <Body>Something went wrong opening the database.</Body>
      )}
      <Body muted>{error.message}</Body>
      {error.kind !== 'no-cipher' ? (
        confirm ? (
          <Button label="Delete everything and start fresh" kind="danger" onPress={() => void deleteAllData()} />
        ) : (
          <Button label="Start fresh…" kind="secondary" onPress={() => setConfirm(true)} />
        )
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center' },
  pin: { ...type.readout, letterSpacing: 8, textAlign: 'center' },
  cover: { flex: 1, backgroundColor: '#000' },
});
