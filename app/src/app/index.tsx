import { Redirect, router } from 'expo-router';
import { StyleSheet, Text } from 'react-native';

import { useApp } from '../state/AppState';
import { Body, Button, Card, ExitButton, Overline, Screen, Title } from '../ui/kit';
import { type, useTheme } from '../ui/theme';

// Home. The design's lesson path, today's minutes and tab bar arrive with
// lessons (Stages 5–6); until then this links to what exists.
export default function Home() {
  const { user, quickExit } = useApp();
  const { c } = useTheme();
  if (!user?.onboardedAt) return <Redirect href="/onboarding" />;

  return (
    <Screen
      edges={['top', 'bottom']}
      header={
        <>
          <Text style={[styles.brand, { color: c.brand }]}>NewVoice</Text>
          <ExitButton onPress={quickExit} />
        </>
      }
    >
      <Overline>Coming next</Overline>
      <Title>Lessons</Title>
      <Card>
        <Body>The lesson path arrives in a later stage. For now you can try the live trace.</Body>
        <Button label="Live pitch and resonance trace" onPress={() => router.push('/capture')} />
      </Card>
      <Button label="Settings" kind="secondary" onPress={() => router.push('/settings')} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  brand: { ...type.title, fontSize: 24, lineHeight: 30 },
});
