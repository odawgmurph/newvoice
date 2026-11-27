import { eq } from 'drizzle-orm';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert } from 'react-native';

import { currentIcon, DISCREET_ICONS, setIcon, supportsIcons } from '../../modules/newvoice-discreet/src';

import { user as userTable } from '../db/schema';
import { PinSetup } from '../privacy/PinSetup';
import { biometricAvailable, biometricEnabled, removePin, setBiometricEnabled } from '../privacy/pinStore';
import { useApp, useDb } from '../state/AppState';
import { Body, Button, Caption, Card, Choice, ErrorText, Heading, Screen, Toggle } from '../ui/kit';

export default function Settings() {
  const db = useDb();
  const { user, refreshUser, pinSet, refreshPin, deleteAllData } = useApp();
  const [settingPin, setSettingPin] = useState(false);
  const [bioAvailable, setBioAvailable] = useState(false);
  const [bioOn, setBioOn] = useState(false);
  const [icons, setIcons] = useState(false);
  const [icon, setIconName] = useState<string | null>(null);
  const [iconError, setIconError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      setIcons(await supportsIcons());
      setIconName(await currentIcon());
    })();
  }, []);

  const pickIcon = async (name: string | null) => {
    setIconError(null);
    try {
      await setIcon(name);
      setIconName(name);
    } catch (e) {
      setIconError(e instanceof Error ? e.message : String(e));
    }
  };

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

      <Heading>Home-screen icon</Heading>
      <Card>
        {icons ? (
          <>
            <Body muted>A plainer icon draws less attention. The name under it stays the same.</Body>
            {DISCREET_ICONS.map((i) => (
              <Choice key={i.label} label={i.label} selected={icon === i.name} onPress={() => void pickIcon(i.name)} />
            ))}
            {iconError ? <ErrorText>{iconError}</ErrorText> : null}
          </>
        ) : (
          <Body muted>This phone can’t change NewVoice’s icon.</Body>
        )}
      </Card>

      <Heading>Lessons</Heading>
      <Card>
        <Body muted>The order lessons come in. You can switch any time; finished units stay finished.</Body>
        <Choice
          label="Pitch and weight first"
          detail="Hearing, then pitch, lightness, size and brightness. Recommended."
          selected={(user?.track ?? 'default') === 'default'}
          onPress={() => void update({ track: 'default' })}
        />
        <Choice
          label="Resonance first"
          detail="Hearing, then size and brightness before pitch."
          selected={user?.track === 'resonance-first'}
          onPress={() => void update({ track: 'resonance-first' })}
        />
        <Toggle label="Quiet mode: skip loud exercises" value={user?.quietMode ?? false} onChange={(on) => void update({ quietMode: on })} />
        <Toggle label="Whisper mode in free practice (no pitch)" value={user?.whisperMode ?? false} onChange={(on) => void update({ whisperMode: on })} />
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
        <Toggle label="Shake the phone to exit too" value={user?.shakeToExit ?? true} onChange={(on) => void update({ shakeToExit: on })} />
      </Card>

      <Heading>Your data</Heading>
      <Card>
        <Body muted>Everything is stored encrypted on this phone. Nothing is uploaded.</Body>
        <Button label="Privacy" kind="secondary" onPress={() => router.push('/privacy')} />
        <Button label="Delete all data…" kind="danger" onPress={confirmDelete} />
      </Card>

      <Heading>Developer tools</Heading>
      <Card>
        <Toggle label="Show the capture test" value={user?.developerTools ?? false} onChange={(on) => void update({ developerTools: on })} />
        <Caption>
          For checking microphone accuracy. Its test clip records 30 seconds of audio that you can export, the only
          place NewVoice writes audio you didn’t choose to keep.
        </Caption>
      </Card>
    </Screen>
  );
}
