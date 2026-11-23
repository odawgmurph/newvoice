import { eq } from 'drizzle-orm';
import { useEffect, useState } from 'react';
import { Alert } from 'react-native';

import { user as userTable } from '../db/schema';
import { PinSetup } from '../privacy/PinSetup';
import { biometricAvailable, biometricEnabled, removePin, setBiometricEnabled } from '../privacy/pinStore';
import { useApp, useDb } from '../state/AppState';
import { Body, Button, Card, Heading, Screen, Toggle } from '../ui/kit';

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
      <Card>
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
      </Card>

      <Heading>Recordings</Heading>
      <Card>
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
      </Card>

      <Heading>Feedback labels</Heading>
      <Card>
        <Body muted>
          NewVoice describes your voice as higher or lower, brighter or darker, lighter or heavier, compared with
          your own starting point. It never puts your voice in a category.
        </Body>
        <Toggle
          label="Show reference groups on charts"
          value={user?.genderedBands ?? false}
          onChange={(on) => void update({ genderedBands: on })}
        />
        <Body muted>
          Off by default. When on, the charts name their two reference areas after the groups the reference
          recordings came from (adult speakers of American English, recorded in 1995) and show those groups’ typical
          ranges. They describe averages of other people, not a goal or a verdict on your voice.
        </Body>
      </Card>

      <Heading>Quick exit</Heading>
      <Card>
        <Body muted>
          Exit, at the top of every screen, blanks NewVoice at once and stops the microphone. Press and hold the blank
          screen for a moment to come back{pinSet ? ', then enter your PIN' : ''}.
        </Body>
      </Card>

      <Heading>Your data</Heading>
      <Card>
        <Body muted>Everything is stored encrypted on this phone. Nothing is uploaded.</Body>
        <Button label="Delete all data…" kind="danger" onPress={confirmDelete} />
      </Card>
    </Screen>
  );
}
