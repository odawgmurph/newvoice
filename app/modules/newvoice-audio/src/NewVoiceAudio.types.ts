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
};

export type StartOptions = {
  formantCeilingHz?: number;
};

export type NewVoiceAudioModuleEvents = {
  onFrames: (event: FramesEvent) => void;
  onCaptureInfo: (info: CaptureInfo) => void;
};
