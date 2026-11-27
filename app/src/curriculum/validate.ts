// Checks a curriculum before the app uses it (Stage 5). `npm test` runs it
// on content/curriculum/curriculum.json, so a content change that breaks a
// rule fails CI; the app runs it again on load and refuses a bad file.

import { GENDERED_TERMS } from '../feedback/labels.ts';
import { SAFETY } from '../safety/rules.ts';
import { LEVELS } from '../eartraining/staircase.ts';
import { CURRICULUM_SCHEMA_VERSION, type CriterionKind, type Curriculum, type Exercise, type ExerciseType } from './types.ts';

/** Which exercise types can produce the evidence each criterion needs. */
const CRITERION_TYPES: Record<CriterionKind, ExerciseType[] | 'any'> = {
  completion: 'any',
  'baseline-stored': ['info'],
  staircase: ['listen'],
  'pitch-match': ['match-pitch'],
  'in-zone': ['hold', 'read'],
  'weight-lighter': ['hold', 'read'],
  'whisper-rise': ['whisper'],
  'resonance-vowels': ['vowel-ladder'],
  'st-range': ['read'],
  'free-speech-stable': ['free-speech'],
  'self-rated': ['self-rate'],
  'self-report': ['mission'],
};

/** Copy must stay education-only (decision D3). */
const CLINICAL = /\b(therapy|therapeutic|treatment|diagnos\w*|clinical|dysphonia|cure)\b/i;
const GENDERED = new RegExp(`\\b(${GENDERED_TERMS.join('|')})\\b`, 'i');

function strings(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) value.forEach((v) => strings(v, out));
  else if (value && typeof value === 'object') Object.values(value).forEach((v) => strings(v, out));
  return out;
}

/** Problems with a curriculum; empty when it is usable. */
export function validateCurriculum(c: Curriculum, knownVowels: ReadonlySet<string>): string[] {
  const errors: string[] = [];
  const err = (m: string) => errors.push(m);
  if (c.schemaVersion !== CURRICULUM_SCHEMA_VERSION) err(`schemaVersion ${c.schemaVersion}, expected ${CURRICULUM_SCHEMA_VERSION}`);

  const ids = new Set<string>();
  const unique = (id: string) => {
    if (ids.has(id)) err(`duplicate id ${id}`);
    ids.add(id);
  };
  const unitIds = c.units.map((u) => u.id);

  for (const [track, order] of Object.entries(c.tracks)) {
    if (order.length !== unitIds.length || !unitIds.every((u) => order.includes(u))) err(`track ${track} must list every unit once`);
    if (order[0] !== 'u0') err(`track ${track} must start with setup`);
  }

  const sovtSeconds = (e: Exercise) => (e.type === 'sovt' ? e.steps.reduce((s, x) => s + x.seconds, 0) : 0);
  if (c.warmup.role !== 'warmup' || sovtSeconds(c.warmup) < SAFETY.warmupMinS) err(`warm-up must be ≥ ${SAFETY.warmupMinS} s (§2.4)`);
  if (c.cooldown.role !== 'cooldown' || sovtSeconds(c.cooldown) < SAFETY.cooldownMinS) err(`cool-down must be ≥ ${SAFETY.cooldownMinS} s`);
  unique(c.warmup.id);
  unique(c.cooldown.id);

  c.units.forEach((unit, ui) => {
    unique(unit.id);
    if (unit.number !== ui) err(`${unit.id}: units must be numbered in order`);
    const checkpoints = unit.lessons.filter((l) => l.checkpoint);
    if (checkpoints.length !== 1 || !unit.lessons[unit.lessons.length - 1].checkpoint) {
      err(`${unit.id}: exactly one checkpoint lesson, last`);
    }
    const gate = checkpoints[0]?.exercises.find((e) => e.id === unit.gate);
    if (!gate) err(`${unit.id}: gate ${unit.gate} must be in the checkpoint lesson`);
    else {
      if (gate.pass.kind === 'completion') err(`${unit.id}: gate needs a machine-checkable criterion (§4.1)`);
      if (gate.volume === 'loud') err(`${unit.id}: a loud exercise can't be a gate (quiet mode skips it)`);
    }
    const seen: Exercise[] = [];
    for (const lesson of unit.lessons) {
      unique(lesson.id);
      if (lesson.exercises.length === 0) err(`${lesson.id}: no exercises`);
      if (!(lesson.minutes > 0 && lesson.minutes <= SAFETY.sessionSoftCapMin)) err(`${lesson.id}: minutes must fit in a session`);
      for (const e of lesson.exercises) {
        unique(e.id);
        checkExercise(e, seen, knownVowels, err);
        seen.push(e);
      }
    }
  });

  for (const s of strings(c)) {
    if (GENDERED.test(s)) err(`gendered word in copy: "${s}"`);
    if (CLINICAL.test(s)) err(`clinical word in copy (D3): "${s}"`);
  }
  return errors;
}

function checkExercise(e: Exercise, earlier: Exercise[], vowels: ReadonlySet<string>, err: (m: string) => void) {
  const allowed = CRITERION_TYPES[e.pass.kind];
  if (allowed === undefined) err(`${e.id}: unknown criterion ${e.pass.kind}`);
  else if (allowed !== 'any' && !allowed.includes(e.type)) err(`${e.id}: ${e.pass.kind} can't be checked on a ${e.type} exercise`);
  if (e.pass.kind !== 'completion' && e.source.length === 0) err(`${e.id}: a criterion needs a handbook source`);
  const p = e.pass;
  switch (e.type) {
    case 'listen':
      if (e.level != null && (e.level < 0 || e.level >= LEVELS)) err(`${e.id}: level out of range`);
      if (p.kind === 'staircase' && e.level != null && e.level < p.level) err(`${e.id}: fixed block easier than its criterion`);
      if (p.kind === 'staircase' && e.trials < p.trials) err(`${e.id}: fewer trials than the criterion counts`);
      break;
    case 'match-pitch':
      if (p.kind === 'pitch-match' && p.required > e.offsetsSt.length) err(`${e.id}: requires more items than it has`);
      if (e.offsetsSt.some((o) => Math.abs(o) > 4)) err(`${e.id}: targets stay within 4 ST of the zone centre`);
      break;
    case 'hold':
      if (e.zones.includes('f2') && !e.vowel) err(`${e.id}: brightness zone needs a vowel`);
      if (e.vowel && !vowels.has(e.vowel)) err(`${e.id}: unknown vowel ${e.vowel}`);
      if (p.kind === 'in-zone' && !p.zones.every((z) => e.zones.includes(z))) err(`${e.id}: criterion zones not shown`);
      break;
    case 'vowel-ladder':
      for (const v of e.vowels) if (!vowels.has(v.code)) err(`${e.id}: unknown vowel ${v.code}`);
      if (p.kind === 'resonance-vowels' && p.vowels > e.vowels.length) err(`${e.id}: requires more vowels than it has`);
      break;
    case 'whisper':
      if (p.kind === 'whisper-rise' && !earlier.some((x) => x.type === 'whisper' && x.reference)) {
        err(`${e.id}: needs a reference whisper earlier in the unit`);
      }
      if (e.reference && e.condition !== 'neutral') err(`${e.id}: the reference whisper is the neutral one`);
      break;
    case 'read':
      if (p.kind === 'st-range' && !earlier.some((x) => x.type === 'read' && x.reference)) {
        err(`${e.id}: needs a reference reading earlier in the unit`);
      }
      if (e.lines.length === 0) err(`${e.id}: nothing to read`);
      break;
    case 'sovt':
      err(`${e.id}: warm-ups and cool-downs are shared, not part of lessons`);
      break;
    default:
      break;
  }
}

/** Every exercise in order, with its unit and lesson. */
export function allExercises(c: Curriculum) {
  return c.units.flatMap((unit) => unit.lessons.flatMap((lesson) => lesson.exercises.map((exercise) => ({ unit, lesson, exercise }))));
}
