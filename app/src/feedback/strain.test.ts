import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { STRAIN_RULES, StrainMonitor, trendRatios, type StrainReason } from './strain.ts';
import type { UtteranceSummary } from './types.ts';

function utt(over: Partial<UtteranceSummary> & { medianSt?: number } = {}): UtteranceSummary {
  const { medianSt = 54, ...rest } = over;
  return {
    startS: 0,
    endS: 2,
    voicedS: 2,
    scored: true,
    pitch: { medianHz: 185, medianSt, p10St: medianSt - 1, p90St: medianSt + 1, sdSt: 0.6, range5to95St: 2.5 },
    terminalSlopeStPerS: null,
    f1Hz: null,
    f2Hz: null,
    f3Hz: null,
    formantConfidence: 0.8,
    resonance: null,
    weightIndex: null,
    h1cH2cDb: null,
    alphaRatioDb: null,
    cppsDb: 18,
    hnrDb: 20,
    jitterLocal: 0.004,
    shimmerLocal: 0.03,
    periods: 400,
    ...rest,
  };
}

function feed(m: StrainMonitor, list: UtteranceSummary[]): StrainReason[] {
  return list.flatMap((u) => m.addUtterance(u));
}

const steady = (n: number) => Array.from({ length: n }, () => utt());

test('a steady session never asks for a rest', () => {
  const m = new StrainMonitor({ comfortableP90St: 56 });
  assert.deepEqual(feed(m, steady(20)), []);
  assert.equal(m.restPending, false);
});

test('trend rules wait for minScored scored utterances', () => {
  const m = new StrainMonitor({ comfortableP90St: null });
  const list = [...steady(3), ...Array.from({ length: 2 }, () => utt({ jitterLocal: 0.03 }))];
  assert.equal(list.length, STRAIN_RULES.minScored - 1);
  assert.deepEqual(feed(m, list), []);
  assert.deepEqual(m.addUtterance(utt({ jitterLocal: 0.03 })), ['jitter-rising']);
  assert.equal(m.restPending, true);
});

test('unscored utterances are ignored', () => {
  const m = new StrainMonitor({ comfortableP90St: 56 });
  assert.deepEqual(m.addUtterance(utt({ scored: false, medianSt: 60 })), []);
  assert.deepEqual(feed(m, [...steady(3), ...Array.from({ length: 5 }, () => utt({ scored: false, jitterLocal: 0.05 }))]), []);
});

test('each acoustic sign triggers on its own', () => {
  const cases: [Partial<UtteranceSummary>, StrainReason][] = [
    [{ jitterLocal: 0.012 }, 'jitter-rising'],
    [{ shimmerLocal: 0.09 }, 'shimmer-rising'],
    [{ cppsDb: 18 - STRAIN_RULES.cppsDropDb - 0.5 }, 'cpps-falling'],
  ];
  for (const [bad, reason] of cases) {
    const m = new StrainMonitor({ comfortableP90St: null });
    const got = feed(m, [...steady(3), ...Array.from({ length: 3 }, () => utt(bad))]);
    assert.deepEqual(got, [reason], reason);
  }
});

test('a ratio without an absolute rise does not trigger (tiny baselines)', () => {
  const m = new StrainMonitor({ comfortableP90St: null });
  const low = Array.from({ length: 3 }, () => utt({ jitterLocal: 0.001 }));
  const doubled = Array.from({ length: 3 }, () => utt({ jitterLocal: 0.002 }));
  assert.deepEqual(feed(m, [...low, ...doubled]), []);
});

test('one bad utterance among good ones is not a trend', () => {
  const m = new StrainMonitor({ comfortableP90St: null });
  assert.deepEqual(feed(m, [...steady(5), utt({ jitterLocal: 0.03, cppsDb: 8 }), ...steady(4)]), []);
});

test('F0 above the comfortable p90 triggers at once', () => {
  const m = new StrainMonitor({ comfortableP90St: 56 });
  assert.deepEqual(m.addUtterance(utt({ medianSt: 55.9 })), []);
  assert.deepEqual(m.addUtterance(utt({ medianSt: 56.5 })), ['above-comfortable-range']);
  // Raised once per rest period…
  assert.deepEqual(m.addUtterance(utt({ medianSt: 57 })), []);
  m.acknowledgeRest();
  assert.equal(m.restPending, false);
  // …and again after a rest.
  assert.deepEqual(m.addUtterance(utt({ medianSt: 57 })), ['above-comfortable-range']);
});

test('no comfortable range: the F0 rule is off', () => {
  const m = new StrainMonitor({ comfortableP90St: null });
  assert.deepEqual(m.addUtterance(utt({ medianSt: 70 })), []);
});

test('effort of 6 or more asks for a rest, every time', () => {
  const m = new StrainMonitor({ comfortableP90St: null });
  assert.deepEqual(m.reportEffort(5), []);
  assert.equal(m.restPending, false);
  assert.deepEqual(m.reportEffort(6), ['effort']);
  assert.deepEqual(m.reportEffort(8), ['effort']);
  assert.equal(m.restPending, true);
});

test('after a rest the trend reference starts over', () => {
  const m = new StrainMonitor({ comfortableP90St: null });
  const worse = (n: number) => Array.from({ length: n }, () => utt({ jitterLocal: 0.012 }));
  assert.deepEqual(feed(m, [...steady(3), ...worse(3)]), ['jitter-rising']);
  m.acknowledgeRest();
  // Steady at the new level: no new trend.
  assert.deepEqual(feed(m, worse(8)), []);
  // Rising again from there is caught again.
  assert.deepEqual(feed(m, Array.from({ length: 3 }, () => utt({ jitterLocal: 0.03 }))), ['jitter-rising']);
});

test('trendRatios compares the last window with the first', () => {
  assert.equal(trendRatios(steady(5)), null);
  const r = trendRatios([...steady(3), utt({ scored: false, jitterLocal: 1 }), ...Array.from({ length: 3 }, () => utt({ jitterLocal: 0.008, cppsDb: 15 }))]);
  assert.ok(r != null);
  assert.equal(r.jitter, 2);
  assert.equal(r.shimmer, 1);
  assert.equal(r.cppsDrop, 3);
});

// Sessions generated by harness/validation/strain.py: deliberately strained
// synthetic voices, healthy synthetic voices and healthy read speech, all
// measured by the Rust core the way the phone measures them.
type FixtureSession = {
  name: string;
  source: 'synthetic' | 'librispeech';
  expectRest: boolean;
  onsetUtterance: number | null;
  comfortableP90St: number | null;
  utterances: UtteranceSummary[];
};
const fixture: { sessions: FixtureSession[] } = JSON.parse(
  readFileSync(new URL('./fixtures/strain-sessions.json', import.meta.url), 'utf8'),
);

function run(s: FixtureSession): { firstRestAt: number | null; reasons: StrainReason[] } {
  const m = new StrainMonitor({ comfortableP90St: s.comfortableP90St });
  let firstRestAt: number | null = null;
  const reasons: StrainReason[] = [];
  s.utterances.forEach((u, i) => {
    const fresh = m.addUtterance(u);
    if (fresh.length > 0 && firstRestAt == null) firstRestAt = i;
    for (const r of fresh) if (!reasons.includes(r)) reasons.push(r);
  });
  return { firstRestAt, reasons };
}

const SIGN: Record<string, StrainReason> = {
  jitter: 'jitter-rising',
  shimmer: 'shimmer-rising',
  noise: 'cpps-falling',
  'above-p90': 'above-comfortable-range',
};

test('fixture has strained, healthy synthetic and healthy real sessions', () => {
  const s = fixture.sessions;
  assert.ok(s.filter((x) => x.expectRest).length >= 8);
  assert.ok(s.filter((x) => !x.expectRest && x.source === 'synthetic').length >= 4);
  assert.ok(s.filter((x) => x.source === 'librispeech').length >= 20);
});

for (const s of fixture.sessions.filter((x) => x.expectRest)) {
  test(`deliberately strained: ${s.name} asks for a rest after its onset`, () => {
    const { firstRestAt, reasons } = run(s);
    assert.ok(firstRestAt != null, 'no rest prompt');
    assert.ok(firstRestAt >= (s.onsetUtterance ?? 0), `rest at ${firstRestAt}, before the onset`);
    const sign = Object.keys(SIGN).find((k) => s.name.startsWith(`strained-${k}-`));
    if (sign != null) assert.ok(reasons.includes(SIGN[sign]), `${reasons} lacks ${SIGN[sign]}`);
  });
}

test('no healthy session asks for a rest', () => {
  const alarms = fixture.sessions
    .filter((x) => !x.expectRest)
    .map((s) => ({ name: s.name, ...run(s) }))
    .filter((r) => r.firstRestAt != null);
  assert.deepEqual(alarms, []);
});
