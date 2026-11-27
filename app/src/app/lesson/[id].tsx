import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import NewVoiceAudio from '../../../modules/newvoice-audio/src/NewVoiceAudioModule';
import { feedbackBaselineFrom, isBaselineSummary, type BaselineSummary } from '../../baseline/plan';
import { currentBaseline } from '../../baseline/store';
import { CURRICULUM } from '../../curriculum/content';
import type { Outcome } from '../../curriculum/criteria';
import { findLesson, lessonOpen, progress, unitComplete } from '../../curriculum/progress';
import { usesVoice, type Exercise } from '../../curriculum/types';
import type { Baseline, UtteranceSummary } from '../../feedback/types';
import { EffortPicker, RestPrompt } from '../../feedback/views/RestPrompt';
import type { StrainReason } from '../../feedback/strain';
import { pitchZone } from '../../feedback/zones';
import { currentMastery } from '../../learning/hlr';
import { practiceOrder, showWhy } from '../../learning/practice';
import { ExerciseView, SovtView, type ExerciseCtx } from '../../lesson/exercises';
import { currentSession, strainMonitor } from '../../lesson/sessionState';
import {
  addJournal,
  dayState,
  getSkill,
  latestEvidence,
  lessonSkill,
  loadAttempts,
  recentPassed,
  recordLessonRun,
  reportSymptoms,
  saveAttempt,
  startSession,
  symptomHistory,
  toRecord,
  unitSkill,
  updateSession,
} from '../../lesson/store';
import { BLOCK_TEXT } from '../../safety/copy';
import { CheckIn, HardStop, StopButton } from '../../safety/SafetyViews';
import { needsCooldown, referral, voicedBlock, type Block, type Referral, type Symptom } from '../../safety/rules';
import { useApp, useDb } from '../../state/AppState';
import { Body, Button, Caption, Card, Heading, Screen, StepDots, Title } from '../../ui/kit';

// Runs one lesson (Stage 5): the day's voice check-in, the warm-up, the
// exercises, the strain monitor's rest prompts, the stop button, and the
// cool-down, with the session and daily limits enforced throughout (§2.4).

type Phase =
  | { kind: 'loading' }
  | { kind: 'locked' }
  | { kind: 'checkin' }
  | { kind: 'warmup'; then: number }
  | { kind: 'exercise'; index: number }
  | { kind: 'result'; index: number; outcome: Outcome }
  | { kind: 'cooldown'; reason: Block | 'end' }
  | { kind: 'blocked'; block: Block }
  | { kind: 'hard-stop'; referral: Referral }
  | { kind: 'done'; unitDone: boolean; summary: string };

export default function LessonScreen() {
  const { id, refresher } = useLocalSearchParams<{ id: string; refresher?: string }>();
  const isRefresher = refresher === '1';
  const db = useDb();
  const { user } = useApp();
  const found = findLesson(CURRICULUM, id);
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [summary, setSummary] = useState<BaselineSummary | null>(null);
  const [baseline, setBaseline] = useState<Baseline | null>(null);
  const [level, setLevel] = useState(0);
  const [mastery, setMastery] = useState(0);
  const [acquired, setAcquired] = useState(false);
  const [reasons, setReasons] = useState<StrainReason[]>([]);
  const [effort, setEffort] = useState<number | null>(null);
  // Remounts the exercise for a retry or after a rest.
  const [nonce, setNonce] = useState(0);
  const outcomes = useRef<{ exercise: Exercise; outcome: Outcome }[]>([]);
  const seed = useMemo(() => Math.floor(Date.now() / 1000), []);

  const exercises = useMemo(() => {
    if (!found) return [];
    let list = found.lesson.exercises;
    // Quiet mode skips loud exercises (§4.3); they never gate a unit (validate.ts).
    if (user?.quietMode) list = list.filter((e) => e.volume !== 'loud');
    // A refresher re-runs the measured exercises in random order (§2.5).
    if (isRefresher) {
      const scored = list.filter((e) => e.pass.kind !== 'completion' && e.type !== 'info');
      list = practiceOrder(scored.length ? scored : list.filter((e) => e.type !== 'info'), true, seed);
    }
    return list;
  }, [found, user?.quietMode, isRefresher, seed]);

  // Load the starting point, skill state and whether the lesson is open.
  useEffect(() => {
    if (!found) return;
    void (async () => {
      const row = await currentBaseline(db, user?.baselineId);
      const s = row && isBaselineSummary(row.summary) ? row.summary : null;
      setSummary(s);
      setBaseline(row ? feedbackBaselineFrom(row.summary) : null);
      const [lessonState, unitState, attempts] = await Promise.all([
        getSkill(db, lessonSkill(found.lesson.id)),
        getSkill(db, unitSkill(found.unit.id)),
        loadAttempts(db),
      ]);
      setLevel(unitState.level);
      setMastery(currentMastery(lessonState.mastery, lessonState.memory, Date.now()));
      setAcquired(lessonState.memory.successes > 0);
      const p = progress(CURRICULUM, user?.track ?? 'default', attempts.map(toRecord), { baselineStored: user?.baselineId != null });
      if (!lessonOpen(p, found.lesson.id)) return setPhase({ kind: 'locked' });
      const day = await dayState(db);
      const voiced = exercises.some(usesVoice);
      if (day.hardStopToday && voiced) return setPhase({ kind: 'hard-stop', referral: referral(await symptomHistory(db), Date.now()) });
      if (voiced && !day.checkedInToday) return setPhase({ kind: 'checkin' });
      setPhase({ kind: 'exercise', index: 0 });
    })();
  }, [db, found, user?.baselineId, user?.track, exercises]);

  // Leaving the lesson stops the microphone.
  useEffect(() => () => void NewVoiceAudio.stop().catch(() => {}), []);

  const session = useCallback(async () => {
    const s = currentSession();
    if (s.sessionId == null) s.sessionId = await startSession(db, 'lesson');
    return s;
  }, [db]);

  const persistSession = useCallback(async () => {
    const s = currentSession();
    if (s.sessionId == null) return;
    await updateSession(db, s.sessionId, {
      voicedS: s.voicedMinutes * 60,
      warmupDone: s.warmupAt != null,
      cooldownDone: s.cooldownDone,
      listenTrials: s.listenTrials,
      lessonsDone: s.lessonsDone,
    });
  }, [db]);

  /** Decides what comes before exercise `index`: a warm-up, a limit, or the exercise itself. */
  const goTo = useCallback(
    async (index: number) => {
      if (index >= exercises.length) return finishLesson();
      const e = exercises[index];
      if (usesVoice(e)) {
        const s = await session();
        const day = await dayState(db);
        const block = voicedBlock('practice', s, day, Date.now());
        if (block === 'warmup-needed') return setPhase({ kind: 'warmup', then: index });
        if (block === 'hard-stop') return setPhase({ kind: 'hard-stop', referral: referral(await symptomHistory(db), Date.now()) });
        if (block) return setPhase(needsCooldown(s) ? { kind: 'cooldown', reason: block } : { kind: 'blocked', block });
      }
      setPhase({ kind: 'exercise', index });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [exercises, db, session],
  );

  const finishLesson = async () => {
    if (!found) return;
    const s = currentSession();
    if (needsCooldown(s)) return setPhase({ kind: 'cooldown', reason: 'end' });
    const scored = outcomes.current.filter((o) => o.exercise.pass.kind !== 'completion');
    const performance = scored.length ? scored.reduce((x, o) => x + o.outcome.performance, 0) / scored.length : 1;
    const passed = outcomes.current.every((o) => o.outcome.passed);
    const unitScoredIds = found.unit.lessons.flatMap((l) => l.exercises).filter((e) => e.pass.kind !== 'completion').map((e) => e.id);
    await recordLessonRun(db, found.lesson.id, found.unit.id, performance, passed, await recentPassed(db, unitScoredIds));
    s.lessonsDone += 1;
    await session();
    await persistSession();
    const attempts = (await loadAttempts(db)).map(toRecord);
    const unitDone = unitComplete(found.unit, attempts, { baselineStored: user?.baselineId != null });
    setPhase({ kind: 'done', unitDone, summary: passed ? 'Lesson complete.' : 'Lesson finished. Some parts are worth another try another day.' });
  };

  const onExerciseDone = async (index: number, outcome: Outcome, evidence?: unknown) => {
    if (!found) return;
    const e = exercises[index];
    const s = await session();
    await saveAttempt(db, { sessionId: s.sessionId, lessonId: found.lesson.id, exerciseId: e.id, refresher: isRefresher, outcome, evidence });
    outcomes.current.push({ exercise: e, outcome });
    await persistSession();
    if (e.type === 'info' || e.type === 'journal') return goTo(index + 1);
    setEffort(null);
    setPhase({ kind: 'result', index, outcome });
  };

  const onUtterance = useCallback(
    (u: UtteranceSummary) => {
      const found = strainMonitor(baseline?.comfortableP90St ?? null).addUtterance(u);
      if (found.length) {
        void NewVoiceAudio.stop().catch(() => {});
        setReasons((r) => [...new Set([...r, ...found])]);
      }
    },
    [baseline],
  );

  const stopForSymptoms = async (symptoms: Symptom[]) => {
    await NewVoiceAudio.stop().catch(() => {});
    await reportSymptoms(db, symptoms);
    await persistSession();
    setPhase({ kind: 'hard-stop', referral: referral(await symptomHistory(db), Date.now()) });
  };

  const ctx: ExerciseCtx | null = useMemo(() => {
    const zone = baseline ? pitchZone(baseline, user?.goal ?? null, level) : null;
    return {
      baseline,
      goal: user?.goal ?? null,
      level,
      mastery,
      acquired,
      pitchZone: zone,
      weightBaseline: summary?.weightBaseline ?? null,
      formantCeilingHz: summary?.formantCeilingHz ?? null,
      baselineStored: user?.baselineId != null,
      seed,
      onUtterance,
      addVoicedSeconds: (sec) => {
        const s = currentSession();
        s.voicedMinutes += sec / 60;
      },
      addListenTrials: (n) => {
        currentSession().listenTrials += n;
      },
      evidenceOf: (exerciseId) => latestEvidence(db, exerciseId),
      saveJournal: (text, prompt) => addJournal(db, { text, prompt, lessonId: found?.lesson.id ?? null }),
    };
  }, [baseline, user, level, mastery, acquired, summary, seed, onUtterance, db, found]);

  if (!found) {
    return (
      <Screen>
        <Body>That lesson doesn’t exist.</Body>
      </Screen>
    );
  }

  const exitHome = () => router.replace('/');
  const current = phase.kind === 'exercise' || phase.kind === 'result' ? exercises[phase.index] : null;
  const voiced = current != null && usesVoice(current);

  let body: React.ReactNode = null;
  switch (phase.kind) {
    case 'loading':
      body = <Caption>Loading…</Caption>;
      break;
    case 'locked':
      body = (
        <>
          <Title>Not open yet</Title>
          <Body>Finish the lessons before this one first.</Body>
          <Button label="Back" onPress={exitHome} />
        </>
      );
      break;
    case 'checkin':
      body = (
        <CheckIn
          onDone={async (symptoms) => {
            await reportSymptoms(db, symptoms);
            if (symptoms.length) return setPhase({ kind: 'hard-stop', referral: referral(await symptomHistory(db), Date.now()) });
            void goTo(0);
          }}
        />
      );
      break;
    case 'warmup':
      body = (
        <SovtView
          exercise={CURRICULUM.warmup}
          ctx={ctx!}
          onDone={async () => {
            currentSession().warmupAt = Date.now();
            await persistSession();
            setPhase({ kind: 'exercise', index: phase.then });
          }}
        />
      );
      break;
    case 'cooldown':
      body = (
        <>
          {phase.reason !== 'end' ? (
            <Card>
              <Heading>{BLOCK_TEXT[phase.reason].title}</Heading>
              <Body>{BLOCK_TEXT[phase.reason].body}</Body>
            </Card>
          ) : null}
          <SovtView
            exercise={CURRICULUM.cooldown}
            ctx={ctx!}
            onDone={async () => {
              currentSession().cooldownDone = true;
              await persistSession();
              if (phase.reason === 'end') void finishLesson();
              else setPhase({ kind: 'blocked', block: phase.reason });
            }}
          />
        </>
      );
      break;
    case 'blocked':
      body = (
        <>
          <Title>{BLOCK_TEXT[phase.block].title}</Title>
          <Body>{BLOCK_TEXT[phase.block].body}</Body>
          <Button label="Back to home" onPress={exitHome} />
        </>
      );
      break;
    case 'hard-stop':
      body = <HardStop referral={phase.referral} onClose={exitHome} />;
      break;
    case 'exercise':
      body = <ExerciseView key={`${phase.index}-${nonce}`} exercise={exercises[phase.index]} ctx={ctx!} onDone={(o, ev) => void onExerciseDone(phase.index, o, ev)} />;
      break;
    case 'result': {
      const e = exercises[phase.index];
      const scored = e.pass.kind !== 'completion';
      // Knowledge of performance early, knowledge of results later (§2.5); checkpoints always explain.
      const why = scored && (showWhy(mastery) || found.lesson.checkpoint || !phase.outcome.passed);
      body = (
        <>
          <Title>{scored ? (phase.outcome.passed ? 'Done' : 'Not yet') : 'Done'}</Title>
          {why || !scored ? <Body>{phase.outcome.why}</Body> : null}
          {usesVoice(e) ? (
            <EffortPicker
              value={effort}
              onPick={(n) => {
                setEffort(n);
                const found = strainMonitor(baseline?.comfortableP90St ?? null).reportEffort(n);
                if (found.length) setReasons((r) => [...new Set([...r, ...found])]);
              }}
            />
          ) : null}
          {scored && !phase.outcome.passed ? <Button
              label="Try again"
              kind="secondary"
              onPress={() => {
                setNonce((n) => n + 1);
                setPhase({ kind: 'exercise', index: phase.index });
              }}
            /> : null}
          <Button label="Continue" onPress={() => void goTo(phase.index + 1)} />
        </>
      );
      break;
    }
    case 'done':
      body = (
        <>
          <Title>{phase.unitDone && found.lesson.checkpoint ? `${found.unit.title}: unit complete` : found.lesson.title}</Title>
          <Body>{phase.summary}</Body>
          {phase.unitDone && found.lesson.checkpoint ? <Body>The next unit is open.</Body> : null}
          <Button label="Back to home" onPress={exitHome} />
        </>
      );
      break;
  }

  const step = phase.kind === 'exercise' || phase.kind === 'result' ? phase.index : phase.kind === 'done' ? exercises.length : 0;
  return (
    <>
      <Screen footer={voiced && phase.kind === 'exercise' ? <StopButton onStop={(s) => void stopForSymptoms(s)} /> : undefined}>
        <Caption>
          {found.unit.number}. {found.unit.title} · {found.lesson.title}
          {isRefresher ? ' · refresher' : ''}
        </Caption>
        {exercises.length > 1 ? <StepDots count={exercises.length} current={Math.min(step, exercises.length - 1)} /> : null}
        {body}
      </Screen>
      <RestPrompt
        reasons={reasons}
        onRested={() => {
          strainMonitor(baseline?.comfortableP90St ?? null).acknowledgeRest();
          setReasons([]);
          // Go back to the start of the interrupted exercise.
          if (phase.kind === 'exercise') setNonce((n) => n + 1);
        }}
      />
    </>
  );
}
