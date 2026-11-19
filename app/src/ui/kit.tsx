import { useMemo, useState, type ReactNode } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { radius, space, type, useTheme, type Colors } from './theme';

// Shared UI built on the NewVoice design system (theme.ts). Components mirror
// the design canvas's bundle: nv-btn, nv-exit, nv-progress, the onboarding
// radio cards and raised cards.

function useStyles() {
  const { c } = useTheme();
  return useMemo(() => makeStyles(c), [c]);
}

/**
 * A screen on surface-100. `header` sits above the scrolling content and
 * `footer` is pinned below it (a primary action, as in the onboarding board).
 * Pass `edges` for the safe-area sides this screen must pad itself (screens
 * under the navigation header don't need the top).
 */
export function Screen({
  children,
  header,
  footer,
  scroll = true,
  edges = ['bottom'],
}: {
  children: ReactNode;
  header?: ReactNode;
  footer?: ReactNode;
  scroll?: boolean;
  edges?: ('top' | 'bottom')[];
}) {
  const s = useStyles();
  const insets = useSafeAreaInsets();
  const top = edges.includes('top') ? insets.top : 0;
  const bottom = edges.includes('bottom') ? insets.bottom : 0;
  const body = scroll ? (
    <ScrollView style={s.flex} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
      {children}
    </ScrollView>
  ) : (
    <View style={[s.flex, s.content]}>{children}</View>
  );
  return (
    <View style={[s.screen, { paddingTop: top }]}>
      {header ? <View style={s.header}>{header}</View> : null}
      {body}
      {footer ? <View style={[s.footer, { paddingBottom: bottom + space[6] }]}>{footer}</View> : null}
      {!footer && bottom > 0 ? <View style={{ height: bottom }} /> : null}
    </View>
  );
}

export function Display({ children }: { children: ReactNode }) {
  const s = useStyles();
  return (
    <Text accessibilityRole="header" style={s.display}>
      {children}
    </Text>
  );
}

export function Title({ children }: { children: ReactNode }) {
  const s = useStyles();
  return (
    <Text accessibilityRole="header" style={s.title}>
      {children}
    </Text>
  );
}

export function Heading({ children }: { children: ReactNode }) {
  const s = useStyles();
  return (
    <Text accessibilityRole="header" style={s.heading}>
      {children}
    </Text>
  );
}

export function Overline({ children }: { children: ReactNode }) {
  const s = useStyles();
  return <Text style={s.overline}>{children}</Text>;
}

export function Body({ children, muted = false }: { children: ReactNode; muted?: boolean }) {
  const s = useStyles();
  return <Text style={[s.body, muted && s.muted]}>{children}</Text>;
}

export function Caption({ children }: { children: ReactNode }) {
  const s = useStyles();
  return <Text style={s.caption}>{children}</Text>;
}

/** An error or warning line, in the stop colour (always words, never colour alone). */
export function ErrorText({ children }: { children: ReactNode }) {
  const s = useStyles();
  return (
    <Text accessibilityRole="alert" style={s.error}>
      {children}
    </Text>
  );
}

/** A labelled switch row. */
export function Toggle({
  label,
  value,
  onChange,
  disabled = false,
}: {
  label: string;
  value: boolean;
  onChange: (on: boolean) => void;
  disabled?: boolean;
}) {
  const s = useStyles();
  const { c } = useTheme();
  return (
    <View style={[s.toggle, disabled && s.toggleDisabled]}>
      <Text style={[s.body, s.flex, s.noMargin]}>{label}</Text>
      <Switch
        value={value}
        onValueChange={onChange}
        disabled={disabled}
        accessibilityLabel={label}
        trackColor={{ true: c.zone, false: c.surface300 }}
        ios_backgroundColor={c.surface300}
      />
    </View>
  );
}

export function Bullet({ children }: { children: ReactNode }) {
  const s = useStyles();
  return (
    <View style={s.bulletRow}>
      <View style={s.bulletDot} />
      <Text style={[s.body, s.flex]}>{children}</Text>
    </View>
  );
}

type ButtonKind = 'primary' | 'secondary' | 'quiet' | 'danger';

/** nv-btn. The primary button sits on a ledge (shadow-press) that collapses when pressed. */
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
  const s = useStyles();
  const [pressed, setPressed] = useState(false);
  const ledge = kind === 'primary' && !disabled;
  return (
    <View style={[s.buttonWrap, ledge && s.ledge]}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={onPress}
        onPressIn={() => setPressed(true)}
        onPressOut={() => setPressed(false)}
        style={[
          s.button,
          kind === 'primary' && s.buttonPrimary,
          kind === 'secondary' && s.buttonSecondary,
          kind === 'quiet' && s.buttonQuiet,
          kind === 'danger' && s.buttonDanger,
          disabled && s.buttonDisabled,
          ledge && { transform: [{ translateY: pressed ? 4 : 0 }] },
          !ledge && pressed && s.pressed,
        ]}
      >
        <Text
          style={[
            s.buttonText,
            kind === 'primary' && s.onBrand,
            kind === 'quiet' && s.brandText,
            kind === 'danger' && s.stopText,
            disabled && s.muted,
          ]}
        >
          {label}
        </Text>
      </Pressable>
    </View>
  );
}

/** A radio card: label, optional hint, and a dot on the right (onboarding board). */
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
  const s = useStyles();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[s.choice, selected && s.choiceSelected]}
    >
      <View style={s.flex}>
        <Text style={s.choiceLabel}>{label}</Text>
        {detail ? <Text style={s.choiceDetail}>{detail}</Text> : null}
      </View>
      <View style={[s.radio, selected && s.radioOn]} />
    </Pressable>
  );
}

export function Field(props: TextInputProps) {
  const s = useStyles();
  const { c } = useTheme();
  return <TextInput placeholderTextColor={c.inkMuted} {...props} style={[s.field, props.style]} />;
}

/** A raised card (surface-200, radius-lg, shadow-card). */
export function Card({ children }: { children: ReactNode }) {
  const s = useStyles();
  return <View style={s.card}>{children}</View>;
}

export function Gap({ size = space[3] }: { size?: number }) {
  return <View style={{ height: size }} />;
}

/** nv-exit: the quick-exit pill, on every screen. */
export function ExitButton({ onPress }: { onPress: () => void }) {
  const s = useStyles();
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel="Quick exit"
      style={({ pressed }) => [s.exit, pressed && s.pressed]}
    >
      <View style={s.cross} accessible={false}>
        <View style={[s.crossBar, { transform: [{ rotate: '45deg' }] }]} />
        <View style={[s.crossBar, { transform: [{ rotate: '-45deg' }] }]} />
      </View>
      <Text style={s.exitText}>Exit</Text>
    </Pressable>
  );
}

export function BackButton({ onPress }: { onPress: () => void }) {
  const s = useStyles();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="Back"
      style={({ pressed }) => [s.back, pressed && s.pressed]}
    >
      <View style={s.chevron} />
    </Pressable>
  );
}

/** Onboarding progress: one pill per step, filled up to the current one. */
export function StepDots({ count, current }: { count: number; current: number }) {
  const s = useStyles();
  return (
    <View style={s.dots} accessible accessibilityLabel={`Step ${current + 1} of ${count}`}>
      {Array.from({ length: count }, (_, i) => (
        <View key={i} style={[s.dot, i <= current && s.dotOn]} />
      ))}
    </View>
  );
}

function makeStyles(c: Colors) {
  return StyleSheet.create({
    flex: { flex: 1 },
    screen: { flex: 1, backgroundColor: c.surface100 },
    header: {
      height: 44,
      marginTop: space[4],
      paddingHorizontal: space[6],
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    content: { paddingHorizontal: space[6], paddingTop: space[4], paddingBottom: space[8], flexGrow: 1 },
    footer: { paddingHorizontal: space[6], paddingTop: space[3] },

    display: { ...type.display, color: c.ink, marginBottom: space[3] },
    title: { ...type.title, color: c.ink, marginBottom: space[3] },
    heading: { ...type.heading, color: c.ink, marginTop: space[6], marginBottom: space[2] },
    overline: { ...type.label, letterSpacing: 1.1, textTransform: 'uppercase', color: c.inkMuted, marginBottom: space[1] },
    body: { ...type.body, color: c.ink, marginBottom: space[2] },
    muted: { color: c.inkMuted },
    caption: { ...type.caption, color: c.inkMuted, marginBottom: space[2] },
    error: { ...type.bodyStrong, color: c.stop, marginBottom: space[2] },
    noMargin: { marginBottom: 0 },
    toggle: { flexDirection: 'row', alignItems: 'center', gap: space[3], minHeight: 48, paddingVertical: space[1] },
    toggleDisabled: { opacity: 0.5 },
    bulletRow: { flexDirection: 'row', gap: space[3], alignItems: 'flex-start' },
    bulletDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: c.inkMuted, marginTop: 9 },

    buttonWrap: { marginTop: space[3], borderRadius: radius.md },
    ledge: { backgroundColor: c.press, paddingBottom: 4 },
    button: {
      minHeight: 48,
      borderRadius: radius.md,
      paddingVertical: space[3],
      paddingHorizontal: space[6],
      alignItems: 'center',
      justifyContent: 'center',
    },
    buttonPrimary: { backgroundColor: c.brand },
    buttonSecondary: { backgroundColor: c.surface200, borderWidth: 2, borderColor: c.lineControl },
    buttonQuiet: { backgroundColor: 'transparent' },
    buttonDanger: { backgroundColor: c.surface200, borderWidth: 2, borderColor: c.stop },
    buttonDisabled: { backgroundColor: c.surface300, borderColor: c.surface300 },
    buttonText: { ...type.bodyStrong, color: c.ink },
    onBrand: { color: c.onBrand },
    brandText: { color: c.brand },
    stopText: { color: c.stop },
    pressed: { opacity: 0.7 },

    choice: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: space[3],
      minHeight: 72,
      paddingVertical: 14,
      paddingHorizontal: space[4],
      borderRadius: radius.md,
      borderWidth: 2,
      borderColor: c.line,
      backgroundColor: c.surface200,
      marginBottom: space[3],
    },
    choiceSelected: { borderColor: c.brand, backgroundColor: c.brandTint },
    choiceLabel: { ...type.bodyStrong, color: c.ink },
    choiceDetail: { ...type.caption, fontSize: 14, lineHeight: 20, color: c.inkMuted, marginTop: 2 },
    radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: c.lineControl },
    radioOn: { borderWidth: 7, borderColor: c.brand, backgroundColor: c.surface200 },

    field: {
      ...type.body,
      backgroundColor: c.surface200,
      borderColor: c.lineControl,
      borderWidth: 2,
      borderRadius: radius.md,
      color: c.ink,
      minHeight: 48,
      paddingHorizontal: space[4],
      paddingVertical: space[3],
      marginBottom: space[2],
    },

    card: {
      backgroundColor: c.surface200,
      borderRadius: radius.lg,
      padding: space[4],
      marginBottom: space[4],
      shadowColor: c.cardShadow.color,
      shadowOpacity: c.cardShadow.opacity,
      shadowRadius: 10,
      shadowOffset: { width: 0, height: 4 },
      elevation: 2,
    },

    exit: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: space[1],
      minHeight: 36,
      paddingHorizontal: space[3],
      borderRadius: radius.pill,
      borderWidth: 1.5,
      borderColor: c.lineControl,
      backgroundColor: c.surface200,
    },
    exitText: { ...type.label, color: c.ink },
    cross: { width: 16, height: 16, alignItems: 'center', justifyContent: 'center' },
    crossBar: { position: 'absolute', width: 14, height: 2.5, borderRadius: 2, backgroundColor: c.ink },

    back: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', marginLeft: -space[3] },
    chevron: {
      width: 13,
      height: 13,
      borderLeftWidth: 2.5,
      borderBottomWidth: 2.5,
      borderColor: c.ink,
      transform: [{ rotate: '45deg' }],
      marginLeft: 4,
    },

    dots: { flexDirection: 'row', gap: 6 },
    dot: { width: 18, height: 6, borderRadius: radius.pill, backgroundColor: c.surface300 },
    dotOn: { backgroundColor: c.brand },
  });
}
