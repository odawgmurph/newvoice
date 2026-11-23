import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import NewVoiceAudio from '../../modules/newvoice-audio/src/NewVoiceAudioModule';
import type { CaptureInfo, FramesEvent, TaskResult } from '../../modules/newvoice-audio/src/NewVoiceAudio.types';
import {
  BASELINE_TASKS,
  buildSummary,
  checkTask,
  formatHz,
  isUsable,
  noteName,
  resonanceTokens,
  stToHz,
  type BaselineResults,
  type BaselineSummary,
  type Issue,
} from '../baseline/plan';
import { audioPath, completeBaseline, deleteAudio, saveTask, startBaseline } from '../baseline/store';
import { useApp, useDb } from '../state/AppState';
import { Body, Bullet, Button, Caption, Card, Display, ErrorText, Heading, Overline, Screen, StepDots } from '../ui/kit';
import { radius, space, type, useTheme, type Colors } from '../ui/theme';

// Baseline capture (build plan Stage 4, D20): six short recordings measured
// on the phone by the Rust core. No live pitch is shown while recording, so
// the baseline is the everyday voice rather than one steered by a readout;
// only a level meter confirms the phone hears you. Results use neutral words
// and no gender labels (D2).

type Ids = { baselineId: number; sessionId: number; startedAt: Date };

type Phase =
  | { kind: 'intro' }
  | { kind: 'ready'; index: number }
  | { kind: 'recording'; index: number; startedAt: number }
  | { kind: 'analysing'; index: number }
  | { kind: 'review'; index: number; result: TaskResult; issues: Issue[] }
  | { kind: 'saving' }
  | { kind: 'done'; summary: BaselineSummary };

function errorMessage(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (/permission/i.test(msg)) {
    return 'NewVoice needs the microphone to measure your voice. Allow it in Settings › NewVoice › Microphone, then try again.';
  }
  return `Something went wrong: ${msg}`;
}

export default function BaselineScreen() {
  const db = useDb();
  const { user, refreshUser } = useApp();
  const s = useStyles();
  const [phase, setPhase] = useState<Phase>({ kind: 'intro' });
  const [error, setError] = useState<string | null>(null);
  const ids = useRef<Ids | null>(null);
  const results = useRef<BaselineResults>({});
  const finishing = useRef(false);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const keepAudio = !(user?.metricsOnly ?? true);

  // Leaving the screen (back, quick exit, the lock) stops the microphone and
  // drops any recorded audio that wasn't measured yet.
  useEffect(
    () => () => {
      void NewVoiceAudio.stop()
        .then(() => NewVoiceAudio.discardLastClip())
        .catch(() => {});
    },
    [],
  );

  const measure = useCallback(
    async (index: number) => {
      if (finishing.current) return;
      finishing.current = true;
      const task = BASELINE_TASKS[index];
      setPhase({ kind: 'analysing', index });
      try {
        const result = await NewVoiceAudio.analyseLastClip({
          kind: task.kind,
          saveAs: keepAudio && ids.current ? audioPath(ids.current.baselineId, task) : undefined,
        });
        const issues = checkTask(task, result);
        if (!isUsable(issues)) deleteAudio(result.audioUri);
        setPhase({ kind: 'review', index, result, issues });
      } catch (e) {
        setError(errorMessage(e));
        setPhase({ kind: 'ready', index });
      }
    },
    [keepAudio],
  );

  // The recording ends by itself at the task's limit; native code then
  // reports capture stopped.
  useEffect(() => {
    const sub = NewVoiceAudio.addListener('onCaptureInfo', (info: CaptureInfo) => {
      const p = phaseRef.current;
      if (p.kind === 'recording' && !info.running) void measure(p.index);
    });
    return () => sub.remove();
  }, [measure]);

  const begin = async () => {
    setError(null);
    try {
      ids.current = await startBaseline(db);
      results.current = {};
      setPhase({ kind: 'ready', index: 0 });
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const record = async (index: number) => {
    setError(null);
    finishing.current = false;
    try {
      await NewVoiceAudio.start({ recordSeconds: BASELINE_TASKS[index].recordSeconds });
      setPhase({ kind: 'recording', index, startedAt: Date.now() });
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const stopEarly = async (index: number) => {
    try {
      await NewVoiceAudio.stop();
      await measure(index);
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const retry = (index: number, result: TaskResult) => {
    deleteAudio(result.audioUri);
    setPhase({ kind: 'ready', index });
  };

  const keep = async (index: number, result: TaskResult) => {
    const task = BASELINE_TASKS[index];
    const current = ids.current;
    if (!current) return;
    try {
      await saveTask(db, current, task, result);
      results.current[task.id] = result;
      if (index + 1 < BASELINE_TASKS.length) {
        setPhase({ kind: 'ready', index: index + 1 });
        return;
      }
      setPhase({ kind: 'saving' });
      const tokens = resonanceTokens(results.current);
      const resonance = tokens.length > 0 ? NewVoiceAudio.resonanceScore(tokens) : null;
      const summary = buildSummary(results.current, resonance);
      await completeBaseline(db, current, summary);
      await refreshUser();
      setPhase({ kind: 'done', summary });
    } catch (e) {
      setError(errorMessage(e));
      setPhase({ kind: 'review', index, result, issues: checkTask(task, result) });
    }
  };

  const dots = (index: number) => (
    <View style={s.dotsRow}>
      <StepDots count={BASELINE_TASKS.length} current={index} />
    </View>
  );

  switch (phase.kind) {
    case 'intro':
      return (
        <Screen footer={<Button label="Start" onPress={() => void begin()} />}>
          <Display>Your starting point</Display>
          <Body>
            Six short recordings, about five minutes. Lessons measure everything against these, so use your everyday
            voice. It isn’t a test, and there’s no score.
          </Body>
          <Bullet>Find a quiet spot and hold the phone about a forearm’s length away.</Bullet>
          <Bullet>Use the phone’s own microphone rather than Bluetooth headphones.</Bullet>
          <Bullet>Stop if anything hurts or feels strained.</Bullet>
          <Body muted>
            {keepAudio
              ? 'Your recordings are kept on this phone, as you chose. They are never uploaded.'
              : 'Each recording is measured on this phone and then discarded. Only the numbers are kept.'}
          </Body>
          {error ? <ErrorText>{error}</ErrorText> : null}
          <Button label="Not now" kind="quiet" onPress={() => router.replace('/')} />
        </Screen>
      );

    case 'ready':
    case 'recording':
    case 'analysing': {
      const task = BASELINE_TASKS[phase.index];
      const footer =
        phase.kind === 'ready' ? (
          <Button label="Record" onPress={() => void record(phase.index)} />
        ) : phase.kind === 'recording' ? (
          <Button
            label={task.minSeconds > 0 ? 'Stop' : 'Done'}
            kind="secondary"
            onPress={() => void stopEarly(phase.index)}
          />
        ) : (
          <Button label="Measuring…" disabled onPress={() => {}} />
        );
      return (
        <Screen footer={footer}>
          {dots(phase.index)}
          <Overline>
            Recording {phase.index + 1} of {BASELINE_TASKS.length}
          </Overline>
          <Display>{task.title}</Display>
          <Body>{task.prompt}</Body>
          <TaskText task={task} />
          {phase.kind === 'recording' ? (
            <RecordingStatus startedAt={phase.startedAt} limitS={task.recordSeconds} />
          ) : null}
          {error ? <ErrorText>{error}</ErrorText> : null}
        </Screen>
      );
    }

    case 'review': {
      const { index, result, issues } = phase;
      const usable = isUsable(issues);
      const task = BASELINE_TASKS[index];
      return (
        <Screen
          footer={
            <>
              {usable ? (
                <Button
                  label={index + 1 < BASELINE_TASKS.length ? 'Next' : 'Finish'}
                  onPress={() => void keep(index, result)}
                />
              ) : null}
              <Button
                label="Record again"
                kind={usable ? 'quiet' : 'primary'}
                onPress={() => retry(index, result)}
              />
            </>
          }
        >
          {dots(index)}
          <Overline>
            Recording {index + 1} of {BASELINE_TASKS.length}
          </Overline>
          <Display>{usable ? 'Got it' : 'Let’s try that again'}</Display>
          <Body muted>{task.title}</Body>
          {issues.map((i) => (i.blocking ? <ErrorText key={i.code}>{i.message}</ErrorText> : <Body key={i.code}>{i.message}</Body>))}
          {error ? <ErrorText>{error}</ErrorText> : null}
        </Screen>
      );
    }

    case 'saving':
      return (
        <Screen>
          <Display>Saving your starting point…</Display>
        </Screen>
      );

    case 'done':
      return (
        <Screen footer={<Button label="Done" onPress={() => router.replace('/')} />}>
          <Display>Starting point saved</Display>
          <Body>This is where you are today. Lessons show change from here, never a pass or fail.</Body>
          <SummaryCards summary={phase.summary} />
        </Screen>
      );
  }
}

/** The sound to make, the sentences to read or the ideas to talk about. */
function TaskText({ task }: { task: (typeof BASELINE_TASKS)[number] }) {
  const s = useStyles();
  if (!task.say) return null;
  if (task.kind === 'vowel' || task.kind === 'glide') {
    return (
      <Card>
        <Text style={s.bigSay} accessibilityLabel={task.title}>
          {task.say[0]}
        </Text>
      </Card>
    );
  }
  return (
    <Card>
      {task.id === 'reading'
        ? task.say.map((line) => (
            <Text key={line} style={s.readLine}>
              {line}
            </Text>
          ))
        : task.say.map((line) => <Bullet key={line}>{line}</Bullet>)}
    </Card>
  );
}

/** Time left and a level meter. Levels are relative; no pitch is shown. */
function RecordingStatus({ startedAt, limitS }: { startedAt: number; limitS: number }) {
  const s = useStyles();
  const { c } = useTheme();
  const [now, setNow] = useState(Date.now());
  const [level, setLevel] = useState({ db: -90, voiced: false });
  const last = useRef(0);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 200);
    const sub = NewVoiceAudio.addListener('onFrames', (e: FramesEvent) => {
      const t = Date.now();
      if (t - last.current < 100 || e.frames.length === 0) return;
      last.current = t;
      const f = e.frames[e.frames.length - 1];
      setLevel({ db: f.levelDbfs, voiced: e.frames.some((x) => x.voiced) });
    });
    return () => {
      clearInterval(id);
      sub.remove();
    };
  }, []);

  const left = Math.max(0, Math.ceil(limitS - (now - startedAt) / 1000));
  // −60 dBFS (silence) to −10 dBFS (loud) fills the bar.
  const fill = Math.min(1, Math.max(0, (level.db + 60) / 50));
  return (
    <View style={s.status} accessibilityLiveRegion="polite">
      <Text style={s.readout}>{left} s</Text>
      <View style={s.meter} accessible accessibilityLabel={level.voiced ? 'Hearing your voice' : 'Listening'}>
        <View style={[s.meterFill, { width: `${fill * 100}%`, backgroundColor: level.voiced ? c.zone : c.lineControl }]} />
      </View>
      <Caption>{level.voiced ? 'Hearing your voice' : 'Listening…'}</Caption>
    </View>
  );
}

function SummaryCards({ summary }: { summary: BaselineSummary }) {
  const s = useStyles();
  const { speaking, comfortableRange: range, vowels } = summary;
  return (
    <>
      {speaking ? (
        <Card>
          <Overline>Everyday speaking pitch</Overline>
          <Text style={s.readout}>{formatHz(speaking.medianHz)}</Text>
          <Caption>
            Around {noteName(speaking.medianSt)}. Most of your speech sits between {formatHz(stToHz(speaking.p10St))}{' '}
            and {formatHz(stToHz(speaking.p90St))}.
          </Caption>
        </Card>
      ) : null}
      {range ? (
        <Card>
          <Overline>Comfortable range</Overline>
          <Text style={s.readout}>
            {Math.round(stToHz(range.lowSt))}–{formatHz(stToHz(range.highSt))}
          </Text>
          <Caption>
            About {Math.round(range.spanSt)} semitones. Exercises won’t reward going above about{' '}
            {formatHz(stToHz(range.ceilingSt))}, near the top of your easy range.
          </Caption>
        </Card>
      ) : null}
      <Card>
        <Overline>Brightness and weight</Overline>
        <Body>Measured from your vowels and your reading. Lessons will show how these change from here.</Body>
      </Card>
      <Heading>Measurements</Heading>
      <Card>
        {(
          [
            ['“ah”', vowels.a],
            ['“ee”', vowels.i],
            ['“oo”', vowels.u],
          ] as const
        ).map(([label, v]) => (
          <Text key={label} style={s.mono}>
            {label}  F1 {v?.f1Hz ? Math.round(v.f1Hz) : '–'}  F2 {v?.f2Hz ? Math.round(v.f2Hz) : '–'}  F3{' '}
            {v?.f3Hz ? Math.round(v.f3Hz) : '–'} Hz
          </Text>
        ))}
        <Caption>Formants: the resonances of your mouth and throat for each vowel.</Caption>
      </Card>
      {summary.reducedAccuracy ? (
        <Body muted>
          Some recordings went through Bluetooth or the phone’s sound processing, so they may be less accurate. You can
          record your starting point again from Home.
        </Body>
      ) : null}
    </>
  );
}

function useStyles() {
  const { c } = useTheme();
  return useMemo(() => makeStyles(c), [c]);
}

function makeStyles(c: Colors) {
  return StyleSheet.create({
    dotsRow: { alignItems: 'flex-start', marginBottom: space[4] },
    bigSay: { ...type.display, fontSize: 56, lineHeight: 64, color: c.ink, textAlign: 'center', paddingVertical: space[4] },
    readLine: { ...type.body, fontSize: 20, lineHeight: 30, color: c.ink, marginBottom: space[2] },
    status: { marginTop: space[2], gap: space[2] },
    readout: { ...type.readout, color: c.ink },
    mono: { ...type.readoutSm, color: c.ink, marginBottom: space[1] },
    meter: { height: 12, borderRadius: radius.pill, backgroundColor: c.surface300, overflow: 'hidden' },
    meterFill: { height: '100%', borderRadius: radius.pill },
  });
}
