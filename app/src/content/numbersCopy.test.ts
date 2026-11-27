import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { GENDERED_TERMS } from '../feedback/labels.ts';
import { NUMBERS_SECTIONS } from './numbersCopy.ts';

// The published page (docs/how-the-numbers-work.md) must say what the app says.
test('the published page matches the in-app copy', () => {
  const md = readFileSync(new URL('../../../docs/how-the-numbers-work.md', import.meta.url), 'utf8');
  for (const s of NUMBERS_SECTIONS) {
    assert.ok(md.includes(`## ${s.title}`), s.title);
    for (const p of s.body) assert.ok(md.includes(p), p);
    if (s.limits) assert.ok(md.includes(s.limits), s.limits);
  }
});

test('the copy is education-only and neutral (D2, D3)', () => {
  const text = NUMBERS_SECTIONS.flatMap((s) => [s.title, ...s.body, s.limits ?? '']).join(' ');
  assert.doesNotMatch(text, /\b(therapy|treatment|diagnos\w*|clinical|dysphonia)\b/i);
  assert.doesNotMatch(text, new RegExp(`\\b(${GENDERED_TERMS.join('|')})\\b`, 'i'));
});

test('the published privacy policy matches the in-app one', async () => {
  const { PRIVACY_SECTIONS, PRIVACY_VERSION } = await import('./privacyCopy.ts');
  const md = readFileSync(new URL('../../../docs/privacy-policy.md', import.meta.url), 'utf8');
  assert.ok(md.includes(PRIVACY_VERSION));
  for (const s of PRIVACY_SECTIONS) {
    assert.ok(md.includes(`## ${s.title}`), s.title);
    for (const p of s.body) assert.ok(md.includes(p), p);
  }
});
