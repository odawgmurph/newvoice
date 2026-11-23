import { integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

// Tables follow the handbook's data-model sketch (§4.5): User, Session,
// Recording, SkillState, Journal. Change this file, then run
// `npm run db:generate` and commit the new migration in drizzle/.

const createdAt = () =>
  integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date());

export const GOALS = ['feminine', 'androgynous', 'flexible', 'own'] as const;
export type Goal = (typeof GOALS)[number];

export const ENVIRONMENTS = ['private', 'shared', 'quiet_only'] as const;
export type Environment = (typeof ENVIRONMENTS)[number];

/** One row (id 1): the person using this phone. No account, nothing leaves the device. */
export const user = sqliteTable('user', {
  id: integer('id').primaryKey(),
  createdAt: createdAt(),
  goal: text('goal', { enum: GOALS }),
  /** Free text for the "my own" goal. */
  goalNote: text('goal_note'),
  /** Practice environment; quiet_only steers later lessons toward quiet and whisper work. */
  environment: text('environment', { enum: ENVIRONMENTS }),
  /** Language and dialect, free text (norms are English-centric for now). */
  language: text('language'),
  /** Optional context, free text; null means not answered. */
  hormoneSurgeryStatus: text('hormone_surgery_status'),
  /** Optional: whether the person works with a speech-language pathologist. */
  slpStatus: text('slp_status', { enum: ['yes', 'no', 'past'] }),
  /** Hearing your own recordings is opt-in (handbook §2.7, dysphoria on playback). */
  playbackEnabled: integer('playback_enabled', { mode: 'boolean' }).notNull().default(false),
  /** Metrics-only: keep the numbers, never keep the audio. */
  metricsOnly: integer('metrics_only', { mode: 'boolean' }).notNull().default(true),
  /**
   * Opt-in: name the two reference groups and draw their bands on the
   * feedback views. Off by default; labels stay neutral without it
   * (handbook §3.6, §4.3; decision D2).
   */
  genderedBands: integer('gendered_bands', { mode: 'boolean' }).notNull().default(false),
  safetyPrimerAckAt: integer('safety_primer_ack_at', { mode: 'timestamp_ms' }),
  onboardedAt: integer('onboarded_at', { mode: 'timestamp_ms' }),
  /** The baseline recording set (Stage 4 baseline capture). */
  baselineId: integer('baseline_id'),
});

export const session = sqliteTable('session', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  startedAt: integer('started_at', { mode: 'timestamp_ms' }).notNull(),
  durationS: real('duration_s'),
  warmupDone: integer('warmup_done', { mode: 'boolean' }).notNull().default(false),
  cooldownDone: integer('cooldown_done', { mode: 'boolean' }).notNull().default(false),
  /** Self-reported effort, 0–10; ≥6 triggers a rest prompt (handbook §2.4). */
  effortRating: integer('effort_rating'),
});

export const recording = sqliteTable('recording', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  createdAt: createdAt(),
  sessionId: integer('session_id').references(() => session.id, { onDelete: 'set null' }),
  /** Exercise or baseline task, e.g. "baseline.vowel.a". */
  taskId: text('task_id').notNull(),
  /** Local audio file; null when metrics-only mode kept no audio. */
  localUri: text('local_uri'),
  /** Feature vector from the Rust core as JSON (f0 stats in ST, formants by vowel, ΔF, aVTL, CPPS, H1–H2, alpha, jitter, shimmer). */
  features: text('features', { mode: 'json' }).notNull(),
  confidence: real('confidence'),
  /** Version of the analysis core that produced `features`. */
  analysisVersion: text('analysis_version').notNull(),
});

export const skillState = sqliteTable('skill_state', {
  skillId: text('skill_id').primaryKey(),
  mastery: real('mastery').notNull().default(0),
  halfLifeDays: real('half_life_days'),
  lastSuccessAt: integer('last_success_at', { mode: 'timestamp_ms' }),
});

export const journal = sqliteTable('journal', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  createdAt: createdAt(),
  text: text('text').notNull(),
  mood: integer('mood'),
});

export type User = typeof user.$inferSelect;
