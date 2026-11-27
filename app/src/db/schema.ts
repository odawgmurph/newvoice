import { integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

// Tables follow the handbook's data-model sketch (§4.5): User, Session,
// Recording, SkillState, Journal, plus Baseline (the recording set
// `User.baseline_id` points at). Change this file, then run
// `npm run db:generate` and commit the new migration in drizzle/.

const createdAt = () =>
  integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date());

export const GOALS = ['feminine', 'androgynous', 'flexible', 'own'] as const;
export type Goal = (typeof GOALS)[number];

export const ENVIRONMENTS = ['private', 'shared', 'quiet_only'] as const;
export type Environment = (typeof ENVIRONMENTS)[number];

export const TRACKS = ['default', 'resonance-first'] as const;

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
  /** The current baseline (a completed row of `baseline`); null until one is recorded. */
  baselineId: integer('baseline_id'),
  /** Curriculum order (handbook §2.1): the default, or resonance first (TVL-style). */
  track: text('track', { enum: TRACKS }).notNull().default('default'),
  /** Quiet mode: loud exercises are skipped (handbook §4.3 quiet and whisper modes). */
  quietMode: integer('quiet_mode', { mode: 'boolean' }).notNull().default(false),
  /** Whisper mode: the practice screen shows formants only, no pitch (§4.3). */
  whisperMode: integer('whisper_mode', { mode: 'boolean' }).notNull().default(false),
  /** Shaking the phone triggers quick exit (§4.3). */
  shakeToExit: integer('shake_to_exit', { mode: 'boolean' }).notNull().default(true),
  /** Opt-in: show how measurements changed between starting points (Stage 7 progress timeline). */
  progressTimeline: integer('progress_timeline', { mode: 'boolean' }).notNull().default(false),
  /** Developer tools: the capture test and diagnostics export (D13), off by default. */
  developerTools: integer('developer_tools', { mode: 'boolean' }).notNull().default(false),
});

/**
 * One baseline recording set (D20). Earlier baselines are kept so progress
 * can be compared later; `user.baseline_id` names the current one.
 */
export const baseline = sqliteTable('baseline', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  createdAt: createdAt(),
  /** Null while in progress; set when every task has a usable recording. */
  completedAt: integer('completed_at', { mode: 'timestamp_ms' }),
  sessionId: integer('session_id').references(() => session.id, { onDelete: 'set null' }),
  /** `BaselineSummary` from src/baseline/plan.ts; null while in progress. */
  summary: text('summary', { mode: 'json' }),
  /** Version of the analysis core that measured it. */
  analysisVersion: text('analysis_version'),
});

export const session = sqliteTable('session', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  startedAt: integer('started_at', { mode: 'timestamp_ms' }).notNull(),
  durationS: real('duration_s'),
  warmupDone: integer('warmup_done', { mode: 'boolean' }).notNull().default(false),
  cooldownDone: integer('cooldown_done', { mode: 'boolean' }).notNull().default(false),
  /** Self-reported effort, 0–10; ≥6 triggers a rest prompt (handbook §2.4). */
  effortRating: integer('effort_rating'),
  /** What the session was. */
  kind: text('kind', { enum: ['baseline', 'practice', 'lesson'] }),
  /** Voiced practice in seconds (warm-up and cool-down included): the daily limit counts this (§2.4). */
  voicedS: real('voiced_s').notNull().default(0),
  /** Ear-training answers, for XP. */
  listenTrials: integer('listen_trials').notNull().default(0),
  lessonsDone: integer('lessons_done').notNull().default(0),
});

/** One try at one exercise (Stage 5). Criteria and the scheduler read these. */
export const attempt = sqliteTable('attempt', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  at: integer('at', { mode: 'timestamp_ms' }).notNull(),
  sessionId: integer('session_id').references(() => session.id, { onDelete: 'set null' }),
  lessonId: text('lesson_id').notNull(),
  exerciseId: text('exercise_id').notNull(),
  /** A refresher run of an already learned lesson (Stage 6). */
  refresher: integer('refresher', { mode: 'boolean' }).notNull().default(false),
  passed: integer('passed', { mode: 'boolean' }).notNull(),
  /** `Outcome` from src/curriculum/criteria.ts. */
  outcome: text('outcome', { mode: 'json' }).notNull(),
  /** Numbers later criteria compare with (a reference whisper's F2, a reference reading's range). Never audio. */
  evidence: text('evidence', { mode: 'json' }),
});

/** Symptoms reported at a check-in or with the stop button (handbook §2.4). */
export const symptomReport = sqliteTable('symptom_report', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  at: integer('at', { mode: 'timestamp_ms' }).notNull(),
  /** `Symptom[]` from src/safety/rules.ts; empty means "feels fine". */
  symptoms: text('symptoms', { mode: 'json' }).notNull(),
});

/** Days marked as voice rest or illness; they keep a streak (§4.2 streak freeze). */
export const restDay = sqliteTable('rest_day', {
  /** Local day, YYYY-MM-DD. */
  day: text('day').primaryKey(),
  reason: text('reason', { enum: ['voice-rest', 'illness', 'hard-stop'] }).notNull(),
});

export const recording = sqliteTable('recording', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  createdAt: createdAt(),
  sessionId: integer('session_id').references(() => session.id, { onDelete: 'set null' }),
  /** Set for baseline recordings. */
  baselineId: integer('baseline_id').references(() => baseline.id, { onDelete: 'cascade' }),
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

/** Per skill (a lesson): mastery and the refresher model (Stage 6, src/learning/hlr.ts). */
export const skillState = sqliteTable('skill_state', {
  skillId: text('skill_id').primaryKey(),
  mastery: real('mastery').notNull().default(0),
  halfLifeDays: real('half_life_days'),
  lastSuccessAt: integer('last_success_at', { mode: 'timestamp_ms' }),
  /** Half-life regression weights, learned on the phone. */
  weights: text('weights', { mode: 'json' }),
  successes: integer('successes').notNull().default(0),
  failures: integer('failures').notNull().default(0),
  /** Target level (zones.ts steps), moved by the challenge-point rule. */
  level: integer('level').notNull().default(0),
});

export const journal = sqliteTable('journal', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  createdAt: createdAt(),
  text: text('text').notNull(),
  /** 1–5, optional. */
  mood: integer('mood'),
  /** The question it answers, when written in a lesson. */
  prompt: text('prompt'),
  lessonId: text('lesson_id'),
});

export type User = typeof user.$inferSelect;
export type Attempt = typeof attempt.$inferSelect;
export type SkillStateRow = typeof skillState.$inferSelect;
export type Track = (typeof TRACKS)[number];
export type Baseline = typeof baseline.$inferSelect;
