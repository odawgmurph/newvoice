import { Redirect, router } from 'expo-router';

import { useApp } from '../state/AppState';
import { Body, Button, Gap, Panel, Screen, Title } from '../ui/kit';

export default function Home() {
  const { user } = useApp();
  if (!user?.onboardedAt) return <Redirect href="/onboarding" />;

  return (
    <Screen>
      <Title>Practice</Title>
      <Panel>
        <Body>Lessons arrive in a later stage. For now you can try the live trace.</Body>
        <Button label="Live pitch and resonance trace" onPress={() => router.push('/capture')} />
      </Panel>
      <Gap />
      <Button label="Settings" kind="secondary" onPress={() => router.push('/settings')} />
    </Screen>
  );
}
