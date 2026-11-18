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
