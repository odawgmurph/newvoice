import { router } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { View } from 'react-native';

import { user as userTable, type Environment, type Goal } from '../db/schema';
import { PinSetup } from '../privacy/PinSetup';
import { useApp, useDb } from '../state/AppState';
import {
  BackButton,
  Body,
  Bullet,
  Button,
  Card,
  Choice,
  Display,
  ExitButton,
  Field,
  Heading,
  Screen,
  StepDots,
} from '../ui/kit';

// Onboarding (build plan Stage 4; handbook §4.3): goal, playback comfort,
// practice environment, language, optional context, an optional PIN, and the
// safety primer. Layout follows the design canvas's Onboarding board. Copy
// follows D2 (neutral labels) and D3 (education app: no therapy, treatment,
// diagnosis or clinical claims). Baseline capture follows in a later iteration.

type Playback = 'metrics' | 'keep' | 'listen';
type Context = 'hormones' | 'surgery' | 'both' | 'neither';
type Slp = 'yes' | 'no' | 'past';

const STEPS = ['welcome', 'goal', 'playback', 'environment', 'about', 'lock', 'safety'] as const;

type StepProps = {
  children: ReactNode;
  action?: string;
  onAction?: () => void;
  canContinue?: boolean;
  showFooter?: boolean;
};

/** One onboarding step: back · step dots · Exit, the content, and a pinned action. */
function StepScreen({
  step,
  onBack,
  onExit,
  onNext,
  children,
  action = 'Continue',
  onAction,
  canContinue = true,
  showFooter = true,
}: StepProps & { step: number; onBack: () => void; onExit: () => void; onNext: () => void }) {
  return (
    <Screen
      edges={['top', 'bottom']}
      header={
        <>
          {step > 0 ? <BackButton onPress={onBack} /> : <View style={{ width: 44 }} />}
          <StepDots count={STEPS.length} current={step} />
          <ExitButton onPress={onExit} />
        </>
      }
      footer={showFooter ? <Button label={action} onPress={onAction ?? onNext} disabled={!canContinue} /> : undefined}
    >
      {children}
    </Screen>
  );
}

export default function Onboarding() {
  const db = useDb();
  const { refreshUser, refreshPin, pinSet, quickExit } = useApp();
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

  const nav = { step, onBack: back, onExit: quickExit, onNext: next };

  switch (STEPS[step]) {
    case 'welcome':
      return (
        <StepScreen key={step} {...nav}>
          <Display>Your voice, your pace</Display>
          <Body>
            NewVoice helps you practise toward the voice you want. It shows pitch, resonance and vocal weight compared
            with your own starting point, and builds up skills in short lessons.
          </Body>
          <Body>
            Everything stays on this phone: there's no account, and audio is analysed here and never uploaded. Your
            answers are stored encrypted.
          </Body>
          <Body muted>NewVoice is a practice and learning tool. It can't check the health of your voice.</Body>
        </StepScreen>
      );

    case 'goal':
      return (
        <StepScreen key={step} {...nav} canContinue={goal != null}>
          <Display>Where would you like your voice to go?</Display>
          <Body muted>
            There's no right answer, and you can change this any time. We'll always measure against your own starting
            point.
          </Body>
          <View accessibilityRole="radiogroup" accessibilityLabel="Voice goal">
            <Choice
              label="More feminine"
              detail="Lighter, brighter, higher"
              selected={goal === 'feminine'}
              onPress={() => setGoal('feminine')}
            />
            <Choice
              label="Androgynous"
              detail="Somewhere comfortably in between"
              selected={goal === 'androgynous'}
              onPress={() => setGoal('androgynous')}
            />
            <Choice
              label="Flexible"
              detail="Switch between voices when you choose"
              selected={goal === 'flexible'}
              onPress={() => setGoal('flexible')}
            />
            <Choice
              label="My own goal"
              detail="Pick your own targets for each dimension"
              selected={goal === 'own'}
              onPress={() => setGoal('own')}
            />
          </View>
          {goal === 'own' ? (
            <Field value={goalNote} onChangeText={setGoalNote} placeholder="Describe it, if you like" maxLength={200} />
          ) : null}
        </StepScreen>
      );

    case 'playback':
      return (
        <StepScreen key={step} {...nav}>
          <Display>Hearing your own voice</Display>
          <Body muted>
            Hearing recordings of yourself can be uncomfortable, especially early on. You can practise from the numbers
            alone.
          </Body>
          <View accessibilityRole="radiogroup" accessibilityLabel="Recordings">
            <Choice
              label="Numbers only"
              detail="Keep the measurements, never keep audio"
              selected={playback === 'metrics'}
              onPress={() => setPlayback('metrics')}
            />
            <Choice
              label="Keep audio, don't play it"
              detail="Saved on this phone so you can listen later if you choose"
              selected={playback === 'keep'}
              onPress={() => setPlayback('keep')}
            />
            <Choice
              label="Keep audio and let me listen back"
              selected={playback === 'listen'}
              onPress={() => setPlayback('listen')}
            />
          </View>
        </StepScreen>
      );

    case 'environment':
      return (
        <StepScreen key={step} {...nav} canContinue={environment != null}>
          <Display>Where will you practise?</Display>
          <View accessibilityRole="radiogroup" accessibilityLabel="Practice environment">
            <Choice
              label="Somewhere private"
              selected={environment === 'private'}
              onPress={() => setEnvironment('private')}
            />
            <Choice
              label="Others may hear me"
              detail="Lessons can lean on quieter exercises"
              selected={environment === 'shared'}
              onPress={() => setEnvironment('shared')}
            />
            <Choice
              label="I can only be quiet"
              detail="Quiet and whisper exercises where possible"
              selected={environment === 'quiet_only'}
              onPress={() => setEnvironment('quiet_only')}
            />
          </View>
        </StepScreen>
      );

    case 'about':
      return (
        <StepScreen key={step} {...nav}>
          <Display>A little context</Display>
          <Body muted>All optional. It helps set expectations and stays on this phone.</Body>
          <Heading>Language or accent you speak in</Heading>
          <Field value={language} onChangeText={setLanguage} placeholder="e.g. English, Scottish" maxLength={80} />
          <Body muted>The reference data is mostly from American English speakers for now.</Body>
          <Heading>Hormones or voice surgery</Heading>
          <View accessibilityRole="radiogroup" accessibilityLabel="Hormones or voice surgery">
            <Choice label="Hormones" selected={context === 'hormones'} onPress={() => setContext('hormones')} />
            <Choice label="Voice surgery" selected={context === 'surgery'} onPress={() => setContext('surgery')} />
            <Choice label="Both" selected={context === 'both'} onPress={() => setContext('both')} />
            <Choice label="Neither" selected={context === 'neither'} onPress={() => setContext('neither')} />
            <Choice label="Prefer not to say" selected={context === null} onPress={() => setContext(null)} />
          </View>
          <Heading>Working with a speech-language pathologist?</Heading>
          <View accessibilityRole="radiogroup" accessibilityLabel="Speech-language pathologist">
            <Choice label="Yes" selected={slp === 'yes'} onPress={() => setSlp('yes')} />
            <Choice label="In the past" selected={slp === 'past'} onPress={() => setSlp('past')} />
            <Choice label="No" selected={slp === 'no'} onPress={() => setSlp('no')} />
            <Choice label="Prefer not to say" selected={slp === null} onPress={() => setSlp(null)} />
          </View>
        </StepScreen>
      );

    case 'lock':
      return (
        <StepScreen key={step} {...nav} showFooter={!settingPin} action={pinSet ? 'Continue' : 'Skip for now'}>
          <Display>Keep it private</Display>
          <Body>
            A PIN keeps NewVoice locked whenever you leave it. It's optional. Exit, at the top of every screen, blanks
            the app at once; press and hold the blank screen to come back.
          </Body>
          {pinSet ? (
            <Card>
              <Body>PIN is set.</Body>
            </Card>
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
        </StepScreen>
      );

    case 'safety':
      return (
        <StepScreen key={step} {...nav} action="I understand" onAction={() => void finish()}>
          <Display>Looking after your voice</Display>
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
        </StepScreen>
      );
  }
}
