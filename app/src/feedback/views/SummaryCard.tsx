import { StyleSheet, Text, View } from 'react-native';

import { radius, space, type, useTheme } from '../../ui/theme';
import type { Baseline, UtteranceSummary } from '../types.ts';
import type { PitchZone, Range } from '../zones.ts';
import { summaryLines } from './summaryText.ts';

/** One utterance's summary: where it landed and which way it moved (§2.5). */
export function SummaryCard({
  utterance,
  baseline,
  pitchZone,
  f2Zone,
}: {
  utterance: UtteranceSummary;
  baseline: Baseline | null;
  pitchZone: PitchZone | null;
  f2Zone: Range | null;
}) {
  const { c } = useTheme();
  const lines = summaryLines(utterance, { baseline, pitchZone, f2Zone });
  const colour = { neutral: c.ink, zone: c.zone, caution: c.dimBrightness, dim: c.inkMuted };
  return (
    <View style={[styles.card, { backgroundColor: c.surface200, borderColor: c.line }]} accessible>
      <Text style={[styles.overline, { color: c.inkMuted }]}>Last phrase</Text>
      {lines.map((l) => (
        <View key={l.label} style={styles.row}>
          <Text style={[styles.label, { color: c.inkMuted }]}>{l.label}</Text>
          <Text style={[styles.text, { color: colour[l.tone] }]}>{l.text}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: radius.lg, borderWidth: 1, padding: space[4], marginBottom: space[4] },
  overline: { ...type.label, textTransform: 'uppercase', letterSpacing: 1.1, marginBottom: space[2] },
  row: { marginBottom: space[2] },
  label: { ...type.label },
  text: { ...type.body },
});
