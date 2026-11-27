import { eq } from 'drizzle-orm';
import { createAudioPlayer, setAudioModeAsync } from 'expo-audio';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import { completedBaselines } from '../baseline/store';
import { CURRICULUM } from '../curriculum/content';
import { progress } from '../curriculum/progress';
import { user as userTable } from '../db/schema';
import { processMetrics, streak } from '../learning/motivation';
import { activityByDay, loadAttempts, restDays, toRecord } from '../lesson/store';
import { compareBaselines } from '../progress/compare';
import { useApp, useDb } from '../state/AppState';
import { Body, Button, Caption, Card, Heading, Screen, Toggle } from '../ui/kit';

// Progress (Stage 6–7): process metrics first (§2.7: celebrate minutes,
// consistency, range comfort), then, only if the user opts in, how their
// starting points compare over time. Listening back to old recordings is a
// further opt-in (playback, §2.7) and only for audio the user chose to keep.

type Data = {
  minutesThisWeek: number;
  days: number;
  streakDays: number;
  unitsDone: number;
  baselines: Awaited<ReturnType<typeof completedBaselines>>;
};

export default function ProgressScreen() {
  const db = useDb();
  const { user, refreshUser } = useApp();
  const [data, setData] = useState<Data | null>(null);

  useFocusEffect(
    useCallback(() => {
      void (async () => {
        const activity = await activityByDay(db);
        const now = Date.now();
        const minutes = new Map([...activity.entries()].map(([k, a]) => [k, a.voicedMinutes]));
        const baselines = await completedBaselines(db);
        const m = processMetrics(minutes, baselines.map((b) => b.summary.comfortableRange?.spanSt ?? 0).filter((x) => x > 0), now);
        const practiceDays = new Set([...activity.entries()].filter(([, a]) => a.voicedMinutes + a.listenTrials + a.lessonsDone > 0).map(([k]) => k));
        const s = streak({ practiceDays, freezeDays: await restDays(db) }, now);
        const p = progress(CURRICULUM, user?.track ?? 'default', (await loadAttempts(db)).map(toRecord), { baselineStored: user?.baselineId != null });
        setData({ minutesThisWeek: m.minutesThisWeek, days: m.daysPractisedLast7, streakDays: s.days, unitsDone: p.filter((u) => u.status === 'complete').length, baselines });
      })();
    }, [db, user?.track, user?.baselineId]),
  );

  const optIn = async (on: boolean) => {
    await db.update(userTable).set({ progressTimeline: on }).where(eq(userTable.id, 1));
    await refreshUser();
  };

  const listen = async (uri: string) => {
    await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: false });
    const p = createAudioPlayer({ uri });
    p.addListener('playbackStatusUpdate', (s) => s.didJustFinish && p.remove());
    p.play();
  };

  const first = data?.baselines[0];
  const latest = data?.baselines[data.baselines.length - 1];
  return (
    <Screen>
      <Heading>Practice</Heading>
      <Card>
        <Body>{data ? `${data.minutesThisWeek} minutes of voice practice this week, on ${data.days} of the last 7 days.` : ' '}</Body>
        <Body>{data ? `Streak: ${data.streakDays} days (rest days count).` : ' '}</Body>
        <Body>{data ? `Units complete: ${data.unitsDone} of ${CURRICULUM.units.length}.` : ' '}</Body>
      </Card>

      <Heading>Your starting points over time</Heading>
      <Card>
        <Toggle label="Compare my starting points" value={user?.progressTimeline ?? false} onChange={(on) => void optIn(on)} />
        <Caption>Off by default. Numbers only; nothing plays unless you ask.</Caption>
        {user?.progressTimeline ? (
          first && latest && first.id !== latest.id ? (
            <>
              <Caption>
                {first.completedAt.toLocaleDateString()} → {latest.completedAt.toLocaleDateString()}
              </Caption>
              {compareBaselines(first.summary, latest.summary).map((l) => (
                <Body key={l.label}>
                  {l.label}: {l.text}
                </Body>
              ))}
              {user.playbackEnabled
                ? (['baseline.reading', 'baseline.vowel.a'] as const).map((task) =>
                    first.audio[task] && latest.audio[task] ? (
                      <Card key={task}>
                        <Caption>{task === 'baseline.reading' ? 'Reading' : '“ah”'}: listen to each</Caption>
                        <Button label={`First (${first.completedAt.toLocaleDateString()})`} kind="secondary" onPress={() => void listen(first.audio[task])} />
                        <Button label={`Latest (${latest.completedAt.toLocaleDateString()})`} kind="secondary" onPress={() => void listen(latest.audio[task])} />
                      </Card>
                    ) : null,
                  )
                : null}
            </>
          ) : (
            <Body muted>Record your starting point again in a few weeks to compare. One recording is stored so far.</Body>
          )
        ) : null}
      </Card>
    </Screen>
  );
}
