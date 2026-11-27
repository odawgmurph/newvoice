import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo';

// Discreet icon (Stage 4). iOS only for now: Android needs activity aliases
// (decision D23). Every call resolves safely where the module is missing.

type DiscreetModule = {
  supportsIcons(): Promise<boolean>;
  currentIcon(): Promise<string | null>;
  setIcon(name: string | null): Promise<void>;
};

const native = Platform.OS === 'ios' ? requireOptionalNativeModule<DiscreetModule>('NewVoiceDiscreet') : null;

/** Alternate icons; names match plugins/withAlternateIcons.js. */
export const DISCREET_ICONS = [
  { name: null, label: 'NewVoice' },
  { name: 'AppIconDots', label: 'Dots' },
  { name: 'AppIconWaves', label: 'Waves' },
] as const;

export async function supportsIcons(): Promise<boolean> {
  return native ? native.supportsIcons().catch(() => false) : false;
}

export async function currentIcon(): Promise<string | null> {
  return native ? native.currentIcon().catch(() => null) : null;
}

export async function setIcon(name: string | null): Promise<void> {
  if (!native) throw new Error('Changing the icon isn’t available on this device.');
  await native.setIcon(name);
}
