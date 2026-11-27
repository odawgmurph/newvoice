import { useCallback, useEffect, useRef, useState } from 'react';

import NewVoiceAudio from '../../modules/newvoice-audio/src/NewVoiceAudioModule';
import type { StartOptions } from '../../modules/newvoice-audio/src/NewVoiceAudio.types';
import { TRACE_WINDOW_S, type TracePoint } from '../feedback/fading';
import { LiveReadouts, type LiveReadout } from '../feedback/readout';
import type { Frame, UtteranceSummary } from '../feedback/types';

// Live capture for lesson exercises: the Rust core's frames and utterance
// summaries (only numbers reach JavaScript, D1), a rolling trace for the
// pitch view, and the capture time that counts toward the daily limit.

/** Utterance summaries arrive shortly after capture stops (the core closes the last one). */
const LAST_UTTERANCE_WAIT_MS = 600;

export type Capture = { frames: Frame[]; utterances: UtteranceSummary[]; seconds: number };

export function useVoice(onUtterance?: (u: UtteranceSummary) => void) {
  const [running, setRunning] = useState(false);
  const [readout, setReadout] = useState<LiveReadout | null>(null);
  const [trace, setTrace] = useState<TracePoint[]>([]);
  const [now, setNow] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const frames = useRef<Frame[]>([]);
  const utterances = useRef<UtteranceSummary[]>([]);
  const readouts = useRef(new LiveReadouts());
  const startedAt = useRef(0);
  const runningRef = useRef(false);
  const onUtt = useRef(onUtterance);
  onUtt.current = onUtterance;

  useEffect(() => {
    const f = NewVoiceAudio.addListener('onFrames', (e) => {
      if (!runningRef.current) return;
      const fs: Frame[] = e.frames;
      frames.current.push(...fs);
      setReadout(readouts.current.push(fs));
      const last = fs[fs.length - 1];
      if (last) {
        setNow(last.t);
        setTrace((t) => [...t, ...fs.map((x) => ({ t: x.t, st: x.f0St }))].filter((p) => p.t > last.t - TRACE_WINDOW_S));
      }
    });
    const u = NewVoiceAudio.addListener('onUtterance', (s: UtteranceSummary) => {
      utterances.current.push(s);
      onUtt.current?.(s);
    });
    const i = NewVoiceAudio.addListener('onCaptureInfo', (info) => {
      if (!info.running && runningRef.current) {
        runningRef.current = false;
        setRunning(false);
      }
    });
    return () => {
      f.remove();
      u.remove();
      i.remove();
      NewVoiceAudio.stop().catch(() => {});
    };
  }, []);

  const start = useCallback(async (options: StartOptions = {}) => {
    setError(null);
    frames.current = [];
    utterances.current = [];
    readouts.current.reset();
    setTrace([]);
    setReadout(null);
    try {
      await NewVoiceAudio.start(options);
      startedAt.current = Date.now();
      runningRef.current = true;
      setRunning(true);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return false;
    }
  }, []);

  /** Stops capture and returns everything measured since `start`. */
  const stop = useCallback(async (): Promise<Capture> => {
    const wasRunning = runningRef.current;
    runningRef.current = false;
    setRunning(false);
    await NewVoiceAudio.stop().catch(() => {});
    if (wasRunning) await new Promise((r) => setTimeout(r, LAST_UTTERANCE_WAIT_MS));
    const seconds = startedAt.current ? (Date.now() - startedAt.current) / 1000 : 0;
    startedAt.current = 0;
    return { frames: [...frames.current], utterances: [...utterances.current], seconds };
  }, []);

  return { running, readout, trace, now, error, start, stop, frames, utterances };
}

export type Voice = ReturnType<typeof useVoice>;
