// Runs the app's strain monitor (app/src/feedback/strain.ts) over the
// strain fixture and prints JSON for harness/validation/strain.py.
// Usage: node --experimental-strip-types strain-eval.mjs <fixture.json>
import { readFileSync } from 'node:fs';

import { STRAIN_RULES, StrainMonitor, trendRatios } from '../../app/src/feedback/strain.ts';

const fixture = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const sessions = [];
const healthyRatios = { jitter: 0, shimmer: 0, cppsDrop: -Infinity };

for (const s of fixture.sessions) {
  const m = new StrainMonitor({ comfortableP90St: s.comfortableP90St });
  let firstRestAt = null;
  const reasons = [];
  s.utterances.forEach((u, i) => {
    const fresh = m.addUtterance(u);
    if (fresh.length > 0 && firstRestAt == null) firstRestAt = i + 1;
    for (const r of fresh) if (!reasons.includes(r)) reasons.push(r);
  });
  sessions.push({ name: s.name, expectRest: s.expectRest, firstRestAt, reasons });
  if (!s.expectRest) {
    // Largest change at any point of the session, as the monitor saw it.
    for (let n = 1; n <= s.utterances.length; n++) {
      const r = trendRatios(s.utterances.slice(0, n));
      if (r == null) continue;
      healthyRatios.jitter = Math.max(healthyRatios.jitter, r.jitter);
      healthyRatios.shimmer = Math.max(healthyRatios.shimmer, r.shimmer);
      healthyRatios.cppsDrop = Math.max(healthyRatios.cppsDrop, r.cppsDrop);
    }
  }
}

process.stdout.write(JSON.stringify({ rules: STRAIN_RULES, sessions, healthyRatios }) + '\n');
