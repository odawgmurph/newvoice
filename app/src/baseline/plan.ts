// Baseline capture (build plan Stage 4; handbook §4.3 and Unit 0 in §4.1):
// sustained /a/ /i/ /u/, a glide, a reading passage and 30 s of spontaneous
// speech. Everything later is measured against what this stores.
//
// Pure logic only (task list, quality checks, the stored summary), so
// `npm test` can run it under Node. Thresholds and their sources are listed
// in docs/decisions.md (D17).

import type {
  ResonanceScoreResult,
  ResonanceTokenInput,
  TaskKind,
  TaskPitch,
  TaskQuality,
  TaskResult,
} from '../../modules/newvoice-audio/src/NewVoiceAudio.types';

/** Bump when the summary's layout or meaning changes. */
export const BASELINE_VERSION = 1;

export type BaselineTaskId = 'vowel-a' | 'vowel-i' | 'vowel-u' | 'glide' | 'reading' | 'spontaneous';

export type BaselineTask = {
  id: BaselineTaskId;
  /** Stored as `recording.task_id`. */
  taskId: string;
  kind: TaskKind;
  title: string;
  /** What to do, in one or two sentences. */
  prompt: string;
  /** Text to read aloud, or the sound to make. */
  say?: string[];
  /** Recording stops by itself after this long. */
  recordSeconds: number;
  /** Stopping before this counts as not finished. */
  minSeconds: number;
  /** Least voiced audio for the measurements to count (handbook §3.1: ≥1–2 s). */
  minVoicedS: number;
  /** For vowels: the reference vowel the resonance score compares with. */
  vowel?: { code: 'ah' | 'iy' | 'uw'; ipa: string };
};

/**
 * Six CAPE-V sentences (handbook E16): short, freely used for voice
 * assessment, and each stresses different sounds (vowels, voiced-only,
 * nasals, glottal onsets). Longer passages need a licence check (D17).
 */
export const READING_SENTENCES = [
  'The blue spot is on the key again.',
  'How hard did he hit him?',
  'We were away a year ago.',
  'We eat eggs every Easter.',
  'My mama makes lemon muffins.',
  'Peter will keep at the peak.',
];

export const SPONTANEOUS_PROMPTS = [
  'Describe what you did this morning, from waking up.',
  'Talk about a meal you love and how it’s made.',
  'Describe a place you’d like to visit, and why.',
];

const vowelTask = (id: BaselineTaskId, sound: string, code: 'ah' | 'iy' | 'uw', ipa: string, as: string) =>
  ({
    id,
    taskId: `baseline.vowel.${id.slice(-1)}`,
    kind: 'vowel',
    title: `Hold “${sound}”`,
    prompt: `Say “${sound}”, as in “${as}”, in your everyday voice and hold it steadily for about 4 seconds.`,
    say: [sound],
    recordSeconds: 6,
    minSeconds: 0,
    // Handbook §3.1 asks for 1–2 s of voiced audio; a 4 s hold leaves room.
    minVoicedS: 1.5,
    vowel: { code, ipa },
  }) satisfies BaselineTask;

export const BASELINE_TASKS: readonly BaselineTask[] = [
  vowelTask('vowel-a', 'ah', 'ah', 'ɑ', 'father'),
  vowelTask('vowel-i', 'ee', 'iy', 'i', 'see'),
  vowelTask('vowel-u', 'oo', 'uw', 'u', 'food'),
  {
    id: 'glide',
    taskId: 'baseline.glide',
    kind: 'glide',
    title: 'Slide low to high',
    prompt:
      'Hum “ng” (as at the end of “sing”) or do a lip trill, and slide from low to high and back down. Only go as high and as low as feels easy.',
    say: ['ng ↗ ↘'],
    recordSeconds: 12,
    minSeconds: 0,
    minVoicedS: 2,
  },
  {
    id: 'reading',
    taskId: 'baseline.reading',
    kind: 'speech',
    title: 'Read aloud',
    prompt: 'Read these sentences in your everyday voice, at a normal pace. Tap Done when you finish.',
    say: READING_SENTENCES,
    recordSeconds: 45,
    minSeconds: 0,
    minVoicedS: 2,
  },
  {
    id: 'spontaneous',
    taskId: 'baseline.spontaneous',
    kind: 'speech',
    title: 'Talk for 30 seconds',
    prompt: 'Talk about anything for 30 seconds, in your everyday voice. Here are some ideas:',
    say: SPONTANEOUS_PROMPTS,
    recordSeconds: 30,
    minSeconds: 20,
    // Natural speech is roughly half voiced; 5 s is a third of the lowest expected.
    minVoicedS: 5,
  },
];

// ——— Checking one recording ———

export type IssueCode =
  | 'too-short'
  | 'too-little-voice'
  | 'clipped'
  | 'no-vowel'
  | 'low-confidence'
  | 'narrow-glide'
  | 'processed'
  | 'bluetooth'
  | 'dropped';

export type Issue = {
  code: IssueCode;
  /** Blocking issues mean the measurements can't be used: record again. */
  blocking: boolean;
  message: string;
};

/** Over 0.1% of samples at full scale distorts the spectral measures. */
export const MAX_CLIPPED_FRACTION = 0.001;
/** Below this formant confidence F1/F2 are as likely wrong as right (D11). */
export const MIN_VOWEL_CONFIDENCE = 0.5;
/** A "glide" narrower than this is probably a held note. Never a reason to push (handbook E2). */
export const NARROW_GLIDE_ST = 4;

export function checkTask(task: BaselineTask, r: TaskResult): Issue[] {
  const issues: Issue[] = [];
  const add = (code: IssueCode, blocking: boolean, message: string) => issues.push({ code, blocking, message });

  if (task.minSeconds > 0 && r.durationS < task.minSeconds) {
    add('too-short', true, `That stopped after ${Math.round(r.durationS)} seconds. Try to keep going for the full time.`);
  }
  const voiced = r.pitch?.voicedS ?? 0;
  if (voiced < task.minVoicedS) {
    add('too-little-voice', true, 'We couldn’t hear enough voice to measure. Try again, a little closer to the phone.');
  }
  if (r.levels.clippedFraction > MAX_CLIPPED_FRACTION) {
    add('clipped', true, 'That was too loud for the microphone. Try again a little further from the phone.');
  }
  if (task.kind === 'vowel' && voiced >= task.minVoicedS) {
    if (r.vowel == null) {
      add('no-vowel', true, 'We couldn’t find a steady vowel. Try holding the sound evenly, without sliding.');
    } else if (r.vowel.confidence < MIN_VOWEL_CONFIDENCE) {
      add('low-confidence', false, 'This one was hard to measure. You can keep it, or try once more.');
    }
  }
  if (task.kind === 'glide' && r.pitch && voiced >= task.minVoicedS && r.pitch.p95St - r.pitch.p5St < NARROW_GLIDE_ST) {
    add(
      'narrow-glide',
      false,
      'That was a narrow slide. If that’s what feels easy today, keep it. Never push to go further.',
    );
  }
  if (r.capture.bluetoothInput) {
    add('bluetooth', false, 'Bluetooth microphones change the sound. The phone’s own microphone is more accurate.');
  } else if (!r.capture.measurementMode || (r.capture.microphoneMode ?? 'standard') !== 'standard') {
    add(
      'processed',
      false,
      'The phone processed the sound, so these readings are less accurate. Check that Mic Mode in Control Center is Standard.',
    );
  }
  if (r.capture.droppedSamples > 0) {
    add('dropped', false, 'Some audio was missed while recording. You may want to try again.');
  }
  return issues;
}

export const isUsable = (issues: Issue[]) => !issues.some((i) => i.blocking);

// ——— The stored summary ———

export type PitchBlock = {
  medianHz: number;
  medianSt: number;
  p10St: number;
  p90St: number;
  sdSt: number;
  /** 5th–95th percentile range in semitones (handbook §3.2). */
  rangeSt: number;
  voicedS: number;
};

export type VowelBlock = {
  f1Hz: number | null;
  f2Hz: number | null;
  f3Hz: number | null;
  f0MedianHz: number;
  ceilingHz: number;
  confidence: number;
};

export type BaselineSummary = {
  version: typeof BASELINE_VERSION;
  coreVersion: string | null;
  /** Everyday speaking pitch: spontaneous speech, else the reading. */
  speaking: (PitchBlock & { source: 'spontaneous' | 'reading' }) | null;
  reading: PitchBlock | null;
  /**
   * Comfortable range from the glide: 5th–95th percentile (handbook E2).
   * `ceilingSt` is the 90th percentile, above which nothing is rewarded and
   * strain checks apply (handbook §2.4, §3.9).
   */
  comfortableRange: { lowSt: number; highSt: number; ceilingSt: number; spanSt: number } | null;
  vowels: { a: VowelBlock | null; i: VowelBlock | null; u: VowelBlock | null };
  /** Median of the vowels' chosen ceilings: the live formant ceiling to use. */
  formantCeilingHz: number | null;
  /** Median over the vowels; one vowel's ΔF is noisy. */
  vocalTract: { deltaFHz: number; avtlCm: number | null; deltaFPosition: number | null } | null;
  /** Heuristic, never shown as a gender score (D2, D11). */
  resonance: { version: number; score: number; tokensUsed: number } | null;
  /** Weight-index baseline from the reading (else spontaneous speech). */
  weightBaseline: TaskQuality['weightBaseline'] | null;
  /** Voice quality on the sustained /a/ and on the reading, for strain trends later. */
  quality: { sustained: QualityBlock | null; speech: QualityBlock | null };
  /** Relative level of voiced reading frames; only comparable on this phone. */
  speechLevelDbfs: number | null;
  /** Any recording where the phone processed audio or used a Bluetooth mic. */
  reducedAccuracy: boolean;
};

export type QualityBlock = Pick<
  TaskQuality,
  'qualityVersion' | 'cppsDb' | 'hnrDb' | 'jitterLocal' | 'shimmerLocal' | 'h1cH2cDb' | 'alphaRatioDb'
>;

export type BaselineResults = Partial<Record<BaselineTaskId, TaskResult>>;

function pitchBlock(p: TaskPitch | null | undefined): PitchBlock | null {
  if (!p) return null;
  return {
    medianHz: p.medianHz,
    medianSt: p.medianSt,
    p10St: p.p10St,
    p90St: p.p90St,
    sdSt: p.sdSt,
    rangeSt: p.p95St - p.p5St,
    voicedS: p.voicedS,
  };
}

function qualityBlock(q: TaskQuality | undefined): QualityBlock | null {
  if (!q) return null;
  const { qualityVersion, cppsDb, hnrDb, jitterLocal, shimmerLocal, h1cH2cDb, alphaRatioDb } = q;
  return { qualityVersion, cppsDb, hnrDb, jitterLocal, shimmerLocal, h1cH2cDb, alphaRatioDb };
}

function vowelBlock(r: TaskResult | undefined): VowelBlock | null {
  const v = r?.vowel;
  if (!v) return null;
  return {
    f1Hz: v.f1Hz,
    f2Hz: v.f2Hz,
    f3Hz: v.f3Hz,
    f0MedianHz: v.f0MedianHz,
    ceilingHz: v.ceilingHz,
    confidence: v.confidence,
  };
}

export function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

const VOWEL_IDS = ['vowel-a', 'vowel-i', 'vowel-u'] as const;

/** Vowel tokens for the resonance score, weighted by formant confidence (D11). */
export function resonanceTokens(results: BaselineResults): ResonanceTokenInput[] {
  const tokens: ResonanceTokenInput[] = [];
  for (const id of VOWEL_IDS) {
    const task = BASELINE_TASKS.find((t) => t.id === id)!;
    const v = results[id]?.vowel;
    if (!v || !task.vowel) continue;
    tokens.push({ vowel: task.vowel.code, f1Hz: v.f1Hz, f2Hz: v.f2Hz, f3Hz: v.f3Hz, weight: v.confidence });
  }
  return tokens;
}

export function buildSummary(results: BaselineResults, resonance: ResonanceScoreResult | null): BaselineSummary {
  const spont = pitchBlock(results.spontaneous?.pitch);
  const reading = pitchBlock(results.reading?.pitch);
  const glide = results.glide?.pitch;
  const vowelResults = VOWEL_IDS.map((id) => results[id]?.vowel).filter((v) => v != null);

  const deltaF = median(vowelResults.flatMap((v) => (v.deltaFHz != null ? [v.deltaFHz] : [])));
  const avtl = median(vowelResults.flatMap((v) => (v.avtlCm != null ? [v.avtlCm] : [])));
  const dfPos = median(vowelResults.flatMap((v) => (v.deltaFPosition != null ? [v.deltaFPosition] : [])));

  const all = Object.values(results).filter((r) => r != null);
  return {
    version: BASELINE_VERSION,
    coreVersion: all[0]?.coreVersion ?? null,
    speaking: spont ? { ...spont, source: 'spontaneous' } : reading ? { ...reading, source: 'reading' } : null,
    reading,
    comfortableRange: glide
      ? { lowSt: glide.p5St, highSt: glide.p95St, ceilingSt: glide.p90St, spanSt: glide.p95St - glide.p5St }
      : null,
    vowels: {
      a: vowelBlock(results['vowel-a']),
      i: vowelBlock(results['vowel-i']),
      u: vowelBlock(results['vowel-u']),
    },
    formantCeilingHz: median(vowelResults.map((v) => v.ceilingHz)),
    vocalTract: deltaF != null ? { deltaFHz: deltaF, avtlCm: avtl, deltaFPosition: dfPos } : null,
    resonance:
      resonance?.score != null && resonance.version != null
        ? { version: resonance.version, score: resonance.score, tokensUsed: resonance.tokensUsed }
        : null,
    weightBaseline: (results.reading ?? results.spontaneous)?.quality.weightBaseline ?? null,
    quality: {
      sustained: qualityBlock(results['vowel-a']?.quality),
      speech: qualityBlock((results.reading ?? results.spontaneous)?.quality),
    },
    speechLevelDbfs: results.reading?.levels.voicedLevelMedianDbfs ?? null,
    reducedAccuracy: all.some((r) => r.capture.bluetoothInput || !r.capture.measurementMode),
  };
}

/** Required tasks before a baseline counts as stored (Unit 0 unlock: "Baseline stored"). */
export function missingTasks(results: BaselineResults): BaselineTaskId[] {
  return BASELINE_TASKS.filter((t) => results[t.id] == null).map((t) => t.id);
}

// ——— Display helpers ———

const NOTES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];

/** MIDI semitones (A4 = 69) to hertz. */
export const stToHz = (st: number) => 440 * 2 ** ((st - 69) / 12);

/** Nearest note name, e.g. "A3". */
export function noteName(st: number): string {
  const n = Math.round(st);
  return `${NOTES[((n % 12) + 12) % 12]}${Math.floor(n / 12) - 1}`;
}

export const formatHz = (hz: number) => `${Math.round(hz)} Hz`;
