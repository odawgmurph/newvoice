import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { Body, Button, Caption, Card, Heading, Title } from '../ui/kit';
import { radius, space, type, useTheme } from '../ui/theme';
import {
  CHECK_IN_NONE,
  CHECK_IN_QUESTION,
  HARD_STOP_BODY,
  HARD_STOP_TITLE,
  REFERRAL_HOARSE,
  REFERRAL_NOTE,
  REFERRAL_TITLE,
  REFERRAL_URGENT,
  STOP_BUTTON,
  SYMPTOM_TEXT,
} from './copy';
import { SYMPTOMS, type Referral, type Symptom } from './rules';

/** A checklist of the stop-rule symptoms (handbook §2.4). */
function SymptomList({ value, onChange }: { value: Symptom[]; onChange: (s: Symptom[]) => void }) {
  const { c } = useTheme();
  return (
    <View>
      {SYMPTOMS.map((s) => {
        const on = value.includes(s);
        return (
          <Pressable
            key={s}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: on }}
            onPress={() => onChange(on ? value.filter((x) => x !== s) : [...value, s])}
            style={[styles.item, { borderColor: on ? c.stop : c.line, backgroundColor: c.surface200 }]}
          >
            <Text style={[type.body, { color: c.ink }]}>{(on ? '☑ ' : '☐ ') + SYMPTOM_TEXT[s]}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** The day's first check-in before voice practice. */
export function CheckIn({ onDone }: { onDone: (symptoms: Symptom[]) => void }) {
  const [picked, setPicked] = useState<Symptom[]>([]);
  return (
    <>
      <Title>How’s your voice?</Title>
      <Body>{CHECK_IN_QUESTION}</Body>
      <SymptomList value={picked} onChange={setPicked} />
      {picked.length ? <Button label="Continue" kind="danger" onPress={() => onDone(picked)} /> : <Button label={CHECK_IN_NONE} onPress={() => onDone([])} />}
    </>
  );
}

/** The stop button on voice exercises, with its symptom sheet. */
export function StopButton({ onStop }: { onStop: (symptoms: Symptom[]) => void }) {
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<Symptom[]>([]);
  const { c } = useTheme();
  return (
    <>
      <Button label={STOP_BUTTON} kind="danger" onPress={() => setOpen(true)} />
      <Modal visible={open} animationType="slide" transparent onRequestClose={() => setOpen(false)}>
        <View style={styles.scrim}>
          <View style={[styles.sheet, { backgroundColor: c.surface100, borderColor: c.stop }]}>
            <Title>What’s happening?</Title>
            <SymptomList value={picked} onChange={setPicked} />
            <Button
              label="Stop practice"
              kind="danger"
              onPress={() => {
                setOpen(false);
                onStop(picked.length ? picked : ['effort-rising']);
              }}
            />
            <Button label="Back" kind="quiet" onPress={() => setOpen(false)} />
          </View>
        </View>
      </Modal>
    </>
  );
}

export function ReferralCard({ referral }: { referral: Referral }) {
  const { c } = useTheme();
  if (!referral) return null;
  return (
    <View style={[styles.referral, { borderColor: c.stop, backgroundColor: c.surface200 }]}>
      <Heading>{REFERRAL_TITLE}</Heading>
      <Body>{referral.urgent ? REFERRAL_URGENT : REFERRAL_HOARSE}</Body>
      <Caption>{REFERRAL_NOTE}</Caption>
    </View>
  );
}

export function HardStop({ referral, onClose }: { referral: Referral; onClose: () => void }) {
  return (
    <>
      <Title>{HARD_STOP_TITLE}</Title>
      <ReferralCard referral={referral} />
      <Card>
        <Body>{HARD_STOP_BODY}</Body>
      </Card>
      <Button label="Back to home" onPress={onClose} />
    </>
  );
}

const styles = StyleSheet.create({
  item: { borderWidth: 2, borderRadius: radius.md, padding: space[3], marginBottom: space[2], minHeight: 44 },
  scrim: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.35)' },
  sheet: { borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, borderTopWidth: 4, padding: space[6], paddingBottom: space[12] },
  referral: { borderWidth: 2, borderRadius: radius.lg, padding: space[4], marginBottom: space[4] },
});
