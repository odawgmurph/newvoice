import { Redirect, router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { formatHz, isBaselineSummary, type BaselineSummary } from '../baseline/plan';
import { currentBaseline } from '../baseline/store';
import { CURRICULUM } from '../curriculum/content';
import { findLesson, nextLesson, progress, type UnitProgress } from '../curriculum/progress';
import { celebration, dailyXp, MAX_DAILY_XP, processMetrics, streak } from '../learning/motivation';
import { planSession, type SessionPlan } from '../learning/plan';
import { activityByDay, dayState, lessonSkill, loadAttempts, loadSkills, restDays, toRecord } from '../lesson/store';
import { dayKey, SAFETY } from '../safety/rules';
import { useApp, useDb } from '../state/AppState';
import { Body, Button, Caption, Card, ExitButton, Heading, Overline, Screen, Title } from '../ui/kit';
import { radius, space, type, useTheme } from '../ui/theme';

// Home: today's session plan, process metrics, and the unit path in the
// user's track order (Stages 5–6).

type HomeData = {
  baseline: { summary: BaselineSummary | null; completedAt: Date | null } | null;
  path: UnitProgress[];
  plan: SessionPlan;
  minutesToday: number;
  hardStop: boolean;
  streakDays: number;
  xpToday: number;
  cheer: string;
};

export default function Home() {
  const { user, quickExit } = useApp();
  const db = useDb();
  const { c } = useTheme();
  const [data, setData] = useState<HomeData | null>(null);

  useFocusEffect(
    useCallback(() => {
      let live = true;
      void (async () => {
        const row = await currentBaseline(db, user?.baselineId);
        const attempts = (await loadAttempts(db)).map(toRecord);
        const path = progress(CURRICULUM, user?.track ?? 'default', attempts, { baselineStored: user?.baselineId != null });
        const skills = await loadSkills(db);
        const day = await dayState(db);
        const activity = await activityByDay(db);
        const freeze = await restDays(db);
        const now = Date.now();
        const next = nextLesson(path);
        const doneLessons = path.flatMap((u) => u.lessons.filter((l) => l.status === 'done').map((l) => l.lesson));
        const skillRows = doneLessons
          .map((l) => ({ l, s: skills.get(lessonSkill(l.id)) }))
          .filter((x) => x.s != null && x.l.exercises.some((e) => e.pass.kind !== 'completion'))
          .map((x) => ({ skillId: x.l.id, memory: x.s!.memory, minutes: Math.min(x.l.minutes, 6) }));
        const plan = planSession(skillRows, next ? { lessonId: next.lesson.id, minutes: next.lesson.minutes } : null, day.voicedMinutesToday, now);
        const practiceDays = new Set([...activity.entries()].filter(([, a]) => a.voicedMinutes > 0 || a.listenTrials > 0 || a.lessonsDone > 0).map(([k]) => k));
        const s = streak({ practiceDays, freezeDays: freeze }, now);
        const minutesByDay = new Map([...activity.entries()].map(([k, a]) => [k, a.voicedMinutes]));
        const summary = row && isBaselineSummary(row.summary) ? row.summary : null;
        const metrics = processMetrics(minutesByDay, summary?.comfortableRange ? [summary.comfortableRange.spanSt] : [], now);
        const today = activity.get(dayKey(now)) ?? { voicedMinutes: 0, listenTrials: 0, lessonsDone: 0 };
        if (!live) return;
        setData({
          baseline: row ? { summary, completedAt: row.completedAt } : null,
          path,
          plan,
          minutesToday: day.voicedMinutesToday,
          hardStop: day.hardStopToday,
          streakDays: s.days,
          xpToday: dailyXp(today),
          cheer: celebration(metrics, s.days),
        });
      })();
      return () => {
        live = false;
      };
    }, [db, user?.baselineId, user?.track]),
  );

  if (!user?.onboardedAt) return <Redirect href="/onboarding" />;

  const open = (lessonId: string, refresher = false) =>
    router.push({ pathname: '/lesson/[id]', params: refresher ? { id: lessonId, refresher: '1' } : { id: lessonId } });
  const speaking = data?.baseline?.summary?.speaking;
  const provisional = user.baselineId != null && data?.baseline != null && data.baseline.summary == null;

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
      <Overline>Today</Overline>
      <Card>
        {data?.hardStop ? (
          <>
            <Heading>Voice rest today</Heading>
            <Body>Voice practice is off until tomorrow. Listening lessons and your journal are still open.</Body>
            <Button label="Voice care" kind="secondary" onPress={() => router.push('/voice-care')} />
          </>
        ) : data && (data.plan.lesson || data.plan.refreshers.length) ? (
          <>
            {data.plan.refreshers.map((id) => (
              <Button key={id} label={`Refresh: ${findLesson(CURRICULUM, id)?.lesson.title ?? id}`} kind="secondary" onPress={() => open(id, true)} />
            ))}
            {data.plan.lesson ? <Button label={`Next: ${findLesson(CURRICULUM, data.plan.lesson)?.lesson.title}`} onPress={() => open(data.plan.lesson!)} /> : null}
            <Caption>About {data.plan.minutes} minutes, warm-up and cool-down included.</Caption>
          </>
        ) : data && data.minutesToday >= SAFETY.dailyMaxMin ? (
          <Body>That’s today’s voice practice. Rest well.</Body>
        ) : (
          <Body>Nothing due right now. Free practice and listening are always open.</Body>
        )}
        {data ? (
          <View style={styles.stats}>
            <Stat label="Voice today" value={`${Math.round(data.minutesToday)} / ${SAFETY.dailyMaxMin} min`} />
            <Stat label="Streak" value={`${data.streakDays} days`} />
            <Stat label="XP today" value={`${data.xpToday} / ${MAX_DAILY_XP}`} />
          </View>
        ) : null}
        {data ? <Caption>{data.cheer}</Caption> : null}
      </Card>

      {user.baselineId == null || provisional ? (
        <Card>
          <Heading>Your starting point</Heading>
          <Body>Six short recordings, about five minutes. Everything you practise is measured against them.</Body>
          {provisional ? <Caption>You’re using a starting point from a practice session for now.</Caption> : null}
          <Button label="Record your starting point" onPress={() => router.push('/baseline')} />
        </Card>
      ) : null}

      <Overline>Your path</Overline>
      {data?.path.map((u) => <UnitRow key={u.unit.id} u={u} onOpen={(id) => open(id)} />)}

      <Overline>More</Overline>
      <Card>
        <Button label="Free practice" kind="secondary" onPress={() => router.push('/practice')} />
        <Button label="Journal" kind="secondary" onPress={() => router.push('/journal')} />
        <Button label="Progress" kind="secondary" onPress={() => router.push('/progress')} />
        <Button label="Voice care" kind="secondary" onPress={() => router.push('/voice-care')} />
        <Button label="How the numbers work" kind="secondary" onPress={() => router.push('/about-numbers')} />
        {speaking ? <Caption>Starting point: everyday pitch {formatHz(speaking.medianHz)}. {data?.baseline?.completedAt ? `Recorded ${data.baseline.completedAt.toLocaleDateString()}.` : ''}</Caption> : null}
        {user.baselineId != null && !provisional ? <Button label="Record your starting point again" kind="quiet" onPress={() => router.push('/baseline')} /> : null}
        {user.developerTools ? <Button label="Capture test" kind="quiet" onPress={() => router.push('/capture')} /> : null}
      </Card>
      <Button label="Settings" kind="secondary" onPress={() => router.push('/settings')} />
    </Screen>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  const { c } = useTheme();
  return (
    <View style={styles.stat}>
      <Text style={[type.label, { color: c.inkMuted }]}>{label}</Text>
      <Text style={[type.readoutSm, { color: c.ink }]}>{value}</Text>
    </View>
  );
}

const STATUS_TEXT = { locked: 'Locked', open: 'Open', complete: 'Complete' } as const;

function UnitRow({ u, onOpen }: { u: UnitProgress; onOpen: (lessonId: string) => void }) {
  const { c } = useTheme();
  const [expanded, setExpanded] = useState(u.status === 'open');
  return (
    <View style={[styles.unit, { borderColor: u.status === 'open' ? c.brand : c.line, backgroundColor: c.surface200, opacity: u.status === 'locked' ? 0.6 : 1 }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded, disabled: u.status === 'locked' }}
        accessibilityLabel={`Unit ${u.unit.number}, ${u.unit.title}, ${STATUS_TEXT[u.status]}`}
        disabled={u.status === 'locked'}
        onPress={() => setExpanded(!expanded)}
      >
        <Text style={[type.label, { color: c.inkMuted }]}>
          Unit {u.unit.number} · {STATUS_TEXT[u.status]}
        </Text>
        <Title>{u.unit.title}</Title>
        <Caption>{u.unit.summary}</Caption>
      </Pressable>
      {expanded && u.status !== 'locked'
        ? u.lessons.map((l) => (
            <Pressable
              key={l.lesson.id}
              accessibilityRole="button"
              accessibilityState={{ disabled: l.status === 'locked' }}
              disabled={l.status === 'locked'}
              onPress={() => onOpen(l.lesson.id)}
              style={[styles.lesson, { borderColor: c.line }]}
            >
              <Text style={[type.body, { color: l.status === 'locked' ? c.inkMuted : c.ink }]}>
                {l.status === 'done' ? '✓ ' : l.status === 'locked' ? '· ' : '→ '}
                {l.lesson.title}
                {l.lesson.checkpoint ? ' (checkpoint)' : ''}
              </Text>
              <Text style={[type.caption, { color: c.inkMuted }]}>{l.lesson.minutes} min</Text>
            </Pressable>
          ))
        : null}
    </View>
  );
}

const styles = StyleSheet.create({
  brand: { ...type.title, fontSize: 24, lineHeight: 30 },
  stats: { flexDirection: 'row', gap: space[2], marginVertical: space[3] },
  stat: { flex: 1 },
  unit: { borderWidth: 2, borderRadius: radius.lg, padding: space[4], marginBottom: space[3] },
  lesson: { flexDirection: 'row', justifyContent: 'space-between', borderTopWidth: 1, paddingVertical: space[3], minHeight: 44 },
});
