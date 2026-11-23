/** One 10 ms analysis frame, as computed by the Rust core. */
export type Frame = {
  /** Frame centre, seconds since capture started. */
  t: number;
  /** Relative level; compare with the user's own baseline only. */
  levelDbfs: number;
  periodicity: number;
  voiced: boolean;
  /** Smoothed F0, null when unvoiced. */
  f0Hz: number | null;
  /** F0 in semitones on the MIDI scale (A4 = 69). */
  f0St: number | null;
  f1Hz: number | null;
  f2Hz: number | null;
  /** 0-1: roughly the chance F1 and F2 are both within 10%. */
  formantConfidence: number;
  /** H1*–H2* (dB), frames with an F0 and F1/F2 only. Higher = lighter/breathier. */
  h1cH2cDb: number | null;
  /** Alpha ratio (dB), frames with an F0 only. */
  alphaRatioDb: number | null;
  /** Resonance score of this frame against `StartOptions.vowel` (0/1 = the two reference groups); gate on formantConfidence. */
  resonance: number | null;
  /** Live weight index against `StartOptions.weightBaseline` (positive = heavier). A proxy only. */
  weightIndex: number | null;
};

/** Utterance pitch statistics over voiced frames, in semitones (MIDI scale). */
export type PitchSummary = {
  medianHz: number;
  medianSt: number;
  p10St: number;
  p90St: number;
  sdSt: number;
  range5to95St: number;
};

/**
 * One utterance, measured by the Rust core when it ends (an unvoiced gap of
 * 300 ms, or 12 s of speech). Same shape as `newvoice-cli utterances` output
 * after camel-casing (harness/validation/strain.py).
 */
export type UtteranceSummary = {
  /** Stream times (s) of the first and last voiced frames. */
  startS: number;
  endS: number;
  voicedS: number;
  /** At least 1 s voiced: utterance scores may be shown (handbook §3.1). */
  scored: boolean;
  pitch: PitchSummary | null;
  /** F0 slope over the last 300 ms of voicing (ST/s); > +2 is a rising contour. */
  terminalSlopeStPerS: number | null;
  f1Hz: number | null;
  f2Hz: number | null;
  f3Hz: number | null;
  formantConfidence: number;
  /** Against `StartOptions.vowel`, when set. */
  resonance: number | null;
  /** Against `StartOptions.weightBaseline`, when set. */
  weightIndex: number | null;
  h1cH2cDb: number | null;
  alphaRatioDb: number | null;
  cppsDb: number | null;
  hnrDb: number | null;
  /** Fractions (0.01 = 1%). */
  jitterLocal: number | null;
  shimmerLocal: number | null;
  periods: number;
};

export type FeatureStats = { mean: number; sd: number };

/** A user's weight-index baseline, from `measure_voice_quality` on the baseline recording. */
export type WeightBaseline = {
  h1cH2cDb: FeatureStats | null;
  alphaRatioDb: FeatureStats | null;
  cppsDb: FeatureStats | null;
};

export type FramesEvent = {
  frames: Frame[];
  /** Audio received after the newest frame's centre (analyser look-ahead plus polling). */
  analysisLagMs: number;
  /** Hardware input latency plus the I/O buffer. */
  inputLatencyMs: number;
  /** Samples dropped because analysis fell behind (should stay 0). */
  droppedSamples: number;
  /** Wall-clock time the batch left native code (ms since epoch). */
  sentAtMs: number;
};

/** What iOS actually gave the app. */
export type CaptureInfo = {
  running: boolean;
  category: string;
  mode: string;
  /** False means iOS did not grant the unprocessed measurement mode. */
  measurementMode: boolean;
  /** iOS microphone mode (Control Center): anything but "standard" may process audio. */
  microphoneMode: string;
  inputs: { type: string; name: string }[];
  /** Bluetooth mics are narrowband and processed: readings are less accurate. */
  bluetoothInput: boolean;
  sessionSampleRate: number;
  analysisSampleRate: number;
  ioBufferMs: number;
  inputLatencyMs: number;
  inputGainSettable: boolean;
  inputGain: number;
  coreVersion: string;
  /** A test clip is being recorded. */
  recording: boolean;
  /** Length of the last finished test clip in seconds, 0 if none. */
  testClipS: number;
};

export type StartOptions = {
  formantCeilingHz?: number;
  /** Hillenbrand code ("iy") or IPA ("i") of the vowel the exercise asks for; enables resonance scores. */
  vowel?: string;
  /** Enables weight-index readouts. */
  weightBaseline?: WeightBaseline;
  /** Record a test clip this long for the diagnostics export; capture stops by itself at the end. */
  recordSeconds?: number;
};

/** Summary of a measurement series: median, 95th percentile, max, count. */
export type SeriesStats = { median: number; p95: number; max: number; n: number } | null;

/** What JavaScript measured during the test clip; native code adds the rest. */
export type AppReport = {
  micToScreenMs: SeriesStats;
  bridgeMs: SeriesStats;
  analysisLagMs: SeriesStats;
  inputLatencyMs: SeriesStats;
  /** One sample per second. */
  uiFps: SeriesStats;
  jsFps: SeriesStats;
  /** Free-text note from the tester, e.g. what they said or the room. */
  note: string;
};

export type ExportResult = {
  /** False when the share sheet was dismissed without sending. */
  shared: boolean;
  activity: string;
  files: string[];
};

export type NewVoiceAudioModuleEvents = {
  onFrames: (event: FramesEvent) => void;
  onCaptureInfo: (info: CaptureInfo) => void;
  /** Each finished utterance's summary (computed off the analysis thread). */
  onUtterance: (utterance: UtteranceSummary) => void;
};

/** How a recorded task is measured (see TaskAnalysis.swift). */
export type TaskKind = 'vowel' | 'glide' | 'speech';

export type AnalyseOptions = {
  kind: TaskKind;
  /**
   * Keep the audio at this path, relative to Documents and inside
   * "recordings/" (e.g. "recordings/baseline-1/vowel-a.wav"). Omit to keep
   * no audio (metrics-only).
   */
  saveAs?: string;
};

/** Utterance pitch statistics over voiced frames, semitones on the MIDI scale. */
export type TaskPitch = {
  voicedS: number;
  medianHz: number;
  medianSt: number;
  p5St: number;
  p10St: number;
  p90St: number;
  p95St: number;
  sdSt: number;
};

/** Voice quality (handbook §3.4); only comparable within one qualityVersion. */
export type TaskQuality = {
  qualityVersion: number;
  weightIndexVersion: number;
  voicedS: number;
  h1H2Db: number | null;
  h1cH2cDb: number | null;
  alphaRatioDb: number | null;
  hammarbergDb: number | null;
  lhRatioDb: number | null;
  cppsDb: number | null;
  hnrDb: number | null;
  /** Fractions (0.01 = 1%). */
  jitterLocal: number | null;
  shimmerLocal: number | null;
  periods: number;
  /** This recording as a weight-index baseline. */
  weightBaseline: WeightBaseline;
};

/** A sustained vowel's steady-state formants and vocal tract length. */
export type TaskVowel = {
  f0MedianHz: number;
  /** Formant ceiling the sweep chose; use it for live formants. */
  ceilingHz: number;
  f1Hz: number | null;
  f2Hz: number | null;
  f3Hz: number | null;
  f4Hz: number | null;
  deltaFHz: number | null;
  avtlCm: number | null;
  deltaFPosition: number | null;
  /** 0–1: roughly the chance F1 and F2 are both within 10%. */
  confidence: number;
};

/** One analysed task recording, as stored in `recording.features`. */
export type TaskResult = {
  formatVersion: number;
  kind: TaskKind;
  coreVersion: string;
  durationS: number;
  sampleRate: number;
  capture: {
    /** False when iOS processed the audio at some point. */
    measurementMode: boolean;
    bluetoothInput: boolean;
    microphoneMode: string | null;
    droppedSamples: number;
    stoppedEarly: boolean;
  };
  levels: {
    peakDbfs: number | null;
    /** Share of samples at full scale. */
    clippedFraction: number;
    /** Relative only: compare with the user's own baseline. */
    voicedLevelMedianDbfs: number | null;
  };
  /** Null when nothing was voiced. */
  pitch: TaskPitch | null;
  quality: TaskQuality;
  /** Vowel tasks only; null when no steady vowel was found. */
  vowel: TaskVowel | null;
  /** The kept audio file, or null (metrics-only). */
  audioUri: string | null;
};

export type ResonanceTokenInput = {
  /** Hillenbrand code ("iy") or IPA ("i"). */
  vowel: string;
  f1Hz: number | null;
  f2Hz: number | null;
  f3Hz: number | null;
  weight: number;
};

/** The resonance score (a heuristic between two reference means, 0 and 1); score null when nothing was scorable. */
export type ResonanceScoreResult = {
  version: number | null;
  score: number | null;
  f1: number | null;
  f2: number | null;
  f3: number | null;
  tokensUsed: number;
};
