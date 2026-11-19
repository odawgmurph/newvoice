import { AtkinsonHyperlegible_400Regular } from '@expo-google-fonts/atkinson-hyperlegible/400Regular';
import { AtkinsonHyperlegible_700Bold } from '@expo-google-fonts/atkinson-hyperlegible/700Bold';
import { DMMono_500Medium } from '@expo-google-fonts/dm-mono/500Medium';
import { Fraunces_600SemiBold } from '@expo-google-fonts/fraunces/600SemiBold';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { View } from 'react-native';

import { Cover, DbErrorScreen, LockScreen, SwitcherShield } from '../privacy/Gates';
import { AppStateProvider, useApp } from '../state/AppState';
import { ExitButton } from '../ui/kit';
import { fonts, useTheme } from '../ui/theme';

// The capture spike keeps its own dark look; its header matches it.
const SPIKE_BG = '#0b1120';

export default function RootLayout() {
  // Fonts are bundled with the app (OFL-1.1, see NOTICE); nothing is fetched.
  const [fontsLoaded, fontError] = useFonts({
    [fonts.display]: Fraunces_600SemiBold,
    [fonts.sans]: AtkinsonHyperlegible_400Regular,
    [fonts.sansBold]: AtkinsonHyperlegible_700Bold,
    [fonts.mono]: DMMono_500Medium,
  });
  const { c } = useTheme();
  return (
    <AppStateProvider>
      <StatusBar style="auto" />
      {fontsLoaded || fontError ? <Gate /> : <View style={{ flex: 1, backgroundColor: c.surface100 }} />}
      <SwitcherShield />
    </AppStateProvider>
  );
}

/** Decides what may be on screen: nothing, an error, the cover, the lock, or the app. */
function Gate() {
  const { status, covered, locked, quickExit } = useApp();
  const { c } = useTheme();
  if (covered) return <Cover />;
  if (status.kind === 'opening') return <View style={{ flex: 1, backgroundColor: c.surface100 }} />;
  if (status.kind === 'error') return <DbErrorScreen />;
  if (locked) return <LockScreen />;
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: c.surface100 },
        headerTintColor: c.ink,
        headerTitleStyle: { fontFamily: fonts.display, fontSize: 20 },
        headerShadowVisible: false,
        contentStyle: { backgroundColor: c.surface100 },
        // Quick exit is on every screen (handbook §4.3); screens without the
        // navigation header draw it in their own header.
        headerRight: () => <ExitButton onPress={quickExit} />,
      }}
    >
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="onboarding" options={{ headerShown: false, gestureEnabled: false }} />
      <Stack.Screen name="settings" options={{ title: 'Settings' }} />
      <Stack.Screen
        name="capture"
        options={{
          title: 'Capture test',
          headerStyle: { backgroundColor: SPIKE_BG },
          headerTintColor: '#e5e7eb',
          contentStyle: { backgroundColor: SPIKE_BG },
        }}
      />
    </Stack>
  );
}
