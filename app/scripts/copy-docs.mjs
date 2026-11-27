// Regenerates docs/how-the-numbers-work.md and docs/privacy-policy.md from the in-app copy.
// Usage (from app/): node --experimental-strip-types scripts/copy-docs.mjs
import { writeFileSync } from 'node:fs';

import { NUMBERS_SECTIONS } from '../src/content/numbersCopy.ts';
import { PRIVACY_SECTIONS, PRIVACY_VERSION } from '../src/content/privacyCopy.ts';

let md =
  '# How the numbers work, and their limits\n\n' +
  'This page is also in the app (Home → How the numbers work). It is generated from `app/src/content/numbersCopy.ts`: ' +
  'edit that file, then run `node --experimental-strip-types scripts/copy-docs.mjs` in `app/`. A test checks the two agree.\n';
for (const s of NUMBERS_SECTIONS) {
  md += `\n## ${s.title}\n\n${s.body.join('\n\n')}\n`;
  if (s.limits) md += `\n**Limits:** ${s.limits}\n`;
}
writeFileSync(new URL('../../docs/how-the-numbers-work.md', import.meta.url), md);

let policy =
  '# NewVoice privacy policy\n\n' +
  `*${PRIVACY_VERSION}. A draft until counsel reviews it (decisions D3, D23). The app shows the same text under Settings → Privacy; ` +
  'it is generated from `app/src/content/privacyCopy.ts` by `scripts/copy-docs.mjs`.*\n';
for (const s of PRIVACY_SECTIONS) policy += `\n## ${s.title}\n\n${s.body.join('\n\n')}\n`;
writeFileSync(new URL('../../docs/privacy-policy.md', import.meta.url), policy);
