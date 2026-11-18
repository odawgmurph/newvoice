import type { ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';

// Small shared UI kit, matching the capture spike's dark palette.

export const colors = {
  bg: '#0b1120',
  panel: '#111827',
  border: '#1f2937',
  text: '#e5e7eb',
  strong: '#f9fafb',
  muted: '#9ca3af',
  faint: '#6b7280',
  accent: '#0284c7',
  accentSoft: '#0c4a6e',
  danger: '#b91c1c',
  dangerText: '#fca5a5',
};

export function Screen({ children, scroll = true }: { children: ReactNode; scroll?: boolean }) {
  if (!scroll) return <View style={[styles.screen, styles.pad]}>{children}</View>;
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.pad} keyboardShouldPersistTaps="handled">
      {children}
    </ScrollView>
  );
}

export function Title({ children }: { children: ReactNode }) {
  return <Text style={styles.title}>{children}</Text>;
}

export function Heading({ children }: { children: ReactNode }) {
  return <Text style={styles.heading}>{children}</Text>;
}

export function Body({ children, muted = false }: { children: ReactNode; muted?: boolean }) {
  return <Text style={[styles.body, muted && styles.muted]}>{children}</Text>;
}

export function Bullet({ children }: { children: ReactNode }) {
  return (
    <View style={styles.bulletRow}>
      <Text style={styles.body}>•</Text>
      <Text style={[styles.body, styles.bulletText]}>{children}</Text>
    </View>
  );
}

type ButtonKind = 'primary' | 'secondary' | 'danger';

export function Button({
  label,
  onPress,
  kind = 'primary',
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  kind?: ButtonKind;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        kind === 'secondary' && styles.buttonSecondary,
        kind === 'danger' && styles.buttonDanger,
        (pressed || disabled) && styles.dimmed,
      ]}
    >
      <Text style={styles.buttonText}>{label}</Text>
    </Pressable>
  );
}

export function Choice({
  label,
  detail,
  selected,
  onPress,
}: {
  label: string;
  detail?: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[styles.choice, selected && styles.choiceSelected]}
    >
      <Text style={styles.choiceLabel}>{label}</Text>
      {detail ? <Text style={styles.choiceDetail}>{detail}</Text> : null}
    </Pressable>
  );
}

export function Field(props: TextInputProps) {
  return <TextInput placeholderTextColor={colors.faint} {...props} style={[styles.field, props.style]} />;
}

export function Panel({ children }: { children: ReactNode }) {
  return <View style={styles.panel}>{children}</View>;
}

export function Gap({ size = 12 }: { size?: number }) {
  return <View style={{ height: size }} />;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  pad: { padding: 16, paddingBottom: 48, flexGrow: 1 },
  title: { color: colors.strong, fontSize: 24, fontWeight: '700', marginBottom: 12 },
  heading: { color: colors.text, fontSize: 17, fontWeight: '600', marginTop: 16, marginBottom: 8 },
  body: { color: colors.text, fontSize: 16, lineHeight: 23, marginBottom: 8 },
  muted: { color: colors.muted, fontSize: 14, lineHeight: 20 },
  bulletRow: { flexDirection: 'row', gap: 8 },
  bulletText: { flex: 1 },
  button: { backgroundColor: colors.accent, borderRadius: 10, paddingVertical: 14, alignItems: 'center', marginTop: 8 },
  buttonSecondary: { backgroundColor: '#374151' },
  buttonDanger: { backgroundColor: colors.danger },
  buttonText: { color: '#fff', fontSize: 17, fontWeight: '600' },
  dimmed: { opacity: 0.6 },
  choice: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.panel,
    borderRadius: 10,
    padding: 14,
    marginBottom: 8,
  },
  choiceSelected: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  choiceLabel: { color: colors.strong, fontSize: 16, fontWeight: '600' },
  choiceDetail: { color: colors.muted, fontSize: 14, marginTop: 4, lineHeight: 19 },
  field: {
    backgroundColor: colors.panel,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 10,
    color: colors.strong,
    fontSize: 17,
    padding: 12,
    marginBottom: 8,
  },
  panel: { backgroundColor: colors.panel, borderRadius: 10, padding: 14, marginBottom: 12 },
});
