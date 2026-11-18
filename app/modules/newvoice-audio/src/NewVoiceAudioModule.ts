import { NativeModule, requireNativeModule } from 'expo';

import type { CaptureInfo, NewVoiceAudioModuleEvents, StartOptions } from './NewVoiceAudio.types';

declare class NewVoiceAudioModule extends NativeModule<NewVoiceAudioModuleEvents> {
  /** Version of the Rust analysis core linked into the app. */
  coreVersion(): string;
  /** Asks for the microphone if needed, then starts live analysis. */
  start(options: StartOptions): Promise<CaptureInfo>;
  stop(): Promise<void>;
  getCaptureInfo(): Promise<CaptureInfo>;
}

export default requireNativeModule<NewVoiceAudioModule>('NewVoiceAudio');
