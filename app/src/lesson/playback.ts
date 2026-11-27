import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import { File, Paths } from 'expo-file-system';

import { wavBytes } from '../eartraining/synth';

// Plays synthesised sounds (ear-training stimuli, pitch-match tones). They
// are written to the cache folder as a WAV and played with expo-audio; each
// play overwrites the last file. Nothing recorded is ever played here.

let current: AudioPlayer | null = null;
let counter = 0;

export function stopPlayback(): void {
  current?.remove();
  current = null;
}

/** Plays samples (22.05 kHz mono) and resolves when playback ends. */
export async function play(samples: Float32Array): Promise<void> {
  stopPlayback();
  await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: false, shouldPlayInBackground: false });
  // A fresh name each time, so the player never reads a cached old file.
  const file = new File(Paths.cache, `nv-stimulus-${counter++ % 4}.wav`);
  if (file.exists) file.delete();
  file.create();
  file.writeSync(wavBytes(samples));
  const player = createAudioPlayer({ uri: file.uri });
  current = player;
  await new Promise<void>((resolve) => {
    const sub = player.addListener('playbackStatusUpdate', (s) => {
      if (s.didJustFinish) {
        sub.remove();
        resolve();
      }
    });
    // Never hang a lesson on a missed event.
    setTimeout(resolve, (samples.length / 22050) * 1000 + 1500);
    player.play();
  });
  if (current === player) stopPlayback();
}
