import { Redirect } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';

import CaptureSpike from '../../App';
import NewVoiceAudio from '../../modules/newvoice-audio/src/NewVoiceAudioModule';
import { useApp } from '../state/AppState';

// The Stage 2 capture spike as a screen. App.tsx stays where it is so capture
// work there merges cleanly. Leaving the screen, quick exit and the lock all
// unmount it, and the microphone must stop with it.
// It records and exports audio (D13), so it is behind Settings → Developer
// tools, off by default (D23).
export default function Capture() {
  const { user } = useApp();
  useEffect(
    () => () => {
      NewVoiceAudio.stop().catch(() => {});
    },
    [],
  );
  if (!user?.developerTools) return <Redirect href="/" />;
  return (
    <>
      {/* The spike is always dark, whatever the phone's theme. */}
      <StatusBar style="light" />
      <CaptureSpike />
    </>
  );
}
