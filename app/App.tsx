import { Canvas, Line, Path, Skia, vec } from '@shopify/react-native-skia';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useDerivedValue, useFrameCallback, useSharedValue } from 'react-native-reanimated';

import NewVoiceAudio from './modules/newvoice-audio/src/NewVoiceAudioModule';
import type { CaptureInfo, Frame, FramesEvent } from './modules/newvoice-audio/src/NewVoiceAudio.types';

// Stage 2 capture spike: live pitch trace on a semitone axis plus an F2
// readout, with the diagnostics the device matrix needs. Neutral labels only
// (decision D2): higher/lower, never gendered.

const WINDOW_S = 4;
const ST_MIN = 40; // E2, about 82 Hz
const ST_MAX = 80; // G#5, about 831 Hz
const TRACE_HEIGHT = 260;
// Readouts hide formants below this confidence (about 50% chance of a >10% error).
const MIN_FORMANT_CONFIDENCE = 0.5;

const NOTE_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];

function noteName(st: number): string {
  const midi = Math.round(st);
  const cents = Math.round((st - midi) * 100);
  const name = `${NOTE_NAMES[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
  return `${name} ${cents >= 0 ? '+' : '−'}${Math.abs(cents)}¢`;
}

type Timing = {
  analysisLagMs: number;
  inputLatencyMs: number;
  bridgeMs: number;
  droppedSamples: number;
};

export default function App() {
  const { width } = useWindowDimensions();
  const traceWidth = width - 32;

  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<CaptureInfo | null>(null);
  const [latest, setLatest] = useState<Frame | null>(null);
  const [timing, setTiming] = useState<Timing | null>(null);
  const [fps, setFps] = useState({ ui: 0, js: 0 });

  // Trace points as a flat [t, st, t, st, …] list (st NaN when unvoiced),
  // shared with the UI thread, which draws the path.
  const points = useSharedValue<number[]>([]);
  const buffer = useRef<number[]>([]);

  const path = useDerivedValue(() => {
    const p = Skia.PathBuilder.Make();
    const pts = points.value;
    if (pts.length < 2) return p.detach();
    const tEnd = pts[pts.length - 2];
    let penDown = false;
    for (let i = 0; i < pts.length; i += 2) {
      const st = pts[i + 1];
      if (Number.isNaN(st)) {
        penDown = false;
        continue;
      }
      const x = traceWidth * (1 - (tEnd - pts[i]) / WINDOW_S);
      const y = TRACE_HEIGHT * (1 - (st - ST_MIN) / (ST_MAX - ST_MIN));
      if (penDown) p.lineTo(x, y);
      else p.moveTo(x, y);
      penDown = true;
    }
    return p.detach();
  });

  // UI-thread frame rate (the trace's smoothness).
  const uiFrameMs = useSharedValue(16.7);
  useFrameCallback((frame) => {
    const dt = frame.timeSincePreviousFrame;
    if (dt != null) uiFrameMs.value = 0.9 * uiFrameMs.value + 0.1 * dt;
  });

  // JS-thread frame rate, sampled once a second along with the UI rate.
  useEffect(() => {
    let frames = 0;
    let raf = 0;
    const loop = () => {
      frames += 1;
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    const id = setInterval(() => {
      setFps({ ui: 1000 / uiFrameMs.value, js: frames });
      frames = 0;
    }, 1000);
    return () => {
      cancelAnimationFrame(raf);
      clearInterval(id);
    };
  }, [uiFrameMs]);

  useEffect(() => {
    const framesSub = NewVoiceAudio.addListener('onFrames', (event: FramesEvent) => {
      const buf = buffer.current;
      for (const f of event.frames) {
        buf.push(f.t, f.f0St ?? Number.NaN);
      }
      const tEnd = buf[buf.length - 2];
      let drop = 0;
      while (drop < buf.length && buf[drop] < tEnd - WINDOW_S) drop += 2;
      if (drop > 0) buf.splice(0, drop);
      points.value = buf.slice();

      setLatest(event.frames[event.frames.length - 1]);
      setTiming({
        analysisLagMs: event.analysisLagMs,
        inputLatencyMs: event.inputLatencyMs,
        bridgeMs: Date.now() - event.sentAtMs,
        droppedSamples: event.droppedSamples,
      });
    });
    const infoSub = NewVoiceAudio.addListener('onCaptureInfo', (next: CaptureInfo) => {
      setInfo(next);
      setRunning(next.running);
    });
    return () => {
      framesSub.remove();
      infoSub.remove();
    };
  }, [points]);

  const toggle = async () => {
    setError(null);
    try {
      if (running) {
        await NewVoiceAudio.stop();
        setRunning(false);
        setInfo(await NewVoiceAudio.getCaptureInfo());
      } else {
        buffer.current = [];
        points.value = [];
        setInfo(await NewVoiceAudio.start({}));
        setRunning(true);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setRunning(false);
    }
  };

  const f2Trusted = latest != null && latest.f2Hz != null && latest.formantConfidence >= MIN_FORMANT_CONFIDENCE;
  const micToScreenMs =
    timing == null ? null : timing.inputLatencyMs + timing.analysisLagMs + timing.bridgeMs + 1000 / Math.max(fps.ui, 1);

  const gridLines = [];
  for (let st = ST_MIN; st <= ST_MAX; st += 1) {
    const y = TRACE_HEIGHT * (1 - (st - ST_MIN) / (ST_MAX - ST_MIN));
    const octave = st % 12 === 0;
    gridLines.push(
      <Line
        key={st}
        p1={vec(0, y)}
        p2={vec(traceWidth, y)}
        color={octave ? '#4b5563' : '#1f2937'}
        strokeWidth={octave ? 1 : 0.5}
      />,
    );
  }
  const octaveLabels = [];
  for (let st = Math.ceil(ST_MIN / 12) * 12; st <= ST_MAX; st += 12) {
    const y = TRACE_HEIGHT * (1 - (st - ST_MIN) / (ST_MAX - ST_MIN));
    octaveLabels.push(
      <Text key={st} style={[styles.axisLabel, { top: y - 8 }]}>
        C{st / 12 - 1}
      </Text>,
    );
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <StatusBar style="light" />
      <Text style={styles.title}>Capture spike</Text>

      <View style={styles.readouts}>
        <View style={styles.readout}>
          <Text style={styles.readoutLabel}>Pitch</Text>
          <Text style={styles.readoutValue}>{latest?.f0St != null ? noteName(latest.f0St) : '—'}</Text>
          <Text style={styles.readoutSub}>{latest?.f0Hz != null ? `${latest.f0Hz.toFixed(1)} Hz` : ' '}</Text>
        </View>
        <View style={styles.readout}>
          <Text style={styles.readoutLabel}>F2</Text>
          <Text style={[styles.readoutValue, !f2Trusted && styles.dim]}>
            {latest?.f2Hz != null ? `${Math.round(latest.f2Hz)} Hz` : '—'}
          </Text>
          <Text style={styles.readoutSub}>
            {latest != null ? `confidence ${latest.formantConfidence.toFixed(2)}` : ' '}
          </Text>
        </View>
      </View>

      <View style={{ height: TRACE_HEIGHT }}>
        <Canvas style={{ width: traceWidth, height: TRACE_HEIGHT }}>
          {gridLines}
          <Path path={path} style="stroke" strokeWidth={2.5} color="#38bdf8" strokeJoin="round" strokeCap="round" />
        </Canvas>
        {octaveLabels}
      </View>
      <Text style={styles.axisCaption}>↑ higher · last {WINDOW_S} s · semitones</Text>

      <Pressable style={[styles.button, running && styles.buttonStop]} onPress={toggle}>
        <Text style={styles.buttonText}>{running ? 'Stop' : 'Start listening'}</Text>
      </Pressable>
      {error != null && <Text style={styles.error}>{error}</Text>}

      <View style={styles.panel}>
        <Text style={styles.panelTitle}>Capture</Text>
        {info == null ? (
          <Text style={styles.panelRow}>Not started</Text>
        ) : (
          <>
            <Row label="Measurement mode" value={info.measurementMode ? 'yes' : `no (${info.mode})`} bad={!info.measurementMode} />
            <Row label="Mic mode" value={info.microphoneMode} bad={info.microphoneMode !== 'standard' && info.microphoneMode !== 'unknown'} />
            <Row label="Input" value={info.inputs.map((i) => `${i.name} (${i.type})`).join(', ') || 'none'} bad={info.bluetoothInput} />
            {info.bluetoothInput && <Text style={styles.warn}>Bluetooth mic: narrowband and processed, readings are less accurate.</Text>}
            <Row label="Sample rate" value={`${info.sessionSampleRate} Hz (analysis ${info.analysisSampleRate})`} />
            <Row label="I/O buffer · input latency" value={`${info.ioBufferMs.toFixed(1)} · ${info.inputLatencyMs.toFixed(1)} ms`} />
            <Row label="Core" value={info.coreVersion} />
          </>
        )}
      </View>

      <View style={styles.panel}>
        <Text style={styles.panelTitle}>Timing</Text>
        <Row
          label="Mic → screen (est.)"
          value={micToScreenMs == null ? '—' : `${Math.round(micToScreenMs)} ms`}
          bad={micToScreenMs != null && micToScreenMs > 100}
        />
        <Row
          label="input · analysis · bridge"
          value={
            timing == null
              ? '—'
              : `${Math.round(timing.inputLatencyMs)} · ${Math.round(timing.analysisLagMs)} · ${Math.round(timing.bridgeMs)} ms`
          }
        />
        <Row label="UI · JS frame rate" value={`${fps.ui.toFixed(0)} · ${fps.js} fps`} bad={running && fps.ui < 55} />
        <Row label="Dropped samples" value={String(timing?.droppedSamples ?? 0)} bad={(timing?.droppedSamples ?? 0) > 0} />
      </View>
    </ScrollView>
  );
}

function Row({ label, value, bad = false }: { label: string; value: string; bad?: boolean }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowValue, bad && styles.bad]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#0b1120' },
  content: { paddingHorizontal: 16, paddingTop: 64, paddingBottom: 40 },
  title: { color: '#e5e7eb', fontSize: 20, fontWeight: '600', marginBottom: 12 },
  readouts: { flexDirection: 'row', gap: 12, marginBottom: 12 },
  readout: { flex: 1, backgroundColor: '#111827', borderRadius: 10, padding: 12 },
  readoutLabel: { color: '#9ca3af', fontSize: 13 },
  readoutValue: { color: '#f9fafb', fontSize: 26, fontWeight: '600', fontVariant: ['tabular-nums'] },
  readoutSub: { color: '#9ca3af', fontSize: 13, fontVariant: ['tabular-nums'] },
  dim: { color: '#4b5563' },
  axisLabel: { position: 'absolute', left: 4, color: '#6b7280', fontSize: 11 },
  axisCaption: { color: '#6b7280', fontSize: 12, marginTop: 4, marginBottom: 12 },
  button: { backgroundColor: '#0284c7', borderRadius: 10, paddingVertical: 14, alignItems: 'center' },
  buttonStop: { backgroundColor: '#374151' },
  buttonText: { color: '#fff', fontSize: 17, fontWeight: '600' },
  error: { color: '#fca5a5', marginTop: 8 },
  panel: { backgroundColor: '#111827', borderRadius: 10, padding: 12, marginTop: 12 },
  panelTitle: { color: '#e5e7eb', fontWeight: '600', marginBottom: 6 },
  panelRow: { color: '#9ca3af' },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2, gap: 12 },
  rowLabel: { color: '#9ca3af', fontSize: 13 },
  rowValue: { color: '#e5e7eb', fontSize: 13, fontVariant: ['tabular-nums'], flexShrink: 1, textAlign: 'right' },
  bad: { color: '#fbbf24' },
  warn: { color: '#fbbf24', fontSize: 12, marginVertical: 2 },
});
