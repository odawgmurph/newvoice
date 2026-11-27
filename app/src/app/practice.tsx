import { eq } from 'drizzle-orm';
import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import NewVoiceAudio from '../../modules/newvoice-audio/src/NewVoiceAudioModule';
import { feedbackBaselineFrom } from '../baseline/plan';
import { currentBaseline, saveProvisionalBaseline } from '../baseline/store';
import { session as sessionTable } from '../db/schema';
import { useApp, useDb } from '../state/AppState';
import { Body, Button, Caption, ErrorText, Heading } from '../ui/kit';
import { radius, space, type, useTheme } from '../ui/theme';
import { drawsLiveTrace, fade, initialFading, MODE_LABELS } from '../feedback/fading';
import { pitchAxis } from '../feedback/geometry';
import { LiveReadouts, formantVisibility, type LiveReadout } from '../feedback/readout';
import { REFERENCE_NORMS } from '../feedback/referenceNorms';
import { StrainMonitor, type StrainReason } from '../feedback/strain';
import type { Baseline, FeedbackMode, Frame, UtteranceSummary } from '../feedback/types';
import { PitchResonanceMap, type MapDot } from '../feedback/views/PitchResonanceMap';
import { PitchTrace } from '../feedback/views/PitchTrace';
import { EffortPicker, RestPrompt } from '../feedback/views/RestPrompt';
import { SummaryCard } from '../feedback/views/SummaryCard';
import { VowelChart, type VowelDot } from '../feedback/views/VowelChart';
import { f2Position, f2Zone, pitchZone, provisionalBaseline, stToHz } from '../feedback/zones';

// Stage 3 practice screen: live, summary or replay feedback on pitch and
// brightness, against the user's starting point and goal, with the strain
// monitor watching every phrase. Lessons (Stage 5) will drive the vowel,
// level and mode; here they are chosen by hand so the views can be tried.

/** Vowels offered for brightness feedback: the corners of the vowel space. */
const VOWELS = ['iy', 'ae', 'ah', 'uw'] as const;
/** Live vowel-chart dots kept (half a second of confident frames). */
const VOWEL_DOTS = 50;
const MAX_LEVEL = 10;

const NOTE_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
const noteName = (st: number) => {
  const m = Math.round(st);
  return `${NOTE_NAMES[((m % 12) + 12) % 12]}${Math.floor(m / 12) - 1}`;
};

export default function Practice() {
  const db = useDb();
  const { user, refreshUser } = useApp();
  const { c } = useTheme();
  const genderedBands = user?.genderedBands ?? false;
  // Whisper mode (§4.3): formants only, no pitch, for practising quietly.
  const whisper = user?.whisperMode ?? false;
  const goal = user?.goal ?? null;

  const [baseline, setBaseline] = useState<Baseline | null>(null);
  const [vowel, setVowel] = useState<string | null>(null);
  const [level, setLevel] = useState(0);
  const [fading, dispatch] = useReducer(fade, undefined, () => initialFading('live'));
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [readout, setReadout] = useState<LiveReadout | null>(null);
  const [utterances, setUtterances] = useState<UtteranceSummary[]>([]);
  const [reasons, setReasons] = useState<StrainReason[]>([]);
  const [effort, setEffort] = useState<number | null>(null);
  const [vowelDots, setVowelDots] = useState<VowelDot[]>([]);
  const [saved, setSaved] = useState(false);

  const readouts = useRef(new LiveReadouts());
  const monitor = useRef<StrainMonitor | null>(null);
  const sessionId = useRef<number | null>(null);
  const sessionStart = useRef(0);
  const runningRef = useRef(false);

  // The stored starting point, if any.
  useEffect(() => {
    const id = user?.baselineId;
    if (id == null) return;
    void (async () => {
      const row = await currentBaseline(db, id);
      setBaseline(row ? feedbackBaselineFrom(row.summary) : null);
    })();
  }, [db, user?.baselineId]);

  // A new starting point means a new safety ceiling: start the monitor over.
  useEffect(() => {
    monitor.current = null;
  }, [baseline]);

  const getMonitor = useCallback(() => {
    monitor.current ??= new StrainMonitor({ comfortableP90St: baseline?.comfortableP90St ?? null });
    return monitor.current;
  }, [baseline]);

  const stop = useCallback(async () => {
    runningRef.current = false;
    setRunning(false);
    await NewVoiceAudio.stop().catch(() => {});
    if (sessionId.current != null) {
      await db
        .update(sessionTable)
        .set({ durationS: (Date.now() - sessionStart.current) / 1000 })
        .where(eq(sessionTable.id, sessionId.current));
    }
  }, [db]);

  const raise = useCallback(
    (found: StrainReason[]) => {
      if (found.length === 0) return;
      // The microphone goes off while the rest prompt shows.
      void stop();
      setReasons((r) => [...new Set([...r, ...found])]);
    },
    [stop],
  );

  useEffect(() => {
    const frames = NewVoiceAudio.addListener('onFrames', (e) => {
      const fs: Frame[] = e.frames;
      dispatch({ type: 'frames', frames: fs });
      setReadout(readouts.current.push(fs));
      const dots = fs
        .filter((f) => f.f0St != null && f.f1Hz != null && f.f2Hz != null && formantVisibility(f.formantConfidence) !== 'hidden')
        .map((f) => ({ f1Hz: f.f1Hz!, f2Hz: f.f2Hz! }));
      if (dots.length > 0) setVowelDots((d) => [...d, ...dots].slice(-VOWEL_DOTS));
    });
    const utts = NewVoiceAudio.addListener('onUtterance', (u: UtteranceSummary) => {
      dispatch({ type: 'utterance', utterance: u });
      setUtterances((list) => [...list, u]);
      raise(getMonitor().addUtterance(u));
    });
    const info = NewVoiceAudio.addListener('onCaptureInfo', (i) => {
      if (!i.running && runningRef.current) {
        runningRef.current = false;
        setRunning(false);
      }
    });
    return () => {
      frames.remove();
      utts.remove();
      info.remove();
    };
  }, [getMonitor, raise]);

  // Leaving the screen, quick exit and the lock all unmount it.
  useEffect(
    () => () => {
      NewVoiceAudio.stop().catch(() => {});
    },
    [],
  );

  const start = async () => {
    setError(null);
    try {
      if (sessionId.current == null) {
        const [row] = await db.insert(sessionTable).values({ startedAt: new Date() }).returning({ id: sessionTable.id });
        sessionId.current = row.id;
        sessionStart.current = Date.now();
      }
      readouts.current.reset();
      setVowelDots([]);
      await NewVoiceAudio.start(vowel ? { vowel } : {});
      runningRef.current = true;
      setRunning(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      runningRef.current = false;
      setRunning(false);
    }
  };

  const pickEffort = async (n: number) => {
    setEffort(n);
    if (sessionId.current != null) {
      await db.update(sessionTable).set({ effortRating: n }).where(eq(sessionTable.id, sessionId.current));
    }
    raise(getMonitor().reportEffort(n));
  };

  const rested = () => {
    getMonitor().acknowledgeRest();
    setReasons([]);
    setEffort(null);
  };

  const setMode = (mode: FeedbackMode) => dispatch({ type: 'mode', mode });

  const provisional = useMemo(() => provisionalBaseline(utterances, vowel ?? undefined), [utterances, vowel]);
  const saveProvisional = async () => {
    if (!provisional) return;
    await saveProvisionalBaseline(db, provisional, NewVoiceAudio.coreVersion());
    await refreshUser();
    setBaseline(provisional);
    setSaved(true);
  };

  const pz = baseline ? pitchZone(baseline, goal, level) : null;
  const fz = baseline && vowel ? f2Zone(baseline, goal, vowel, level) : null;
  const axis = useMemo(
    () => pitchAxis(baseline ? [baseline.comfortableP10St, baseline.comfortableP90St, baseline.medianSt] : []),
    [baseline],
  );
  const last = fading.summaries[fading.summaries.length - 1] ?? null;
  const live = fading.mode === 'live';

  const mapDots: MapDot[] = fading.summaries
    .filter((u) => u.scored && u.pitch && u.resonance != null && formantVisibility(u.formantConfidence) !== 'hidden')
    .map((u) => ({ st: u.pitch!.medianSt, resonance: u.resonance! }));
  const liveDot: MapDot | null =
    live && readout?.pitchSt != null && readout.resonance != null && readout.resonanceVisibility !== 'hidden'
      ? { st: readout.pitchSt, resonance: readout.resonance }
      : null;
  const baseDot: MapDot | null =
    baseline?.resonance != null ? { st: baseline.medianSt, resonance: baseline.resonance } : null;
  const targetRes = vowel && fz ? f2Position(vowel, fz.centre) : null;
  const targetDot: MapDot | null = pz && targetRes != null ? { st: pz.centre, resonance: targetRes } : null;
  const lastVowel =
    last && last.f1Hz != null && last.f2Hz != null && formantVisibility(last.formantConfidence) !== 'hidden'
      ? { f1Hz: last.f1Hz, f2Hz: last.f2Hz }
      : null;

  return (
    <>
      <View style={[styles.screen, { backgroundColor: c.surface100 }]}>
        <View style={styles.controls}>
          <Segmented
            options={(Object.keys(MODE_LABELS) as FeedbackMode[]).map((m) => ({ key: m, label: MODE_LABELS[m].label }))}
            value={fading.mode}
            onChange={(m) => setMode(m as FeedbackMode)}
          />
          <Caption>{MODE_LABELS[fading.mode].detail}</Caption>
        </View>
        <ScrollBody>
          {whisper ? <Caption>Whisper mode: brightness only. Whisper a vowel and watch F2.</Caption> : null}
          {live ? (
            <View style={styles.readouts}>
              {whisper ? null : (
              <Readout
                label="Pitch"
                value={readout?.pitchSt != null ? noteName(readout.pitchSt) : '—'}
                sub={readout?.pitchSt != null ? `${Math.round(stToHz(readout.pitchSt))} Hz` : ' '}
              />
              )}
              <Readout
                label="F2"
                value={readout?.f2Hz != null && readout.f2Visibility !== 'hidden' ? `${Math.round(readout.f2Hz)}` : '—'}
                sub={readout?.f2Visibility === 'dimmed' ? 'rough' : readout?.f2Visibility === 'hidden' ? 'not reliable now' : 'Hz'}
                dim={readout?.f2Visibility !== 'shown'}
              />
            </View>
          ) : null}

          {fading.mode !== 'summary' && !whisper ? (
            <PitchTrace
              points={fading.trace}
              tEnd={live ? fading.now : (fading.trace[fading.trace.length - 1]?.t ?? 0)}
              axis={axis}
              zone={pz}
              caption={live ? undefined : 'Your last phrase, shown after you paused.'}
            />
          ) : null}

          {last ? <SummaryCard utterance={last} baseline={baseline} pitchZone={pz} f2Zone={fz} /> : null}

          {vowel ? (
            <>
              <PitchResonanceMap
                utterances={mapDots}
                live={liveDot}
                baseline={baseDot}
                target={targetDot}
                pitchAxis={axis}
                genderedBands={genderedBands}
              />
              <VowelChart
                vowel={vowel}
                live={live ? vowelDots : []}
                utterance={lastVowel}
                f2Zone={fz}
                genderedBands={genderedBands}
              />
            </>
          ) : null}

          <Heading>Vowel</Heading>
          <Caption>Pick a vowel to hold or repeat for brightness feedback. Change it while stopped.</Caption>
          <Segmented
            options={[
              { key: 'none', label: 'Any' },
              ...VOWELS.map((v) => ({ key: v, label: `“${REFERENCE_NORMS.vowels[v].word}”` })),
            ]}
            value={vowel ?? 'none'}
            onChange={(k) => !running && setVowel(k === 'none' ? null : k)}
          />

          <Heading>Starting point</Heading>
          {baseline ? (
            <>
              <Body muted>
                {baseline.source === 'provisional'
                  ? 'Your zones come from a practice session you saved. The full starting-point recording comes later.'
                  : 'Your zones come from your starting-point recording.'}
              </Body>
              <View style={styles.levelRow}>
                <Text style={[type.body, { color: c.ink }]}>Target step {level}</Text>
                <View style={styles.levelButtons}>
                  <Button label="−" kind="secondary" disabled={level === 0} onPress={() => setLevel((l) => Math.max(0, l - 1))} />
                  <Button label="+" kind="secondary" disabled={level === MAX_LEVEL} onPress={() => setLevel((l) => Math.min(MAX_LEVEL, l + 1))} />
                </View>
              </View>
              <Caption>
                Each step raises the target a semitone, or the vowel’s F2 by 3%, toward your goal. It never goes past
                the top of your comfortable range.
              </Caption>
            </>
          ) : (
            <Body muted>
              No starting point yet, so there are no target zones. Speak in your everyday voice for a little while,
              then save this session as your starting point.
            </Body>
          )}
          {provisional && (!baseline || baseline.source === 'provisional') && !saved ? (
            <Button label="Use this session as my starting point" kind="secondary" onPress={() => void saveProvisional()} />
          ) : null}

          <Heading>Effort</Heading>
          <EffortPicker value={effort} onPick={(n) => void pickEffort(n)} />
          {error ? <ErrorText>{error}</ErrorText> : null}
        </ScrollBody>
        <View style={[styles.footer, { borderColor: c.line }]}>
          <Button label={running ? 'Stop' : 'Start listening'} kind={running ? 'secondary' : 'primary'} onPress={() => void (running ? stop() : start())} />
        </View>
      </View>
      <RestPrompt reasons={reasons} onRested={rested} />
    </>
  );
}

function ScrollBody({ children }: { children: ReactNode }) {
  return <ScrollView contentContainerStyle={styles.content}>{children}</ScrollView>;
}

function Readout({ label, value, sub, dim = false }: { label: string; value: string; sub: string; dim?: boolean }) {
  const { c } = useTheme();
  return (
    <View style={[styles.readout, { backgroundColor: c.surface200, borderColor: c.line }]}>
      <Text style={[type.label, { color: c.inkMuted }]}>{label}</Text>
      <Text style={[type.readout, { color: dim ? c.inkMuted : c.ink }]}>{value}</Text>
      <Text style={[type.caption, { color: c.inkMuted }]}>{sub}</Text>
    </View>
  );
}

function Segmented({
  options,
  value,
  onChange,
}: {
  options: { key: string; label: string }[];
  value: string;
  onChange: (key: string) => void;
}) {
  const { c } = useTheme();
  return (
    <View style={[styles.segmented, { borderColor: c.lineControl }]} accessibilityRole="radiogroup">
      {options.map((o) => {
        const on = o.key === value;
        return (
          <Pressable
            key={o.key}
            accessibilityRole="radio"
            accessibilityState={{ selected: on }}
            onPress={() => onChange(o.key)}
            style={[styles.segment, on && { backgroundColor: c.ink }]}
          >
            <Text style={[type.label, { color: on ? c.surface100 : c.ink }]} numberOfLines={1}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  controls: { paddingHorizontal: space[6], paddingTop: space[3] },
  content: { paddingHorizontal: space[6], paddingTop: space[3], paddingBottom: space[8] },
  readouts: { flexDirection: 'row', gap: space[3], marginBottom: space[4] },
  readout: { flex: 1, borderRadius: radius.lg, borderWidth: 1, padding: space[3] },
  segmented: { flexDirection: 'row', borderWidth: 2, borderRadius: radius.md, overflow: 'hidden', marginBottom: space[2] },
  segment: { flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space[1] },
  levelRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  levelButtons: { flexDirection: 'row', gap: space[2] },
  footer: { paddingHorizontal: space[6], paddingBottom: space[8], borderTopWidth: 1 },
});
