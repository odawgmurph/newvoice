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
