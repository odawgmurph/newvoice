import { router } from 'expo-router';
import { useState } from 'react';

import { user as userTable, type Environment, type Goal } from '../db/schema';
import { PinSetup } from '../privacy/PinSetup';
import { useApp, useDb } from '../state/AppState';
import { Body, Bullet, Button, Choice, Field, Gap, Heading, Screen, Title } from '../ui/kit';

// Onboarding (build plan Stage 4; handbook §4.3): goal, playback comfort,
// practice environment, language, optional context, an optional PIN, and the
// safety primer. Copy follows D2 (neutral labels) and D3 (education app:
// no therapy, treatment, diagnosis or clinical claims). Baseline capture
// follows in a later iteration.

type Playback = 'metrics' | 'keep' | 'listen';
type Context = 'hormones' | 'surgery' | 'both' | 'neither';
type Slp = 'yes' | 'no' | 'past';

const STEPS = ['welcome', 'goal', 'playback', 'environment', 'about', 'lock', 'safety'] as const;

export default function Onboarding() {
  const db = useDb();
  const { refreshUser, refreshPin, pinSet } = useApp();
  const [step, setStep] = useState(0);
  const [goal, setGoal] = useState<Goal | null>(null);
  const [goalNote, setGoalNote] = useState('');
  const [playback, setPlayback] = useState<Playback>('metrics');
  const [environment, setEnvironment] = useState<Environment | null>(null);
  const [language, setLanguage] = useState('');
  const [context, setContext] = useState<Context | null>(null);
  const [slp, setSlp] = useState<Slp | null>(null);
  const [settingPin, setSettingPin] = useState(false);

  const next = () => setStep((s) => Math.min(s + 1, STEPS.length - 1));
  const back = () => setStep((s) => Math.max(s - 1, 0));

  const finish = async () => {
    const now = new Date();
    const row = {
      id: 1,
      goal,
      goalNote: goal === 'own' ? goalNote.trim() || null : null,
      environment,
      language: language.trim() || null,
      hormoneSurgeryStatus: context,
      slpStatus: slp,
      playbackEnabled: playback === 'listen',
      metricsOnly: playback === 'metrics',
      safetyPrimerAckAt: now,
      onboardedAt: now,
    };
    await db.insert(userTable).values(row).onConflictDoUpdate({ target: userTable.id, set: row });
    await refreshUser();
    router.replace('/');
  };

  const nav = (canContinue = true) => (
    <>
      <Gap />
      <Button label="Continue" onPress={next} disabled={!canContinue} />
      {step > 0 ? <Button label="Back" kind="secondary" onPress={back} /> : null}
    </>
  );

  switch (STEPS[step]) {
    case 'welcome':
      return (
        <Screen>
          <Title>Welcome</Title>
          <Body>
            NewVoice helps you practise toward the voice you want. It shows pitch, resonance and vocal weight compared
            with your own starting point, and builds up skills in short lessons.
          </Body>
          <Body>
            Everything stays on this phone: there's no account, and audio is analysed here and never uploaded. Your
            answers are stored encrypted.
          </Body>
          <Body muted>
            NewVoice is a practice and learning tool. It can't check the health of your voice.
          </Body>
          {nav()}
        </Screen>
      );

    case 'goal':
      return (
        <Screen>
          <Title>What are you aiming for?</Title>
          <Body muted>You can change this any time. There's no single right voice.</Body>
          <Choice label="More feminine" selected={goal === 'feminine'} onPress={() => setGoal('feminine')} />
          <Choice label="Androgynous" selected={goal === 'androgynous'} onPress={() => setGoal('androgynous')} />
          <Choice
            label="Flexible"
            detail="Able to move between voices"
            selected={goal === 'flexible'}
            onPress={() => setGoal('flexible')}
          />
          <Choice label="My own goal" selected={goal === 'own'} onPress={() => setGoal('own')} />
          {goal === 'own' ? (
            <Field value={goalNote} onChangeText={setGoalNote} placeholder="Describe it, if you like" maxLength={200} />
          ) : null}
          {nav(goal != null)}
        </Screen>
      );

    case 'playback':
      return (
        <Screen>
          <Title>Hearing your own voice</Title>
          <Body muted>
            Hearing recordings of yourself can be uncomfortable, especially early on. You can practise from the numbers
            alone.
          </Body>
          <Choice
            label="Numbers only"
            detail="Keep the measurements, never keep audio."
            selected={playback === 'metrics'}
            onPress={() => setPlayback('metrics')}
          />
          <Choice
            label="Keep audio, don't play it"
            detail="Saved on this phone so you can listen later if you choose."
            selected={playback === 'keep'}
            onPress={() => setPlayback('keep')}
          />
          <Choice
            label="Keep audio and let me listen back"
            selected={playback === 'listen'}
            onPress={() => setPlayback('listen')}
          />
          {nav()}
        </Screen>
      );

    case 'environment':
      return (
        <Screen>
          <Title>Where will you practise?</Title>
          <Choice
            label="Somewhere private"
            selected={environment === 'private'}
            onPress={() => setEnvironment('private')}
          />
          <Choice
            label="Others may hear me"
            detail="Lessons can lean on quieter exercises."
            selected={environment === 'shared'}
            onPress={() => setEnvironment('shared')}
          />
          <Choice
            label="I can only be quiet"
            detail="Quiet and whisper exercises where possible."
            selected={environment === 'quiet_only'}
            onPress={() => setEnvironment('quiet_only')}
          />
          {nav(environment != null)}
        </Screen>
      );

    case 'about':
      return (
        <Screen>
          <Title>A little context</Title>
          <Body muted>All optional. It helps set expectations and stays on this phone.</Body>
          <Heading>Language or accent you speak in</Heading>
          <Field value={language} onChangeText={setLanguage} placeholder="e.g. English, Scottish" maxLength={80} />
          <Body muted>The reference data is mostly from American English speakers for now.</Body>
          <Heading>Hormones or voice surgery</Heading>
          <Choice label="Hormones" selected={context === 'hormones'} onPress={() => setContext('hormones')} />
          <Choice label="Voice surgery" selected={context === 'surgery'} onPress={() => setContext('surgery')} />
          <Choice label="Both" selected={context === 'both'} onPress={() => setContext('both')} />
          <Choice label="Neither" selected={context === 'neither'} onPress={() => setContext('neither')} />
          <Choice label="Prefer not to say" selected={context === null} onPress={() => setContext(null)} />
          <Heading>Working with a speech-language pathologist?</Heading>
          <Choice label="Yes" selected={slp === 'yes'} onPress={() => setSlp('yes')} />
          <Choice label="In the past" selected={slp === 'past'} onPress={() => setSlp('past')} />
          <Choice label="No" selected={slp === 'no'} onPress={() => setSlp('no')} />
          <Choice label="Prefer not to say" selected={slp === null} onPress={() => setSlp(null)} />
          {nav()}
        </Screen>
      );

    case 'lock':
      return (
        <Screen>
          <Title>Keep it private</Title>
          <Body>
            A PIN keeps NewVoice locked whenever you leave it. The Exit button at the top of every screen blanks the app
            at once; press and hold the blank screen to come back.
          </Body>
          {pinSet ? (
            <Body>PIN is set.</Body>
          ) : settingPin ? (
            <PinSetup
              onDone={async () => {
                await refreshPin();
                setSettingPin(false);
              }}
              onCancel={() => setSettingPin(false)}
            />
          ) : (
            <Button label="Set a PIN" kind="secondary" onPress={() => setSettingPin(true)} />
          )}
          {settingPin ? null : nav()}
        </Screen>
      );

    case 'safety':
      return (
        <Screen>
          <Title>Looking after your voice</Title>
          <Body>Voice training is safe when it's gentle. NewVoice builds these in:</Body>
          <Bullet>Every session starts with a short warm-up and ends with a cool-down.</Bullet>
          <Bullet>Short sessions work best: about 10–20 minutes, a few times a day, not one long one.</Bullet>
          <Heading>Stop practising if you notice</Heading>
          <Bullet>pain or a raw throat</Bullet>
          <Bullet>hoarseness after practice</Bullet>
          <Bullet>it taking more and more effort</Bullet>
          <Bullet>losing the top of your range, or your voice cutting out</Bullet>
          <Heading>See a doctor</Heading>
          <Body>
            If hoarseness lasts more than about two weeks, speaking hurts, or you cough up blood, see an ENT doctor or
            laryngologist, and a speech-language pathologist.
          </Body>
          <Gap />
          <Button label="I understand" onPress={() => void finish()} />
          <Button label="Back" kind="secondary" onPress={back} />
        </Screen>
      );
  }
}
