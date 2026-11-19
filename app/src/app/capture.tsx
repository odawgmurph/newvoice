import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';

import CaptureSpike from '../../App';
import NewVoiceAudio from '../../modules/newvoice-audio/src/NewVoiceAudioModule';

// The Stage 2 capture spike as a screen. App.tsx stays where it is so capture
// work there merges cleanly. Leaving the screen, quick exit and the lock all
// unmount it, and the microphone must stop with it.
export default function Capture() {
  useEffect(
    () => () => {
      NewVoiceAudio.stop().catch(() => {});
    },
    [],
  );
  return (
    <>
      {/* The spike is always dark, whatever the phone's theme. */}
      <StatusBar style="light" />
      <CaptureSpike />
    </>
  );
}
