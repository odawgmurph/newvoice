import { router } from 'expo-router';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { WeightBaseline } from '../../modules/newvoice-audio/src/NewVoiceAudio.types';
import {
  completed,
  evaluateFreeSpeech,
  evaluateInZone,
  evaluatePitchMatch,
  evaluateResonanceVowels,
  evaluateSelfRated,
  evaluateStaircase,
  evaluateStRange,
  evaluateWeightLighter,
  evaluateWhisperRise,
  longestMatchMs,
  median,
  resonanceTarget,
  zoneShares,
  type Outcome,
  type PitchMatchItem,
} from '../curriculum/criteria';
import { pitchTargets } from '../curriculum/items';
import type * as C from '../curriculum/types';
import { answer, difference, startStaircase } from '../eartraining/staircase';
import { makeTrial, renderPromptTone, renderTrial } from '../eartraining/synth';
import { pitchAxis } from '../feedback/geometry';
import type { Baseline, Goal, UtteranceSummary } from '../feedback/types';
import { PitchTrace } from '../feedback/views/PitchTrace';
import { f2Zone, GOAL_RESONANCE_POSITION, stToHz, type PitchZone } from '../feedback/zones';
import { feedbackMode, practiceOrder } from '../learning/practice';
import { Body, Button, Caption, Card, ErrorText, Field, Heading, Title } from '../ui/kit';
import { radius, space, type, useTheme } from '../ui/theme';
import { freeSpeech, HOP_S, melodyUtterances, pitchTrack, vowelScore, weightEvidence, whisperF2, zoneFrames } from './evidence';
import { play, stopPlayback } from './playback';
import { useVoice } from './useVoice';

// One renderer per exercise type (Stage 5). Each measures what its
// criterion needs, then calls `onDone(outcome, evidence)`. Evidence holds
// numbers only; audio never reaches JavaScript (D1).

export type ExerciseCtx = {
  baseline: Baseline | null;
  goal: Goal | null;
  level: number;
  /** Decayed mastery of this lesson's skill: drives feedback fading (§2.5). */
  mastery: number;
  /** The lesson has been passed before: items run in random order (§2.5). */
  acquired: boolean;
  pitchZone: PitchZone | null;
  weightBaseline: WeightBaseline | null;
  formantCeilingHz: number | null;
  baselineStored: boolean;
  seed: number;
  onUtterance: (u: UtteranceSummary) => void;
  addVoicedSeconds: (s: number) => void;
  addListenTrials: (n: number) => void;
  /** Evidence of the latest attempt at an exercise (references). */
  evidenceOf: <T>(exerciseId: string) => Promise<T | null>;
  /** Journal saving. */
  saveJournal: (text: string, prompt: string) => Promise<void>;
};

export type ExerciseProps<E extends C.Exercise = C.Exercise> = {
  exercise: E;
  ctx: ExerciseCtx;
  onDone: (outcome: Outcome, evidence?: unknown) => void;
};

export function ExerciseView(p: ExerciseProps) {
  const e = p.exercise;
  switch (e.type) {
    case 'info':
      return <InfoView {...p} exercise={e} />;
    case 'listen':
      return <ListenView {...p} exercise={e} />;
    case 'match-pitch':
      return <MatchPitchView {...p} exercise={e} />;
    case 'glide':
      return <GlideView {...p} exercise={e} />;
    case 'hold':
      return <HoldView {...p} exercise={e} />;
    case 'whisper':
      return <WhisperView {...p} exercise={e} />;
    case 'vowel-ladder':
      return <LadderView {...p} exercise={e} />;
    case 'read':
      return <ReadView {...p} exercise={e} />;
    case 'free-speech':
      return <FreeSpeechView {...p} exercise={e} />;
    case 'self-rate':
      return <SelfRateView {...p} exercise={e} />;
    case 'mission':
      return <MissionView {...p} exercise={e} />;
    case 'journal':
      return <JournalView {...p} exercise={e} />;
    case 'sovt':
      return <SovtView {...p} exercise={e} />;
  }
}

// ——— Shared pieces ———

function Prompt({ e }: { e: C.Exercise }) {
  return (
    <>
      <Title>{e.title}</Title>
      {e.prompt ? <Body>{e.prompt}</Body> : null}
    </>
  );
}

function NeedsBaseline() {
  return (
    <Card>
      <Body>This exercise measures against your starting point, which isn’t recorded yet.</Body>
      <Button label="Record your starting point" onPress={() => router.push('/baseline')} />
    </Card>
  );
}

function BigText({ children }: { children: ReactNode }) {
  const { c } = useTheme();
  return <Text style={[type.title, styles.big, { color: c.ink }]}>{children}</Text>;
}

function Pills({ n, value, onPick, label }: { n: number; value: number | null; onPick: (i: number) => void; label: (i: number) => string }) {
  const { c } = useTheme();
  return (
    <View style={styles.pills} accessibilityRole="radiogroup">
      {Array.from({ length: n }, (_, i) => (
        <Pressable
          key={i}
          accessibilityRole="radio"
          accessibilityLabel={label(i)}
          accessibilityState={{ selected: value === i }}
          onPress={() => onPick(i)}
          style={[styles.pill, { borderColor: value === i ? c.brand : c.line, backgroundColor: value === i ? c.brandTint : c.surface200 }]}
        >
          <Text style={[type.readoutSm, { color: c.ink }]}>{i}</Text>
        </Pressable>
      ))}
    </View>
  );
}

/** Live pitch view; hidden in summary mode (feedback fading, §2.5). */
function LivePitch({ voice, zone, live, extra }: { voice: ReturnType<typeof useVoice>; zone: PitchZone | null; live: boolean; extra?: number[] }) {
  const axis = useMemo(() => pitchAxis(zone ? [zone.lo, zone.hi, zone.comfortableP90St, ...(extra ?? [])] : extra ?? []), [zone, extra]);
  if (!live) return <Caption>{voice.running ? 'Listening. Feedback comes at the end.' : ' '}</Caption>;
  return <PitchTrace points={voice.trace} tEnd={voice.now} axis={axis} zone={zone} />;
}

function F2Readout({ hz, target, label = 'Brightness (F2)' }: { hz: number | null; target: { lo: number; hi: number } | null; label?: string }) {
  const { c } = useTheme();
  const inZone = hz != null && target != null && hz >= target.lo && hz <= target.hi;
  return (
    <View style={[styles.readout, { borderColor: inZone ? c.zone : c.line, backgroundColor: inZone ? c.zoneTint : c.surface200 }]}>
      <Text style={[type.label, { color: c.inkMuted }]}>{label}</Text>
      <Text style={[type.readout, { color: c.ink }]}>{hz != null ? `${Math.round(hz)} Hz` : '—'}</Text>
      {target ? <Text style={[type.caption, { color: c.inkMuted }]}>Band {Math.round(target.lo)}–{Math.round(target.hi)} Hz</Text> : null}
    </View>
  );
}

const outcomeFor = (pass: C.Criterion, evaluate: () => Outcome): Outcome => (pass.kind === 'completion' ? completed() : evaluate());

// ——— Info ———

function InfoView({ exercise: e, ctx, onDone }: ExerciseProps<C.InfoExercise>) {
  const needsBaseline = e.pass.kind === 'baseline-stored';
  return (
    <>
      <Title>{e.title}</Title>
      {e.body.map((p) => (
        <Body key={p}>{p}</Body>
      ))}
      {needsBaseline && !ctx.baselineStored ? (
        <Button label="Record your starting point" onPress={() => router.push('/baseline')} />
      ) : null}
      <Button
        label="Continue"
        kind={needsBaseline && !ctx.baselineStored ? 'secondary' : 'primary'}
        onPress={() =>
          onDone(needsBaseline ? { passed: ctx.baselineStored, value: null, performance: ctx.baselineStored ? 1 : 0, why: ctx.baselineStored ? 'Starting point stored.' : 'No starting point yet.' } : completed())
        }
      />
    </>
  );
}

// ——— Warm-up / cool-down ———

export function SovtView({ exercise: e, ctx, onDone }: ExerciseProps<C.SovtExercise>) {
  const [step, setStep] = useState(0);
  const [left, setLeft] = useState<number | null>(null);
  const s = e.steps[step];
  useEffect(() => {
    if (left == null || left <= 0) return;
    const t = setTimeout(() => setLeft((l) => (l == null ? l : l - 1)), 1000);
    return () => clearTimeout(t);
  }, [left]);
  const finished = left === 0;
  const next = () => {
    ctx.addVoicedSeconds(s.seconds);
    if (step + 1 < e.steps.length) {
      setStep(step + 1);
      setLeft(null);
    } else onDone(completed());
  };
  return (
    <>
      <Prompt e={e} />
      <Caption>
        Step {step + 1} of {e.steps.length}
      </Caption>
      <Card>
        <Heading>{s.label}</Heading>
        <Body>{s.how}</Body>
        <BigText>{left == null ? `${s.seconds} s` : `${left} s`}</BigText>
      </Card>
      {left == null ? (
        <Button label="Start" onPress={() => setLeft(s.seconds)} />
      ) : (
        <Button label={step + 1 < e.steps.length ? 'Next step' : 'Done'} disabled={!finished} onPress={next} />
      )}
    </>
  );
}

// ——— Ear training ———

const LISTEN_QUESTION: Record<C.EarDimension, { ab: string; word: string }> = {
  pitch: { ab: 'Which was higher?', word: 'higher' },
  brightness: { ab: 'Which was brighter?', word: 'brighter' },
  weight: { ab: 'Which was lighter?', word: 'lighter' },
};

function ListenView({ exercise: e, ctx, onDone }: ExerciseProps<C.ListenExercise>) {
  const [stair, setStair] = useState(() => startStaircase(e.level));
  const [i, setI] = useState(0);
  const [played, setPlayed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState<boolean | null>(null);
  const trial = useMemo(() => makeTrial(e.dimension, e.format, difference(e.dimension, stair.level), ctx.seed * 1000 + i), [e, stair.level, ctx.seed, i]);
  useEffect(() => () => stopPlayback(), []);

  const listen = async () => {
    setBusy(true);
    await play(renderTrial(trial)).catch(() => {});
    setBusy(false);
    setPlayed(true);
  };
  const pick = (k: number) => {
    const correct = k === trial.answer;
    setLast(correct);
    setStair((s) => answer(s, correct));
  };
  const next = () => {
    if (i + 1 >= e.trials) {
      ctx.addListenTrials(e.trials);
      const all = stair.trials;
      onDone(e.pass.kind === 'staircase' ? evaluateStaircase(e.pass, all) : { ...completed(), why: `${all.filter((t) => t.correct).length} of ${all.length} right.` }, { trials: all });
      return;
    }
    setI(i + 1);
    setPlayed(false);
    setLast(null);
  };
  const choices = e.format === 'ab' ? ['First', 'Second'] : ['1', '2', '3'];
  return (
    <>
      <Prompt e={e} />
      <Caption>
        {i + 1} of {e.trials}
      </Caption>
      <Button label={busy ? 'Playing…' : played ? 'Play again' : 'Play'} disabled={busy} onPress={() => void listen()} />
      {played && last == null ? (
        <>
          <Heading>{e.format === 'ab' ? LISTEN_QUESTION[e.dimension].ab : `Which one was different?`}</Heading>
          <View style={styles.row}>
            {choices.map((label, k) => (
              <View key={label} style={styles.flex}>
                <Button label={label} kind="secondary" onPress={() => pick(k)} />
              </View>
            ))}
          </View>
        </>
      ) : null}
      {last != null ? (
        <Card>
          <Body>{last ? 'Yes, that’s it.' : `Not this time: it was ${choices[trial.answer].toLowerCase()}.`}</Body>
          <Button label={i + 1 >= e.trials ? 'Finish' : 'Next'} onPress={next} />
        </Card>
      ) : null}
    </>
  );
}

// ——— Pitch matching (E1) ———

const ITEM_SECONDS = 4;

function MatchPitchView({ exercise: e, ctx, onDone }: ExerciseProps<C.MatchPitchExercise>) {
  const voice = useVoice(ctx.onUtterance);
  const [i, setI] = useState(0);
  const [items, setItems] = useState<PitchMatchItem[]>([]);
  const [phase, setPhase] = useState<'listen' | 'sing' | 'result'>('listen');
  const zone = ctx.pitchZone;
  const targets = useMemo(
    () => (zone && ctx.baseline ? practiceOrder(pitchTargets(e.offsetsSt, zone, ctx.baseline.comfortableP10St), ctx.acquired, ctx.seed) : []),
    [zone, ctx.baseline, e.offsetsSt, ctx.acquired, ctx.seed],
  );
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
    stopPlayback();
  }, []);
  if (!zone || !ctx.baseline) return <NeedsBaseline />;
  const target = targets[i];
  const tolerance = e.pass.kind === 'pitch-match' ? e.pass.toleranceCents : 50;
  const holdMs = e.pass.kind === 'pitch-match' ? e.pass.holdMs : 600;
  const band: PitchZone = { lo: target - tolerance / 100, hi: target + tolerance / 100, centre: target, comfortableP90St: zone.comfortableP90St };

  const listen = async () => {
    await play(renderPromptTone(stToHz(target), e.tone)).catch(() => {});
  };
  const sing = async () => {
    if (!(await voice.start({ formantCeilingHz: ctx.formantCeilingHz ?? undefined }))) return;
    setPhase('sing');
    timer.current = setTimeout(() => void finishItem(), ITEM_SECONDS * 1000);
  };
  const finishItem = async () => {
    if (timer.current) clearTimeout(timer.current);
    const cap = await voice.stop();
    ctx.addVoicedSeconds(cap.seconds);
    const ms = longestMatchMs(pitchTrack(cap.frames), HOP_S, target, tolerance, zone.comfortableP90St);
    setItems((xs) => [...xs, { targetSt: target, holdMs: ms }]);
    setPhase('result');
  };
  const next = () => {
    if (i + 1 >= targets.length) {
      const all = items;
      onDone(outcomeFor(e.pass, () => evaluatePitchMatch(e.pass as Extract<C.Criterion, { kind: 'pitch-match' }>, all)), { items: all });
      return;
    }
    setI(i + 1);
    setPhase('listen');
  };
  const lastItem = items[items.length - 1];
  const live = feedbackMode(ctx.mastery, i) === 'live';
  return (
    <>
      <Prompt e={e} />
      <Caption>
        Note {i + 1} of {targets.length} · {Math.round(stToHz(target))} Hz
      </Caption>
      {phase !== 'result' ? <Button label="Play the note" kind="secondary" onPress={() => void listen()} /> : null}
      {phase === 'listen' ? <Button label={`${e.sound === 'mm' ? 'Hum' : 'Say'} it`} onPress={() => void sing()} /> : null}
      {phase === 'sing' ? (
        <>
          <LivePitch voice={voice} zone={band} live={live} />
          <Button label="Done" kind="secondary" onPress={() => void finishItem()} />
        </>
      ) : null}
      {phase === 'result' && lastItem ? (
        <Card>
          <Body>
            {lastItem.holdMs >= holdMs ? `Held for ${(lastItem.holdMs / 1000).toFixed(1)} s. ` : 'Not quite held this time. '}
          </Body>
          <Button label={i + 1 >= targets.length ? 'Finish' : 'Next note'} onPress={next} />
        </Card>
      ) : null}
      {voice.error ? <ErrorText>{voice.error}</ErrorText> : null}
    </>
  );
}

// ——— Glides (E2, E4, E5) ———

function GlideView({ exercise: e, ctx, onDone }: ExerciseProps<C.GlideExercise>) {
  const voice = useVoice(ctx.onUtterance);
  const [rep, setRep] = useState(0);
  const zone = ctx.pitchZone;
  const toggle = async () => {
    if (voice.running) {
      const cap = await voice.stop();
      ctx.addVoicedSeconds(cap.seconds);
      setRep((r) => r + 1);
    } else await voice.start({ formantCeilingHz: ctx.formantCeilingHz ?? undefined });
  };
  const arrow = e.direction === 'up' ? '↗' : e.direction === 'down' ? '↘' : '↗ ↘';
  return (
    <>
      <Prompt e={e} />
      <BigText>
        “{e.sound}” {arrow}
      </BigText>
      <Caption>
        Slide {Math.min(rep + 1, e.reps)} of {e.reps}
        {zone ? '. The dashed line is the top of your comfortable range; stay under it.' : ''}
      </Caption>
      <LivePitch voice={voice} zone={zone} live />
      {rep < e.reps ? (
        <Button label={voice.running ? 'Stop slide' : 'Start slide'} kind={voice.running ? 'secondary' : 'primary'} onPress={() => void toggle()} />
      ) : (
        <Button label="Done" onPress={() => onDone(completed())} />
      )}
      {voice.error ? <ErrorText>{voice.error}</ErrorText> : null}
    </>
  );
}

// ——— Hold the zones (E3, E9, E14) ———

function HoldView({ exercise: e, ctx, onDone }: ExerciseProps<C.HoldExercise>) {
  const voice = useVoice(ctx.onUtterance);
  const [i, setI] = useState(-1);
  const items = useMemo(() => practiceOrder(e.items, ctx.acquired, ctx.seed), [e.items, ctx.acquired, ctx.seed]);
  const zone = e.zones.includes('pitch') ? ctx.pitchZone : null;
  const fz = e.vowel && ctx.baseline ? f2Zone(ctx.baseline, ctx.goal, e.vowel, ctx.level) : null;
  if (!ctx.baseline) return <NeedsBaseline />;
  const live = feedbackMode(ctx.mastery, 0) === 'live';

  const start = async () => {
    const ok = await voice.start({
      vowel: e.vowel,
      weightBaseline: e.pass.kind === 'weight-lighter' ? ctx.weightBaseline ?? undefined : undefined,
      formantCeilingHz: ctx.formantCeilingHz ?? undefined,
    });
    if (ok) setI(0);
  };
  const finish = async () => {
    const cap = await voice.stop();
    ctx.addVoicedSeconds(cap.seconds);
    const shares = zoneShares(zoneFrames(cap.frames), HOP_S, ctx.pitchZone, fz);
    const p = e.pass;
    const outcome =
      p.kind === 'in-zone'
        ? evaluateInZone(p, shares)
        : p.kind === 'weight-lighter'
          ? evaluateWeightLighter(p, weightEvidence(cap.utterances, ctx.baseline?.comfortableP90St ?? null))
          : completed(`In your pitch zone ${Math.round((shares.pitch ?? 0) * 100)}% of the time.`);
    onDone(outcome, { pitchShare: shares.pitch, f2Share: shares.f2, voicedS: shares.voicedS });
  };
  return (
    <>
      <Prompt e={e} />
      {i < 0 ? (
        <Button label="Start" onPress={() => void start()} />
      ) : (
        <>
          <Caption>
            {i + 1} of {items.length}
          </Caption>
          <BigText>{items[i]}</BigText>
          {zone ? <LivePitch voice={voice} zone={zone} live={live} /> : null}
          {fz && live ? <F2Readout hz={voice.readout?.f2Visibility === 'hidden' ? null : voice.readout?.f2Hz ?? null} target={fz} /> : null}
          <Button label={i + 1 < items.length ? 'Next' : 'Finish'} onPress={() => (i + 1 < items.length ? setI(i + 1) : void finish())} />
        </>
      )}
      {voice.error ? <ErrorText>{voice.error}</ErrorText> : null}
    </>
  );
}

// ——— Whisper (E6, E7) ———

type WhisperEvidence = { f2Hz: number | null };

function WhisperView({ exercise: e, ctx, onDone }: ExerciseProps<C.WhisperExercise>) {
  const voice = useVoice(ctx.onUtterance);
  const [left, setLeft] = useState<number | null>(null);
  const [reference, setReference] = useState<number | null>(null);
  const [retry, setRetry] = useState<string | null>(null);
  useEffect(() => {
    if (e.condition !== 'target') return;
    void ctx.evidenceOf<WhisperEvidence>('u4-neutral').then((ev) => setReference(ev?.f2Hz ?? null));
  }, [ctx, e.condition]);
  useEffect(() => {
    if (left == null) return;
    if (left <= 0) {
      void finish();
      return;
    }
    const t = setTimeout(() => setLeft((l) => (l == null ? l : l - 1)), 1000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [left]);
  const start = async () => {
    setRetry(null);
    if (await voice.start({ formantCeilingHz: ctx.formantCeilingHz ?? undefined })) setLeft(e.seconds);
  };
  const finish = async () => {
    setLeft(null);
    const cap = await voice.stop();
    ctx.addVoicedSeconds(cap.seconds);
    const f2 = whisperF2(cap.frames);
    if (f2 == null) {
      setRetry('Too quiet to measure. Try a little closer to the phone, still whispering softly.');
      return;
    }
    const outcome = e.pass.kind === 'whisper-rise' ? evaluateWhisperRise(e.pass, reference, f2) : completed(reference ? `${Math.round((f2 / reference - 1) * 100)}% from your ordinary whisper.` : 'Saved as your reference.');
    onDone(outcome, { f2Hz: f2 } satisfies WhisperEvidence);
  };
  const f2 = voice.readout?.f2Hz ?? null;
  const target = reference ? { lo: reference * 1.08, hi: reference * 1.5 } : null;
  return (
    <>
      <Prompt e={e} />
      <BigText>“{e.sound}” (whispered)</BigText>
      {voice.running ? <F2Readout hz={f2} target={e.condition === 'target' ? target : null} label="Size (F2)" /> : null}
      {left != null ? <Caption>{left} s</Caption> : <Button label="Start whispering" onPress={() => void start()} />}
      {retry ? <ErrorText>{retry}</ErrorText> : null}
      {voice.error ? <ErrorText>{voice.error}</ErrorText> : null}
    </>
  );
}

// ——— Vowel ladder (E9, Unit 5) ———

const RUNG_SECONDS = 3;

function LadderView({ exercise: e, ctx, onDone }: ExerciseProps<C.VowelLadderExercise>) {
  const voice = useVoice(ctx.onUtterance);
  const [i, setI] = useState(0);
  const [scores, setScores] = useState<Record<string, number | null>>({});
  const [busy, setBusy] = useState(false);
  const rung = e.vowels[i];
  if (!ctx.baseline) return <NeedsBaseline />;
  const fz = f2Zone(ctx.baseline, ctx.goal, rung.code, ctx.level);
  const go = async () => {
    setBusy(true);
    if (!(await voice.start({ vowel: rung.code, formantCeilingHz: ctx.formantCeilingHz ?? undefined }))) return setBusy(false);
    await new Promise((r) => setTimeout(r, RUNG_SECONDS * 1000));
    const cap = await voice.stop();
    ctx.addVoicedSeconds(cap.seconds);
    const next = { ...scores, [rung.code]: vowelScore(cap.utterances, cap.frames) };
    setScores(next);
    setBusy(false);
    if (i + 1 < e.vowels.length) setI(i + 1);
    else {
      const target = resonanceTarget(e.pass.kind === 'resonance-vowels' ? e.pass.score : 0.5, ctx.goal ? GOAL_RESONANCE_POSITION[ctx.goal] : null, ctx.baseline?.resonance ?? null);
      onDone(outcomeFor(e.pass, () => evaluateResonanceVowels(e.pass as Extract<C.Criterion, { kind: 'resonance-vowels' }>, next, target)), { scores: next });
    }
  };
  return (
    <>
      <Prompt e={e} />
      <Caption>
        Vowel {i + 1} of {e.vowels.length}
      </Caption>
      <BigText>as in “{rung.word}”</BigText>
      {voice.running ? <F2Readout hz={voice.readout?.f2Visibility === 'hidden' ? null : voice.readout?.f2Hz ?? null} target={fz} /> : null}
      <Button label={busy ? 'Hold it…' : 'Start'} disabled={busy} onPress={() => void go()} />
      {voice.error ? <ErrorText>{voice.error}</ErrorText> : null}
    </>
  );
}

// ——— Read aloud (E15, E16) ———

type ReadEvidence = { rangeSt: number | null; pitchShare: number | null };

function ReadView({ exercise: e, ctx, onDone }: ExerciseProps<C.ReadExercise>) {
  const voice = useVoice(ctx.onUtterance);
  const [i, setI] = useState(-1);
  const starts = useRef<number[]>([]);
  if (!ctx.baseline && e.pass.kind !== 'completion') return <NeedsBaseline />;
  const live = feedbackMode(ctx.mastery, 0) === 'live';
  const start = async () => {
    starts.current = [0];
    if (await voice.start({ formantCeilingHz: ctx.formantCeilingHz ?? undefined })) setI(0);
  };
  const next = () => {
    starts.current.push(voice.now);
    setI(i + 1);
  };
  const finish = async () => {
    const cap = await voice.stop();
    ctx.addVoicedSeconds(cap.seconds);
    const melody = melodyUtterances(cap.utterances, starts.current, e.lines);
    const rangeSt = median(melody.map((m) => m.rangeSt));
    const shares = zoneShares(zoneFrames(cap.frames), HOP_S, ctx.pitchZone, null);
    const p = e.pass;
    let outcome: Outcome;
    if (p.kind === 'in-zone') outcome = evaluateInZone(p, shares);
    else if (p.kind === 'st-range') {
      const ref = await ctx.evidenceOf<ReadEvidence>('u7-reference');
      outcome = evaluateStRange(p, melody, ref?.rangeSt ?? null);
    } else outcome = completed(rangeSt != null && e.focus === 'melody' ? `Median melody range ${rangeSt.toFixed(1)} semitones.` : 'Done.');
    onDone(outcome, { rangeSt, pitchShare: shares.pitch } satisfies ReadEvidence);
  };
  return (
    <>
      <Prompt e={e} />
      {i < 0 ? (
        <Button label="Start" onPress={() => void start()} />
      ) : (
        <>
          <Caption>
            Line {i + 1} of {e.lines.length}
          </Caption>
          <BigText>{e.lines[i]}</BigText>
          {e.focus !== 'melody' || live ? <LivePitch voice={voice} zone={e.focus === 'melody' ? null : ctx.pitchZone} live={live} extra={ctx.baseline ? [ctx.baseline.medianSt] : []} /> : null}
          <Button label={i + 1 < e.lines.length ? 'Next line' : 'Finish'} onPress={() => (i + 1 < e.lines.length ? next() : void finish())} />
        </>
      )}
      {voice.error ? <ErrorText>{voice.error}</ErrorText> : null}
    </>
  );
}

// ——— Free speech (Unit 9) ———

function FreeSpeechView({ exercise: e, ctx, onDone }: ExerciseProps<C.FreeSpeechExercise>) {
  const voice = useVoice(ctx.onUtterance);
  const [left, setLeft] = useState<number | null>(null);
  const prompt = e.prompts[ctx.seed % e.prompts.length];
  useEffect(() => {
    if (left == null) return;
    if (left <= 0) {
      void finish();
      return;
    }
    const t = setTimeout(() => setLeft((l) => (l == null ? l : l - 1)), 1000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [left]);
  const finish = async () => {
    setLeft(null);
    const cap = await voice.stop();
    ctx.addVoicedSeconds(cap.seconds);
    const ev = freeSpeech(cap.frames);
    const outcome = e.pass.kind === 'free-speech-stable' ? evaluateFreeSpeech(e.pass, ev, ctx.pitchZone) : completed(`${Math.round(ev.voicedS)} s of voice.`);
    onDone(outcome, ev);
  };
  const live = feedbackMode(ctx.mastery, 0) === 'live';
  return (
    <>
      <Prompt e={e} />
      <Card>
        <Body>{prompt}</Body>
      </Card>
      {left == null ? (
        <Button label="Start talking" onPress={() => void voice.start({ formantCeilingHz: ctx.formantCeilingHz ?? undefined }).then((ok) => ok && setLeft(e.seconds))} />
      ) : (
        <>
          <BigText>{left} s</BigText>
          <LivePitch voice={voice} zone={ctx.pitchZone} live={live} />
          <Button label="Finish early" kind="secondary" onPress={() => void finish()} />
        </>
      )}
      {voice.error ? <ErrorText>{voice.error}</ErrorText> : null}
    </>
  );
}

// ——— Self-rating (Unit 8, E19) ———

function SelfRateView({ exercise: e, ctx, onDone }: ExerciseProps<C.SelfRateExercise>) {
  const voice = useVoice(ctx.onUtterance);
  const [i, setI] = useState(0);
  const [ratings, setRatings] = useState<number[]>([]);
  const [rating, setRating] = useState<number | null>(null);
  const [captured, setCaptured] = useState<number[]>([]);
  const [pitchFrames, setPitchFrames] = useState<(number | null)[]>([]);
  const toggle = async () => {
    if (voice.running) {
      const cap = await voice.stop();
      ctx.addVoicedSeconds(cap.seconds);
      setPitchFrames((xs) => [...xs, ...pitchTrack(cap.frames)]);
      setCaptured((c) => [...c, i]);
    } else await voice.start({ formantCeilingHz: ctx.formantCeilingHz ?? undefined });
  };
  const next = () => {
    const all = [...ratings, rating ?? 0];
    setRatings(all);
    setRating(null);
    if (i + 1 < e.items.length) {
      setI(i + 1);
      return;
    }
    const shares = zoneShares(pitchFrames.map((st) => ({ st, f2Hz: null, formantConfidence: 0 })), HOP_S, ctx.pitchZone, null);
    const mean = all.reduce((s, x) => s + x, 0) / all.length;
    onDone(
      e.pass.kind === 'self-rated' ? evaluateSelfRated(e.pass, Math.round(mean), shares.pitch) : completed(`Your average rating: ${mean.toFixed(1)}/10.`),
      { ratings: all, pitchShare: shares.pitch },
    );
  };
  return (
    <>
      <Prompt e={e} />
      <Caption>
        {i + 1} of {e.items.length}
      </Caption>
      <BigText>{e.items[i]}</BigText>
      <LivePitch voice={voice} zone={ctx.pitchZone} live={feedbackMode(ctx.mastery, i) === 'live'} />
      {!captured.includes(i) ? (
        <Button label={voice.running ? 'Done' : 'Start'} kind={voice.running ? 'secondary' : 'primary'} onPress={() => void toggle()} />
      ) : (
        <>
          <Caption>{e.question} (0 = not at all, 10 = exactly)</Caption>
          <Pills n={11} value={rating} onPick={setRating} label={(n) => `${n} of 10`} />
          <Button label={i + 1 < e.items.length ? 'Next' : 'Finish'} disabled={rating == null} onPress={next} />
        </>
      )}
      {voice.error ? <ErrorText>{voice.error}</ErrorText> : null}
    </>
  );
}

// ——— Missions (Unit 10) ———

function MissionView({ exercise: e, onDone }: ExerciseProps<C.MissionExercise>) {
  const [pick, setPick] = useState<number | null>(null);
  const [note, setNote] = useState('');
  return (
    <>
      <Prompt e={e} />
      {e.ideas.map((idea, k) => (
        <Pressable key={idea} onPress={() => setPick(k)} accessibilityRole="radio" accessibilityState={{ selected: pick === k }}>
          <Card>
            <Body>{(pick === k ? '● ' : '○ ') + idea}</Body>
          </Card>
        </Pressable>
      ))}
      <Field placeholder="How did it go? (optional, only on this phone)" value={note} onChangeText={setNote} multiline />
      <Button label="I did it" disabled={pick == null} onPress={() => onDone({ passed: true, value: null, performance: 1, why: 'Mission done. However it went, you did it.' }, { idea: e.ideas[pick!], note })} />
      <Button label="Save it for later" kind="secondary" onPress={() => onDone({ passed: false, value: null, performance: 0, why: 'Saved for when you’re ready.' })} />
    </>
  );
}

// ——— Journal ———

function JournalView({ exercise: e, ctx, onDone }: ExerciseProps<C.JournalExercise>) {
  const [texts, setTexts] = useState<string[]>(e.questions.map(() => ''));
  const save = async () => {
    for (let k = 0; k < e.questions.length; k++) if (texts[k].trim()) await ctx.saveJournal(texts[k].trim(), e.questions[k]);
    onDone(completed());
  };
  return (
    <>
      <Prompt e={e} />
      {e.questions.map((q, k) => (
        <View key={q}>
          <Heading>{q}</Heading>
          <Field value={texts[k]} onChangeText={(t) => setTexts((xs) => xs.map((x, j) => (j === k ? t : x)))} multiline style={styles.journal} />
        </View>
      ))}
      <Button label="Save" disabled={texts.every((t) => !t.trim())} onPress={() => void save()} />
      <Button label="Skip" kind="quiet" onPress={() => onDone(completed())} />
    </>
  );
}

const styles = StyleSheet.create({
  big: { textAlign: 'center', marginVertical: space[4] },
  row: { flexDirection: 'row', gap: space[2] },
  flex: { flex: 1 },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: space[1], marginBottom: space[3] },
  pill: { minWidth: 40, minHeight: 44, borderRadius: radius.sm, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  readout: { borderRadius: radius.lg, borderWidth: 2, padding: space[3], marginBottom: space[3] },
  journal: { minHeight: 96, textAlignVertical: 'top' },
});
