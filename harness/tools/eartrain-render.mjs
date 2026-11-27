// Renders ear-training stimuli with the app's synthesiser
// (app/src/eartraining/synth.ts) for harness/tests/test_eartraining.py.
// Usage: node --experimental-strip-types eartrain-render.mjs <out-dir>
// Writes one WAV per sound and stimuli.json with the parameters asked for.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { DIFFERENCES } from '../../app/src/eartraining/staircase.ts';
import { makeTrial, renderVowel, SAMPLE_RATE, wavBytes } from '../../app/src/eartraining/synth.ts';

const out = process.argv[2];
mkdirSync(out, { recursive: true });
const items = [];
for (const dimension of ['pitch', 'brightness', 'weight']) {
  // The easiest level, the Unit 1 checkpoint level and the finest level.
  for (const level of [0, 4, 9]) {
    for (const seed of [1, 2, 3]) {
      const t = makeTrial(dimension, 'ab', DIFFERENCES[dimension][level], seed * 101 + level);
      const up = t.sounds[t.answer];
      const down = t.sounds[1 - t.answer];
      const name = `${dimension}-${level}-${seed}`;
      writeFileSync(join(out, `${name}-up.wav`), wavBytes(renderVowel(up)));
      writeFileSync(join(out, `${name}-down.wav`), wavBytes(renderVowel(down)));
      // The same pair at 100 Hz F0, where LPC formants are reliable (handbook
      // §3.3: at higher F0 they snap to harmonics), to check the envelope.
      writeFileSync(join(out, `${name}-up-low.wav`), wavBytes(renderVowel({ ...up, f0Hz: 100 })));
      writeFileSync(join(out, `${name}-down-low.wav`), wavBytes(renderVowel({ ...down, f0Hz: 100 })));
      items.push({ name, dimension, level, difference: t.difference, up, down });
    }
  }
}
writeFileSync(join(out, 'stimuli.json'), JSON.stringify({ sampleRate: SAMPLE_RATE, items }, null, 1));
