import { useColorScheme, type TextStyle } from 'react-native';

// The NewVoice design system (the "NewVoice — Sample UI" design canvas,
// tokens.json version 1), translated to React Native. Change values there
// first, then here. Light and dark follow the phone's setting.

const light = {
  surface100: '#f8f4ef',
  surface200: '#fffdfa',
  surface300: '#efe8e0',
  line: '#ddd3c8',
  lineControl: '#8c8090',
  ink: '#241d26',
  inkMuted: '#665b68',
  brand: '#b0442b',
  onBrand: '#ffffff',
  brandTint: '#f8e1d7',
  zone: '#146b64',
  onZone: '#ffffff',
  zoneTint: '#d5ece8',
  dimPitch: '#2a63a6',
  dimBrightness: '#9a6400',
  dimWeight: '#87407a',
  rest: '#3f6a45',
  restTint: '#e2ede0',
  stop: '#a3262a',
  focus: '#1f5fbf',
  /** The ledge under primary buttons (shadow-press). */
  press: '#7d2f1d',
  /** shadow-card, as React Native shadow props. */
  cardShadow: { color: '#241d26', opacity: 0.08 },
};

export type Colors = typeof light;

const dark: Colors = {
  surface100: '#141217',
  surface200: '#1d1a21',
  surface300: '#2a2530',
  line: '#3a3540',
  lineControl: '#7a7080',
  ink: '#f3ede6',
  inkMuted: '#b3a9b5',
  brand: '#f08a6c',
  onBrand: '#1b0f0b',
  brandTint: '#3a221d',
  zone: '#5cc8bc',
  onZone: '#062320',
  zoneTint: '#12302d',
  dimPitch: '#7fb2f0',
  dimBrightness: '#e8b54a',
  dimWeight: '#d690c6',
  rest: '#9cc79e',
  restTint: '#1c2a1d',
  stop: '#ff8a80',
  focus: '#8ab4ff',
  press: '#a5533c',
  cardShadow: { color: '#000000', opacity: 0.35 },
};

export const space = { 1: 4, 2: 8, 3: 12, 4: 16, 6: 24, 8: 32, 12: 48 } as const;
export const radius = { sm: 8, md: 14, lg: 24, pill: 999 } as const;

/** Font family names, as registered with useFonts in the root layout. */
export const fonts = {
  display: 'Fraunces_600SemiBold',
  sans: 'AtkinsonHyperlegible_400Regular',
  sansBold: 'AtkinsonHyperlegible_700Bold',
  mono: 'DMMono_500Medium',
};

// Each weight is its own font file, so styles name the file rather than
// setting fontWeight (which would ask the system to fake a bold).
export const type = {
  display: { fontFamily: fonts.display, fontSize: 40, lineHeight: 44, letterSpacing: -0.4 },
  title: { fontFamily: fonts.display, fontSize: 28, lineHeight: 34 },
  heading: { fontFamily: fonts.sansBold, fontSize: 20, lineHeight: 26 },
  body: { fontFamily: fonts.sans, fontSize: 17, lineHeight: 24 },
  bodyStrong: { fontFamily: fonts.sansBold, fontSize: 17, lineHeight: 24 },
  label: { fontFamily: fonts.sansBold, fontSize: 14, lineHeight: 18, letterSpacing: 0.3 },
  caption: { fontFamily: fonts.sans, fontSize: 13, lineHeight: 18 },
  readout: { fontFamily: fonts.mono, fontSize: 32, lineHeight: 36 },
  readoutSm: { fontFamily: fonts.mono, fontSize: 15, lineHeight: 20 },
} satisfies Record<string, TextStyle>;

export type Theme = { scheme: 'light' | 'dark'; c: Colors };

export function useTheme(): Theme {
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  return { scheme, c: scheme === 'dark' ? dark : light };
}
