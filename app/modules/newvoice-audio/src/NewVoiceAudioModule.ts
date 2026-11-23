import { NativeModule, requireNativeModule } from 'expo';

import type {
  AppReport,
  CaptureInfo,
  ExportResult,
  NewVoiceAudioModuleEvents,
  StartOptions,
} from './NewVoiceAudio.types';

declare class NewVoiceAudioModule extends NativeModule<NewVoiceAudioModuleEvents> {
  /** Version of the Rust analysis core linked into the app. */
  coreVersion(): string;
  /**
   * Asks for the microphone if needed, then starts live analysis. With
   * `vowel` and `weightBaseline`, frames and utterances carry resonance and
   * weight-index scores; finished utterances arrive as `onUtterance` events
   * (also after `stop`, for the last one). Rejects for an unknown vowel.
   */
  start(options: StartOptions): Promise<CaptureInfo>;
  stop(): Promise<void>;
  getCaptureInfo(): Promise<CaptureInfo>;
  /**
   * Writes the last test clip (WAV + JSON report) and opens the share sheet.
   * Capture must be stopped. Read the files with harness/validation/device.py.
   */
  exportDiagnostics(appReport: AppReport): Promise<ExportResult>;
}

export default requireNativeModule<NewVoiceAudioModule>('NewVoiceAudio');
