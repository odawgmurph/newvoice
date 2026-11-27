// Curriculum content schema (Stage 5; handbook §4.1 and §2.2).
//
// The curriculum is data: content/curriculum/curriculum.json, bundled with
// the app and updatable over the air. Units → lessons → exercises, each
// exercise with a renderer type and, where the handbook gives one, a
// machine-checkable pass criterion. Every unit ends in a checkpoint whose
// criterion is the handbook's unlock criterion for that unit (§4.1).
// Pure TypeScript: `npm test` validates the shipped file (validate.ts).

/** Bump when the JSON layout changes; the app refuses other versions. */
export const CURRICULUM_SCHEMA_VERSION = 1;

export type Dimension =
  | 'setup'
  | 'hearing'
  | 'pitch'
  | 'weight'
  | 'size'
  | 'brightness'
  | 'combine'
  | 'melody'
  | 'articulation'
  | 'carryover'
  | 'life'
  | 'health';

/** Which way the curriculum runs (handbook §2.1: default, or TVL-style resonance first). */
export type TrackId = 'default' | 'resonance-first';

/** How an exercise is presented. Each has one renderer in src/lesson/. */
export type ExerciseType =
  /** A short card of explanation. */
  | 'info'
  /** Guided semi-occluded vocal tract steps with timers (E11). */
  | 'sovt'
  /** Ear training: AB or odd-one-out with an adaptive staircase (§2.3). */
  | 'listen'
  /** Hum or say a syllable on a played tone (E1). */
  | 'match-pitch'
  /** Slide or glide on a sound (E2, E4, E5, E12). */
  | 'glide'
  /** Say items while staying in the personal zones (E3, E9, E14). */
  | 'hold'
  /** Whispered sound, formants only (E6, E7). */
  | 'whisper'
  /** One rung per vowel, brightness feedback on each (E9, Unit 5). */
  | 'vowel-ladder'
  /** Read or say lines aloud (E15, E16, E19). */
  | 'read'
  /** Talk to a prompt for a set time (Unit 9). */
  | 'free-speech'
  /** Rate your own attempt, then see what was measured (§4.1 "self-rating vs metrics"). */
  | 'self-rate'
  /** A real-life task, reported afterwards (Unit 10). */
  | 'mission'
  /** A journal entry (§4.5 Journal). */
  | 'journal';

/** Quiet mode skips loud exercises (handbook §4.3, quiet and whisper modes). */
export type Volume = 'silent' | 'quiet' | 'normal' | 'loud';

export type EarDimension = 'pitch' | 'brightness' | 'weight';

/**
 * Machine-checkable pass criteria. Thresholds come from the handbook; each
 * is cited where it is used in content/curriculum/curriculum.json and
 * implemented in criteria.ts.
 */
export type Criterion =
  /** Finishing is enough (info, warm-ups, journal). */
  | { kind: 'completion' }
  /** Unit 0: a baseline is stored. */
  | { kind: 'baseline-stored' }
  /** Unit 1: ≥ accuracy over the last `trials` trials at or above `level` (§4.1). */
  | { kind: 'staircase'; accuracy: number; level: number; trials: number }
  /** Unit 2 / E1: median F0 within ±cents of the target for ≥ holdMs, on `required` of the items. */
  | { kind: 'pitch-match'; toleranceCents: number; holdMs: number; required: number }
  /** E14 / Unit 6: share of voiced frames in each listed zone. */
  | { kind: 'in-zone'; share: number; zones: ('pitch' | 'f2')[]; minVoicedS: number }
  /** Unit 3: weight index ≤ −sd (lighter than baseline by that many SD) in `sessions` separate sessions. */
  | { kind: 'weight-lighter'; sd: number; sessions: number }
  /** Unit 4: whispered F2 in the target condition ≥ ratio × the user's neutral whisper. */
  | { kind: 'whisper-rise'; ratio: number }
  /** Unit 5: resonance score ≥ the goal-adjusted target on at least `vowels` vowels. */
  | { kind: 'resonance-vowels'; score: number; vowels: number }
  /** Unit 7 / E15: median utterance ST range ≥ the user's own reference + overReferenceSt. */
  | { kind: 'st-range'; overReferenceSt: number; risingShare?: number }
  /** Unit 9: free-speech median F0 in the pitch zone in `sessions` sessions, within spreadSt of each other. */
  | { kind: 'free-speech-stable'; sessions: number; spreadSt: number; minVoicedS: number }
  /** Unit 8: the user's self-rating plus the measured pitch staying in zone for `share` of voiced frames. */
  | { kind: 'self-rated'; minRating: number; share: number }
  /** Unit 10: a reported mission. */
  | { kind: 'self-report' };

export type CriterionKind = Criterion['kind'];

type Base = {
  id: string;
  title: string;
  /** Instructions shown before starting. External-focus cues where possible (§2.5). */
  prompt: string;
  /** Handbook references, e.g. ["E1", "§4.1"]. Required for anything with a criterion. */
  source: string[];
  volume: Volume;
  /** Records the user's own everyday version, which later criteria compare against. */
  reference?: boolean;
  pass: Criterion;
};

export type InfoExercise = Base & { type: 'info'; body: string[] };
export type SovtExercise = Base & {
  type: 'sovt';
  role: 'warmup' | 'cooldown';
  steps: { label: string; how: string; seconds: number }[];
};
export type ListenExercise = Base & {
  type: 'listen';
  dimension: EarDimension;
  format: 'ab' | 'odd-one-out';
  trials: number;
  /** A fixed-difficulty block at this staircase level (a checkpoint); otherwise adaptive. */
  level?: number;
};
export type MatchPitchExercise = Base & {
  type: 'match-pitch';
  sound: string;
  /** Targets in semitones above the baseline median; capped below the comfortable p90. */
  offsetsSt: number[];
  /** Tone timbre: a pure tone first, a voice-like tone later (E1 progression). */
  tone: 'sine' | 'voice';
};
export type GlideExercise = Base & { type: 'glide'; sound: string; direction: 'up' | 'down' | 'up-down'; reps: number };
export type HoldExercise = Base & {
  type: 'hold';
  /** Words or phrases, one per item. */
  items: string[];
  /** Vowel code for brightness feedback, when the items share one. */
  vowel?: string;
  zones: ('pitch' | 'f2')[];
};
export type WhisperExercise = Base & {
  type: 'whisper';
  sound: string;
  /** neutral = the user's ordinary whisper (stored as the reference); target = the condition being trained. */
  condition: 'neutral' | 'target';
  seconds: number;
};
export type VowelLadderExercise = Base & { type: 'vowel-ladder'; vowels: { code: string; word: string }[] };
export type ReadExercise = Base & {
  type: 'read';
  lines: string[];
  /** What the feedback watches. */
  focus: 'pitch' | 'melody' | 'zones';
};
export type FreeSpeechExercise = Base & { type: 'free-speech'; prompts: string[]; seconds: number };
export type SelfRateExercise = Base & { type: 'self-rate'; items: string[]; question: string };
export type MissionExercise = Base & { type: 'mission'; ideas: string[] };
export type JournalExercise = Base & { type: 'journal'; questions: string[] };

export type Exercise =
  | InfoExercise
  | SovtExercise
  | ListenExercise
  | MatchPitchExercise
  | GlideExercise
  | HoldExercise
  | WhisperExercise
  | VowelLadderExercise
  | ReadExercise
  | FreeSpeechExercise
  | SelfRateExercise
  | MissionExercise
  | JournalExercise;

export type Lesson = {
  id: string;
  title: string;
  /** Rough length, for planning a session under the soft cap. */
  minutes: number;
  /** The checkpoint lesson holds the unit's unlock criterion. */
  checkpoint?: boolean;
  exercises: Exercise[];
};

export type Unit = {
  id: string;
  number: number;
  title: string;
  dimension: Dimension;
  summary: string;
  /** Exercise id (in this unit) whose criterion is the unit's unlock criterion (§4.1). */
  gate: string;
  lessons: Lesson[];
};

export type Curriculum = {
  schemaVersion: number;
  contentVersion: string;
  tracks: Record<TrackId, string[]>;
  /** Shared warm-up and cool-down, required around any voiced practice (§2.4). */
  warmup: SovtExercise;
  cooldown: SovtExercise;
  units: Unit[];
};

/** Exercise types that use the voice; these need a warm-up first and count toward the daily limit. */
export const VOICED_TYPES: ReadonlySet<ExerciseType> = new Set<ExerciseType>([
  'sovt',
  'match-pitch',
  'glide',
  'hold',
  'whisper',
  'vowel-ladder',
  'read',
  'free-speech',
  'self-rate',
]);

export const usesVoice = (e: Exercise) => VOICED_TYPES.has(e.type) && e.volume !== 'silent';
