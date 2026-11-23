import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import {
  AXIS_LABELS,
  directionLabel,
  GENDERED_TERMS,
  NEUTRAL_LABELS,
  referenceLabels,
  showReferenceBands,
} from './labels.ts';

// Stage 3 exit gate: no gendered labels without opt-in (decision D2,
// handbook §3.6/§4.3). Every word that genders a voice must live in the
// marked opt-in block of labels.ts; anywhere else in the feedback engine,
// its views or the practice screen it fails this test. Comments are
// ignored: they are not shown to anyone. Two other exemptions, both
// explicit: the audit's own term list (<audit-list>), and lines marked
// "audit: goal key", where 'feminine' is the value of the goal the user
// picked in onboarding (schema GOALS), a stored setting, not a label.

const FEEDBACK_DIR = new URL('.', import.meta.url).pathname;
const SCANNED = [FEEDBACK_DIR, join(FEEDBACK_DIR, '..', 'app', 'practice.tsx')];

function sourceFiles(path: string): string[] {
  if (statSync(path).isFile()) return [path];
  return readdirSync(path).flatMap((name) => {
    const p = join(path, name);
    if (statSync(p).isDirectory()) return sourceFiles(p);
    return /\.tsx?$/.test(name) && !name.endsWith('.test.ts') ? [p] : [];
  });
}

/** Source with comments and the opt-in block removed. */
function shownCode(text: string): string {
  return text
    .replace(/\/\/ <gendered-opt-in>[\s\S]*?\/\/ <\/gendered-opt-in>/g, '')
    .replace(/\/\/ <audit-list>[\s\S]*?\/\/ <\/audit-list>/g, '')
    // On a marked line only the goal value itself is exempt.
    .replace(/^(.*)\/\/ audit: goal key$/gm, (_, code: string) => code.replace(/\bfeminine\b/g, ''))
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
}

const termPattern = new RegExp(`\\b(${GENDERED_TERMS.join('|')})\\b`, 'i');

test('no gendered word outside the opt-in block', () => {
  const files = SCANNED.flatMap(sourceFiles);
  assert.ok(files.length >= 5, `scanned only ${files.length} files`);
  const hits: string[] = [];
  for (const file of files) {
    const lines = shownCode(readFileSync(file, 'utf8')).split('\n');
    lines.forEach((line, i) => {
      const m = termPattern.exec(line);
      if (m) hits.push(`${file}:${i + 1}: "${m[0]}" in ${line.trim()}`);
    });
  }
  assert.deepEqual(hits, []);
});

test('the opt-in block is what the audit exempts, and it does gender', () => {
  const text = readFileSync(join(FEEDBACK_DIR, 'labels.ts'), 'utf8');
  const block = /\/\/ <gendered-opt-in>([\s\S]*?)\/\/ <\/gendered-opt-in>/.exec(text);
  assert.ok(block);
  assert.match(block[1], termPattern);
});

test('the audit catches a gendered string', () => {
  assert.match(shownCode("const label = 'Female range';"), termPattern);
  assert.doesNotMatch(shownCode('// typical women, in a comment\nconst x = 1;'), termPattern);
  assert.match(shownCode("const u = 'https://x.org/men'; // ok"), termPattern);
  assert.doesNotMatch(shownCode("  feminine: 1, // audit: goal key"), termPattern);
  // The goal-key marker exempts only the goal value, nothing else on its line.
  assert.match(shownCode("  label: 'female', // audit: goal key"), termPattern);
});

test('default labels are neutral; opt-in labels are not', () => {
  const neutral = [
    ...Object.values(NEUTRAL_LABELS).flatMap((l) => Object.values(l)),
    ...Object.values(AXIS_LABELS).flatMap((l) => Object.values(l)),
    ...Object.values(referenceLabels(false)),
  ];
  for (const s of neutral) assert.doesNotMatch(s, termPattern, s);
  assert.match(referenceLabels(true).low, termPattern);
  assert.equal(showReferenceBands(false), false);
  assert.equal(showReferenceBands(true), true);
});

test('direction labels', () => {
  assert.equal(directionLabel('pitch', 1.5, 0.5), 'higher');
  assert.equal(directionLabel('pitch', -1.5, 0.5), 'lower');
  assert.equal(directionLabel('resonance', 0.2, 0.05), 'brighter');
  assert.equal(directionLabel('weight', -1, 0.5), 'lighter');
  assert.equal(directionLabel('intonation', 3, 2), 'rising');
  assert.equal(directionLabel('pitch', 0.2, 0.5), 'about the same');
  assert.equal(directionLabel('pitch', Number.NaN, 0.5), 'about the same');
});
