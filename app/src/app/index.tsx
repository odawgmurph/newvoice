import { Redirect, router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, Text } from 'react-native';

import { formatHz, type BaselineSummary } from '../baseline/plan';
import { currentBaseline } from '../baseline/store';
import { useApp, useDb } from '../state/AppState';
import { Body, Button, Caption, Card, ExitButton, Overline, Screen, Title } from '../ui/kit';
import { type, useTheme } from '../ui/theme';

// Home. The design's lesson path, today's minutes and tab bar arrive with
// lessons (Stages 5–6); until then this links to what exists.
export default function Home() {
  const { user, quickExit } = useApp();
  const db = useDb();
  const { c } = useTheme();
  const [baseline, setBaseline] = useState<{ summary: BaselineSummary | null; completedAt: Date | null } | null>(null);

  useFocusEffect(
    useCallback(() => {
      let live = true;
      void currentBaseline(db, user?.baselineId).then((row) => {
        if (live) setBaseline(row ? { summary: row.summary as BaselineSummary | null, completedAt: row.completedAt } : null);
      });
      return () => {
        live = false;
      };
    }, [db, user?.baselineId]),
  );

  if (!user?.onboardedAt) return <Redirect href="/onboarding" />;

  const speaking = baseline?.summary?.speaking;
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
      {user.baselineId == null ? (
        <>
          <Overline>First step</Overline>
          <Title>Your starting point</Title>
          <Card>
            <Body>
              Six short recordings, about five minutes. Everything you practise is measured against them.
            </Body>
            <Button label="Record your starting point" onPress={() => router.push('/baseline')} />
          </Card>
        </>
      ) : (
        <>
          <Overline>Your starting point</Overline>
          <Card>
            {speaking ? <Body>Everyday speaking pitch: {formatHz(speaking.medianHz)}</Body> : null}
            {baseline?.completedAt ? <Caption>Recorded {baseline.completedAt.toLocaleDateString()}</Caption> : null}
            <Button label="Record it again" kind="secondary" onPress={() => router.push('/baseline')} />
          </Card>
        </>
      )}
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
