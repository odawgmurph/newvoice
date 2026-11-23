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

export type FeatureStats = { mean: number; sd: number };

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
  weightBaseline: {
    h1cH2cDb: FeatureStats | null;
    alphaRatioDb: FeatureStats | null;
    cppsDb: FeatureStats | null;
  };
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
