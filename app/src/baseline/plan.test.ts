import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { TaskResult } from '../../modules/newvoice-audio/src/NewVoiceAudio.types';
import {
  BASELINE_TASKS,
  buildSummary,
  checkTask,
  feedbackBaselineFrom,
  isBaselineSummary,
  isUsable,
  median,
  missingTasks,
  noteName,
  READING_SENTENCES,
  resonanceTokens,
  stToHz,
  toFeedbackBaseline,
  type BaselineResults,
  type BaselineTask,
} from './plan.ts';

const task = (id: string): BaselineTask => BASELINE_TASKS.find((t) => t.id === id)!;
const hzToSt = (hz: number) => 69 + 12 * Math.log2(hz / 440);

/** A clean recording; override what a test is about. */
function result(over: Partial<TaskResult> = {}): TaskResult {
  const med = hzToSt(140);
  return {
    formatVersion: 1,
    kind: 'speech',
    coreVersion: '0.0.1',
    durationS: 30,
    sampleRate: 48_000,
    capture: {
      measurementMode: true,
      bluetoothInput: false,
      microphoneMode: 'standard',
      droppedSamples: 0,
      stoppedEarly: false,
    },
    levels: { peakDbfs: -6, clippedFraction: 0, voicedLevelMedianDbfs: -28 },
    pitch: {
      voicedS: 12,
      medianHz: 140,
      medianSt: med,
      p5St: med - 4,
      p10St: med - 3,
      p90St: med + 3,
      p95St: med + 4,
      sdSt: 2,
    },
    quality: {
      qualityVersion: 1,
      weightIndexVersion: 1,
      voicedS: 12,
      h1H2Db: 4,
      h1cH2cDb: 3,
      alphaRatioDb: -12,
      hammarbergDb: 20,
      lhRatioDb: 15,
      cppsDb: 14,
      hnrDb: 18,
      jitterLocal: 0.008,
      shimmerLocal: 0.05,
      periods: 1500,
      weightBaseline: {
        h1cH2cDb: { mean: 3, sd: 2 },
        alphaRatioDb: { mean: -12, sd: 3 },
        cppsDb: { mean: 14, sd: 2 },
      },
    },
    vowel: null,
    audioUri: null,
    ...over,
  };
}

function vowel(f1: number, f2: number, f3: number, confidence = 0.8, ceilingHz = 5000, deltaFHz = 1000): TaskResult {
  return result({
    kind: 'vowel',
    durationS: 6,
    pitch: { ...result().pitch!, voicedS: 4 },
    vowel: {
      f0MedianHz: 140,
      ceilingHz,
      f1Hz: f1,
      f2Hz: f2,
      f3Hz: f3,
      f4Hz: null,
      deltaFHz,
      avtlCm: 35_000 / (2 * deltaFHz),
      deltaFPosition: 0.4,
      confidence,
    },
  });
}

test('the baseline covers the handbook’s tasks: /a/ /i/ /u/, a glide, a passage, 30 s of speech', () => {
  assert.deepEqual(
    BASELINE_TASKS.map((t) => t.taskId),
    [
      'baseline.vowel.a',
      'baseline.vowel.i',
      'baseline.vowel.u',
      'baseline.glide',
      'baseline.reading',
      'baseline.spontaneous',
    ],
  );
  assert.equal(task('spontaneous').recordSeconds, 30);
  assert.deepEqual(
    BASELINE_TASKS.flatMap((t) => (t.vowel ? [t.vowel.code] : [])),
    ['ah', 'iy', 'uw'],
  );
  assert.equal(READING_SENTENCES.length, 6);
});

test('every task needs at least 1 s of voiced audio before it is scored (handbook §3.1)', () => {
  for (const t of BASELINE_TASKS) assert.ok(t.minVoicedS >= 1, t.id);
});

test('a clean recording has no issues', () => {
  assert.deepEqual(checkTask(task('reading'), result()), []);
  assert.deepEqual(checkTask(task('vowel-a'), vowel(700, 1100, 2500)), []);
});

test('too little voice blocks, and silence blocks', () => {
  const quiet = result({ pitch: { ...result().pitch!, voicedS: 1.2 } });
  assert.deepEqual(
    checkTask(task('reading'), quiet).map((i) => [i.code, i.blocking]),
    [['too-little-voice', true]],
  );
  const silent = checkTask(task('vowel-i'), result({ kind: 'vowel', pitch: null }));
  assert.ok(!isUsable(silent));
  // No second complaint about a missing vowel when there was no voice at all.
  assert.deepEqual(
    silent.map((i) => i.code),
    ['too-little-voice'],
  );
});

test('stopping spontaneous speech early blocks', () => {
  const issues = checkTask(task('spontaneous'), result({ durationS: 12 }));
  assert.ok(issues.some((i) => i.code === 'too-short' && i.blocking));
  // Reading has no minimum duration: Done ends it.
  assert.deepEqual(checkTask(task('reading'), result({ durationS: 12 })), []);
});

test('clipping blocks', () => {
  const r = result({ levels: { peakDbfs: 0, clippedFraction: 0.01, voicedLevelMedianDbfs: -3 } });
  assert.ok(!isUsable(checkTask(task('reading'), r)));
  const tiny = result({ levels: { peakDbfs: 0, clippedFraction: 0.0001, voicedLevelMedianDbfs: -10 } });
  assert.ok(isUsable(checkTask(task('reading'), tiny)));
});

test('a vowel with no steady formants blocks; low formant confidence only warns', () => {
  const none = checkTask(task('vowel-u'), result({ kind: 'vowel', vowel: null }));
  assert.deepEqual(
    none.map((i) => [i.code, i.blocking]),
    [['no-vowel', true]],
  );
  const shaky = checkTask(task('vowel-u'), vowel(350, 900, 2400, 0.3));
  assert.deepEqual(
    shaky.map((i) => [i.code, i.blocking]),
    [['low-confidence', false]],
  );
});

test('a narrow glide never blocks, and the message never asks to push (handbook E2)', () => {
  const st = hzToSt(150);
  const narrow = result({
    kind: 'glide',
    pitch: { ...result().pitch!, p5St: st - 1, p95St: st + 1.5 },
  });
  const issues = checkTask(task('glide'), narrow);
  assert.deepEqual(
    issues.map((i) => [i.code, i.blocking]),
    [['narrow-glide', false]],
  );
  assert.match(issues[0].message, /never push/i);
  assert.deepEqual(checkTask(task('glide'), result({ kind: 'glide' })), []);
});

test('processed or Bluetooth audio warns without blocking', () => {
  const bt = result({ capture: { ...result().capture, bluetoothInput: true } });
  assert.deepEqual(
    checkTask(task('reading'), bt).map((i) => [i.code, i.blocking]),
    [['bluetooth', false]],
  );
  const iso = result({ capture: { ...result().capture, microphoneMode: 'voiceIsolation' } });
  assert.deepEqual(
    checkTask(task('reading'), iso).map((i) => i.code),
    ['processed'],
  );
  const notMeasurement = result({ capture: { ...result().capture, measurementMode: false } });
  assert.ok(isUsable(checkTask(task('reading'), notMeasurement)));
});

function fullResults(): BaselineResults {
  const st = hzToSt(150);
  return {
    // Hillenbrand men's means for /ɑ i u/, roughly.
    'vowel-a': vowel(768, 1333, 2522, 0.9, 5000, 1000),
    'vowel-i': vowel(342, 2322, 3000, 0.8, 5250, 1100),
    'vowel-u': vowel(378, 997, 2343, 0.6, 4750, 900),
    glide: result({
      kind: 'glide',
      pitch: { ...result().pitch!, p5St: st - 7, p10St: st - 6, p90St: st + 10, p95St: st + 12 },
    }),
    reading: result({ levels: { peakDbfs: -8, clippedFraction: 0, voicedLevelMedianDbfs: -25 } }),
    spontaneous: result({ pitch: { ...result().pitch!, medianHz: 130, medianSt: hzToSt(130) } }),
  };
}

test('the summary takes the comfortable range from the glide: 5th–95th percentile, ceiling at the 90th', () => {
  const s = buildSummary(fullResults(), null);
  const st = hzToSt(150);
  assert.ok(s.comfortableRange);
  assert.ok(Math.abs(s.comfortableRange.lowSt - (st - 7)) < 1e-9);
  assert.ok(Math.abs(s.comfortableRange.highSt - (st + 12)) < 1e-9);
  // Handbook §2.4/§3.9: the safety ceiling is the comfortable 90th percentile.
  assert.ok(Math.abs(s.comfortableRange.ceilingSt - (st + 10)) < 1e-9);
  assert.ok(Math.abs(s.comfortableRange.spanSt - 19) < 1e-9);
});

test('speaking pitch comes from spontaneous speech, falling back to the reading', () => {
  const r = fullResults();
  assert.equal(buildSummary(r, null).speaking?.source, 'spontaneous');
  assert.equal(buildSummary(r, null).speaking?.medianHz, 130);
  delete r.spontaneous;
  const s = buildSummary(r, null);
  assert.equal(s.speaking?.source, 'reading');
  assert.equal(s.speaking?.medianHz, 140);
  // The reading is also the weight-index baseline.
  assert.deepEqual(s.weightBaseline, result().quality.weightBaseline);
  // Pitch range is reported as the 5th–95th percentile in ST (handbook §3.2).
  assert.equal(s.reading?.rangeSt, 8);
});

test('vowel measurements: formant ceiling and ΔF are medians over the vowels', () => {
  const s = buildSummary(fullResults(), null);
  assert.equal(s.formantCeilingHz, 5000);
  assert.equal(s.vocalTract?.deltaFHz, 1000);
  assert.equal(s.vowels.i?.f2Hz, 2322);
  assert.equal(s.vowels.u?.confidence, 0.6);
});

test('resonance tokens use the reference vowel codes, weighted by formant confidence', () => {
  const tokens = resonanceTokens(fullResults());
  assert.deepEqual(
    tokens.map((t) => [t.vowel, t.weight]),
    [
      ['ah', 0.9],
      ['iy', 0.8],
      ['uw', 0.6],
    ],
  );
  const s = buildSummary(fullResults(), { version: 1, score: 0.1, f1: 0, f2: 0.1, f3: 0.2, tokensUsed: 3 });
  assert.deepEqual(s.resonance, { version: 1, score: 0.1, tokensUsed: 3 });
  assert.equal(buildSummary(fullResults(), { version: null, score: null, f1: null, f2: null, f3: null, tokensUsed: 0 }).resonance, null);
});

test('reduced accuracy is flagged when any recording was processed', () => {
  const r = fullResults();
  assert.equal(buildSummary(r, null).reducedAccuracy, false);
  r.glide = result({ kind: 'glide', capture: { ...result().capture, bluetoothInput: true } });
  assert.equal(buildSummary(r, null).reducedAccuracy, true);
});

test('missing tasks', () => {
  const r = fullResults();
  assert.deepEqual(missingTasks(r), []);
  delete r['vowel-u'];
  assert.deepEqual(missingTasks(r), ['vowel-u']);
});

test('helpers', () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 2, 3]), 2.5);
  assert.equal(median([]), null);
  assert.ok(Math.abs(stToHz(69) - 440) < 1e-9);
  assert.equal(noteName(69), 'A4');
  assert.equal(noteName(hzToSt(130.8)), 'C3');
  assert.equal(noteName(hzToSt(220)), 'A3');
});

test('the feedback engine gets the glide’s p10/p90 as the comfortable range, p90 being the safety ceiling', () => {
  const summary = buildSummary(fullResults(), { version: 1, score: 0.2, f1: 0, f2: 0.2, f3: 0.3, tokensUsed: 3 });
  const st = hzToSt(150);
  const b = toFeedbackBaseline(summary);
  assert.ok(b);
  assert.equal(b.source, 'baseline');
  assert.ok(Math.abs(b.comfortableP10St - (st - 6)) < 1e-9);
  assert.ok(Math.abs(b.comfortableP90St - (st + 10)) < 1e-9);
  assert.ok(Math.abs(b.medianSt - hzToSt(130)) < 1e-9);
  assert.equal(b.resonance, 0.2);
  // F2 by Hillenbrand code, all three vowels at confidence ≥ 0.5.
  assert.deepEqual(b.vowelF2Hz, { ah: 1333, iy: 2322, uw: 997 });
});

test('low-confidence vowels give the feedback engine no F2', () => {
  const r = fullResults();
  r['vowel-u'] = vowel(378, 997, 2343, 0.3);
  const b = toFeedbackBaseline(buildSummary(r, null));
  assert.deepEqual(Object.keys(b!.vowelF2Hz).sort(), ['ah', 'iy']);
  assert.equal(b!.resonance, null);
});

test('stored summaries: captured and provisional baselines are both read', () => {
  const summary = JSON.parse(JSON.stringify(buildSummary(fullResults(), null)));
  assert.ok(isBaselineSummary(summary));
  assert.equal(feedbackBaselineFrom(summary)?.source, 'baseline');
  const provisional = {
    medianSt: 50,
    p10St: 47,
    p90St: 53,
    comfortableP10St: 47,
    comfortableP90St: 53,
    vowelF2Hz: {},
    resonance: null,
    source: 'provisional',
  };
  assert.ok(!isBaselineSummary(provisional));
  assert.equal(feedbackBaselineFrom(provisional)?.source, 'provisional');
  assert.equal(feedbackBaselineFrom(null), null);
  assert.equal(feedbackBaselineFrom({ version: 1 }), null);
});
