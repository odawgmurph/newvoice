import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { Body, Bullet, Button, Caption, Title } from '../../ui/kit';
import { radius, space, type, useTheme } from '../../ui/theme';
import type { StrainReason } from '../strain.ts';
import { EFFORT_QUESTION, reasonLines, REST_BODY, REST_TITLE, STOP_RULES } from './restCopy.ts';

/** Self-reported effort, 0–10 (handbook §2.4: ≥ 6 asks for a rest). */
export function EffortPicker({ value, onPick }: { value: number | null; onPick: (rating: number) => void }) {
  const { c } = useTheme();
  return (
    <View>
      <Caption>{EFFORT_QUESTION}</Caption>
      <View style={styles.effortRow} accessibilityRole="radiogroup">
        {Array.from({ length: 11 }, (_, n) => {
          const on = value === n;
          return (
            <Pressable
              key={n}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
              accessibilityLabel={`Effort ${n} of 10`}
              onPress={() => onPick(n)}
              style={[
                styles.effort,
                { borderColor: on ? c.brand : c.line, backgroundColor: on ? c.brandTint : c.surface200 },
              ]}
            >
              <Text style={[styles.effortText, { color: c.ink }]}>{n}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/**
 * The strain monitor's rest prompt (§2.4: any warning sign triggers a rest
 * prompt). It names the signs in plain words and gives the stop rules. The
 * microphone is already off while it shows.
 */
export function RestPrompt({ reasons, onRested }: { reasons: StrainReason[]; onRested: () => void }) {
  const { c } = useTheme();
  return (
    <Modal visible={reasons.length > 0} animationType="slide" transparent onRequestClose={onRested}>
      <View style={styles.scrim}>
        <View style={[styles.sheet, { backgroundColor: c.surface100, borderColor: c.rest }]}>
          <Title>{REST_TITLE}</Title>
          {reasonLines(reasons).map((line) => (
            <Bullet key={line}>{line}</Bullet>
          ))}
          <Body>{REST_BODY}</Body>
          <View style={[styles.stop, { backgroundColor: c.restTint }]}>
            <Text style={[type.body, { color: c.ink }]}>{STOP_RULES}</Text>
          </View>
          <Button label="I’ve rested" onPress={onRested} />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  effortRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space[1] },
  effort: {
    minWidth: 40,
    minHeight: 44,
    borderRadius: radius.sm,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  effortText: { ...type.readoutSm },
  scrim: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.35)' },
  sheet: {
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    borderTopWidth: 4,
    padding: space[6],
    paddingBottom: space[12],
  },
  stop: { borderRadius: radius.md, padding: space[4], marginVertical: space[2] },
});
