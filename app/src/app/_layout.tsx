import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Cover, DbErrorScreen, LockScreen, SwitcherShield } from '../privacy/Gates';
import { AppStateProvider, useApp } from '../state/AppState';
import { colors } from '../ui/kit';

export default function RootLayout() {
  return (
    <AppStateProvider>
      <StatusBar style="light" />
      <Gate />
      <SwitcherShield />
    </AppStateProvider>
  );
}

/** Decides what may be on screen: nothing, an error, the cover, the lock, or the app. */
function Gate() {
  const { status, covered, locked } = useApp();
  if (covered) return <Cover />;
  if (status.kind === 'opening') return <View style={styles.blank} />;
  if (status.kind === 'error') return <DbErrorScreen />;
  if (locked) return <LockScreen />;
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.bg },
        headerTintColor: colors.text,
        contentStyle: { backgroundColor: colors.bg },
        headerRight: () => <QuickExitButton />,
      }}
    >
      <Stack.Screen name="index" options={{ title: 'NewVoice' }} />
      <Stack.Screen name="onboarding" options={{ title: 'Welcome', headerBackVisible: false, gestureEnabled: false }} />
      <Stack.Screen name="settings" options={{ title: 'Settings' }} />
      <Stack.Screen name="capture" options={{ title: 'Capture test' }} />
    </Stack>
  );
}

/** Always one tap away, on every screen (handbook §4.3). */
function QuickExitButton() {
  const { quickExit } = useApp();
  return (
    <Pressable
      onPress={quickExit}
      hitSlop={12}
      accessibilityRole="button"
      accessibilityLabel="Quick exit"
      style={styles.exit}
    >
      <Text style={styles.exitText}>Exit</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  blank: { flex: 1, backgroundColor: colors.bg },
  exit: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, backgroundColor: '#374151' },
  exitText: { color: colors.strong, fontWeight: '600' },
});
