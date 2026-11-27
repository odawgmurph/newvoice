import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import { markRestDay, symptomHistory } from '../lesson/store';
import { ReferralCard } from '../safety/SafetyViews';
import { referral, type Referral } from '../safety/rules';
import { useDb } from '../state/AppState';
import { Body, Bullet, Button, Caption, Card, Heading, Screen } from '../ui/kit';

// Voice care (handbook §2.4): the stop rules, rest days that keep a streak
// (§4.2 streak freeze), and the referral card when it applies.

export default function VoiceCare() {
  const db = useDb();
  const [ref, setRef] = useState<Referral>(null);
  const [marked, setMarked] = useState<string | null>(null);
  useFocusEffect(useCallback(() => void symptomHistory(db).then((h) => setRef(referral(h, Date.now()))), [db]));
  const mark = async (reason: 'voice-rest' | 'illness') => {
    await markRestDay(db, reason);
    setMarked(reason === 'illness' ? 'Today is marked as a sick day. Your streak is safe.' : 'Today is marked as a rest day. Your streak is safe.');
  };
  return (
    <Screen>
      <ReferralCard referral={ref} />
      <Heading>Every session</Heading>
      <Card>
        <Bullet>Warm up for three minutes first and cool down after. The app does this with you.</Bullet>
        <Bullet>Keep sessions short, about 20 minutes, and no more than an hour a day.</Bullet>
        <Bullet>Sip water. Rest between exercises if anything feels effortful.</Bullet>
        <Bullet>Light is not breathy, and higher is not squeezed. If it feels tight, back off.</Bullet>
      </Card>
      <Heading>Stop for today if</Heading>
      <Card>
        <Bullet>it hurts to speak or practise</Bullet>
        <Bullet>your throat feels raw or scratchy</Bullet>
        <Bullet>you sound hoarse afterwards, or your voice cuts out</Bullet>
        <Bullet>you can’t reach notes you usually can</Bullet>
        <Caption>
          If hoarseness lasts more than about two weeks, speaking hurts, or you see blood, see an ear, nose and throat
          specialist (ENT) or a laryngologist, and a speech-language pathologist.
        </Caption>
      </Card>
      <Heading>Taking a break</Heading>
      <Card>
        <Body>Unwell, or your voice needs a rest? Mark today and your streak won’t break.</Body>
        <Button label="Today is a voice rest day" kind="secondary" onPress={() => void mark('voice-rest')} />
        <Button label="I’m unwell today" kind="secondary" onPress={() => void mark('illness')} />
        {marked ? <Caption>{marked}</Caption> : null}
      </Card>
      <Caption>NewVoice is an education app. It can’t tell what is causing a voice problem.</Caption>
    </Screen>
  );
}
