// Shared feedback-engine types (Stage 3). Pure TypeScript, no React Native
// imports, so `npm test` runs everything in src/feedback under Node.
// Import sibling modules with explicit `.ts` extensions.

export type {
  Frame,
  PitchSummary,
  UtteranceSummary,
  WeightBaseline,
} from '../../modules/newvoice-audio/src/NewVoiceAudio.types.ts';

/** Mirrors GOALS in src/db/schema.ts (kept here so this file has no imports Node can't strip). */
export type Goal = 'feminine' | 'androgynous' | 'flexible' | 'own';

/** The three trained dimensions plus intonation. */
export type Dimension = 'pitch' | 'resonance' | 'weight' | 'intonation';

/**
 * The user's baseline, as far as the feedback engine needs it. Stage 4's
 * baseline capture fills it; a provisional one can come from a practice
 * session (see zones.ts).
 */
export type Baseline = {
  /** Speaking pitch (semitones, MIDI scale). */
  medianSt: number;
  p10St: number;
  p90St: number;
  /** Comfortable range from the glide (handbook E2); p90 is the safety ceiling. */
  comfortableP10St: number;
  comfortableP90St: number;
  /** Baseline F2 per vowel (Hillenbrand code), where measured. */
  vowelF2Hz: Partial<Record<string, number>>;
  /** Resonance score of the baseline vowels, when measured. */
  resonance: number | null;
  /** Where this baseline came from. */
  source: 'baseline' | 'provisional';
};

/** How a view presents feedback (motor-learning fading, handbook §2.5). */
export type FeedbackMode = 'live' | 'summary' | 'delayed';
