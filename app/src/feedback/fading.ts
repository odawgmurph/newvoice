// Feedback fading (Stage 3).
//
// Handbook §2.5: "Show high-frequency, real-time feedback early, then fade
// to summary or delayed feedback for retention: for example live visuals
// 100% of the time in early levels, then 50%, then only an end-of-utterance
// score." Every view runs in one of three modes, decided here as a pure
// state machine so the curriculum (Stage 5) can switch modes per exercise:
//
// - live: the trace draws as you speak; each utterance's summary follows.
// - summary: no trace at all; only the end-of-utterance summary (KR).
// - delayed: nothing while you speak; when an utterance ends, its trace is
//   revealed together with its summary (knowledge of performance after the
//   fact).

import type { FeedbackMode, Frame, UtteranceSummary } from './types.ts';

/** Seconds of trace kept on screen (the capture spike's 4 s window). */
export const TRACE_WINDOW_S = 4;
/** Summaries kept for the session list. */
export const MAX_SUMMARIES = 30;
/** Buffered frames kept while waiting for an utterance to end (delayed mode). */
const MAX_PENDING_S = 15;

export type TracePoint = { t: number; st: number | null };

export type FadingState = {
  mode: FeedbackMode;
  /** Points the trace may draw now, oldest first. */
  trace: TracePoint[];
  /** Frames heard but not yet revealed (delayed mode). */
  pending: TracePoint[];
  /** Utterance summaries the view may show, newest last. */
  summaries: UtteranceSummary[];
  /** Newest frame time seen. */
  now: number;
};

export type FadingEvent =
  | { type: 'frames'; frames: Pick<Frame, 't' | 'f0St'>[] }
  | { type: 'utterance'; utterance: UtteranceSummary }
  | { type: 'mode'; mode: FeedbackMode }
  | { type: 'reset' };

export function initialFading(mode: FeedbackMode = 'live'): FadingState {
  return { mode, trace: [], pending: [], summaries: [], now: 0 };
}

const window = (pts: TracePoint[], now: number, span: number) => {
  let i = 0;
  while (i < pts.length && pts[i].t < now - span) i++;
  return i === 0 ? pts : pts.slice(i);
};

export function fade(state: FadingState, event: FadingEvent): FadingState {
  switch (event.type) {
    case 'reset':
      return initialFading(state.mode);
    case 'mode':
      // Switching mode clears what the old mode had on screen, so a
      // summary-only exercise never shows a trace left from a live one.
      return { ...initialFading(event.mode), summaries: state.summaries };
    case 'frames': {
      if (event.frames.length === 0) return state;
      const pts = event.frames.map((f) => ({ t: f.t, st: f.f0St }));
      const now = pts[pts.length - 1].t;
      if (state.mode === 'live') {
        return { ...state, now, trace: window([...state.trace, ...pts], now, TRACE_WINDOW_S) };
      }
      if (state.mode === 'delayed') {
        return { ...state, now, pending: window([...state.pending, ...pts], now, MAX_PENDING_S) };
      }
      return { ...state, now };
    }
    case 'utterance': {
      const u = event.utterance;
      const summaries = [...state.summaries, u].slice(-MAX_SUMMARIES);
      if (state.mode !== 'delayed') return { ...state, summaries };
      // Reveal this utterance's own stretch of trace (with 50 ms either
      // side, the segmenter's margin), replacing the previous reveal.
      const from = u.startS - 0.05;
      const to = u.endS + 0.05;
      const trace = state.pending.filter((p) => p.t >= from && p.t <= to);
      const pending = state.pending.filter((p) => p.t > to);
      return { ...state, summaries, trace, pending };
    }
  }
}

/** Whether a mode draws a trace while the user is speaking. */
export const drawsLiveTrace = (mode: FeedbackMode) => mode === 'live';

/** Display names; neutral, education-only copy. */
export const MODE_LABELS: Record<FeedbackMode, { label: string; detail: string }> = {
  live: { label: 'Live', detail: 'See your voice as you speak.' },
  summary: { label: 'Summary', detail: 'A short summary after each phrase, nothing while you speak.' },
  delayed: { label: 'Replay', detail: 'Speak first; each phrase’s trace appears when you pause.' },
};
