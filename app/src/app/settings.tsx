import { eq } from 'drizzle-orm';
import { useEffect, useState } from 'react';
import { Alert, StyleSheet, Switch, Text, View } from 'react-native';

import { user as userTable } from '../db/schema';
import { PinSetup } from '../privacy/PinSetup';
import { biometricAvailable, biometricEnabled, removePin, setBiometricEnabled } from '../privacy/pinStore';
import { useApp, useDb } from '../state/AppState';
import { Body, Button, colors, Heading, Panel, Screen } from '../ui/kit';

export default function Settings() {
  const db = useDb();
  const { user, refreshUser, pinSet, refreshPin, deleteAllData } = useApp();
  const [settingPin, setSettingPin] = useState(false);
  const [bioAvailable, setBioAvailable] = useState(false);
  const [bioOn, setBioOn] = useState(false);

  useEffect(() => {
    void (async () => {
      setBioAvailable(await biometricAvailable());
      setBioOn(await biometricEnabled());
    })();
  }, [pinSet]);

  const update = async (set: Partial<typeof userTable.$inferInsert>) => {
    await db.update(userTable).set(set).where(eq(userTable.id, 1));
    await refreshUser();
  };

  const confirmDelete = () =>
    Alert.alert(
      'Delete all data?',
      'This deletes your answers, progress, measurements, recordings and PIN from this phone. It cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete everything',
          style: 'destructive',
          // The app remounts from the start afterwards, which leads to onboarding.
          onPress: () => void deleteAllData(),
        },
      ],
    );

  return (
    <Screen>
      <Heading>App lock</Heading>
      <Panel>
        {settingPin ? (
          <PinSetup
            onDone={async () => {
              await refreshPin();
              setSettingPin(false);
            }}
            onCancel={() => setSettingPin(false)}
          />
        ) : pinSet ? (
          <>
            <Body>NewVoice locks with your PIN whenever you leave it.</Body>
            {bioAvailable ? (
              <Toggle
                label="Unlock with Face ID"
                value={bioOn}
                onChange={async (on) => {
                  await setBiometricEnabled(on);
                  setBioOn(on);
                }}
              />
            ) : null}
            <Button label="Change PIN" kind="secondary" onPress={() => setSettingPin(true)} />
            <Button
              label="Turn off PIN"
              kind="secondary"
              onPress={async () => {
                await removePin();
                await refreshPin();
              }}
            />
          </>
        ) : (
          <>
            <Body>No PIN. Anyone with your phone unlocked can open NewVoice.</Body>
            <Button label="Set a PIN" onPress={() => setSettingPin(true)} />
          </>
        )}
      </Panel>

      <Heading>Recordings</Heading>
      <Panel>
        <Toggle
          label="Numbers only, never keep audio"
          value={user?.metricsOnly ?? true}
          onChange={(on) => void update(on ? { metricsOnly: true, playbackEnabled: false } : { metricsOnly: false })}
        />
        <Toggle
          label="Let me listen back to recordings"
          value={user?.playbackEnabled ?? false}
          disabled={user?.metricsOnly ?? true}
          onChange={(on) => void update({ playbackEnabled: on })}
        />
      </Panel>

      <Heading>Quick exit</Heading>
      <Panel>
        <Body muted>
          Exit, at the top of every screen, blanks NewVoice at once and stops the microphone. Press and hold the blank
          screen for a moment to come back{pinSet ? ', then enter your PIN' : ''}.
        </Body>
      </Panel>

      <Heading>Your data</Heading>
      <Panel>
        <Body muted>Everything is stored encrypted on this phone. Nothing is uploaded.</Body>
        <Button label="Delete all data…" kind="danger" onPress={confirmDelete} />
      </Panel>
    </Screen>
  );
}

function Toggle({
  label,
  value,
  onChange,
  disabled = false,
}: {
  label: string;
  value: boolean;
  onChange: (on: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <View style={[styles.toggle, disabled && styles.disabled]}>
      <Text style={styles.toggleLabel}>{label}</Text>
      <Switch value={value} onValueChange={onChange} disabled={disabled} trackColor={{ true: colors.accent }} />
    </View>
  );
}

const styles = StyleSheet.create({
  toggle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 8, gap: 12 },
  toggleLabel: { color: colors.text, fontSize: 16, flex: 1 },
  disabled: { opacity: 0.5 },
});
