import { Canvas, Circle, DashPathEffect, Line, Rect } from '@shopify/react-native-skia';

import { useTheme } from '../../ui/theme';
import { AXIS_LABELS, referenceLabels, showReferenceBands } from '../labels.ts';
import { mapPoint, octaveLines, RESONANCE_AXIS, type Axis } from '../geometry.ts';
import { REFERENCE_NORMS } from '../referenceNorms.ts';
import { hzToSt } from '../zones.ts';
import { ChartCard, ChartLabel, v } from './chart';

const HEIGHT = 240;

export type MapDot = { st: number; resonance: number };

/**
 * Pitch × resonance (handbook §3.9, like AcousticGender.space's plot):
 * resonance score across, pitch up. Each scored utterance is a dot, the
 * live voice a ring. The baseline and the target are marked. The reference
 * groups' areas appear only with the opt-in (§3.6).
 */
export function PitchResonanceMap({
  utterances,
  live,
  baseline,
  target,
  pitchAxis,
  genderedBands,
}: {
  utterances: MapDot[];
  live: MapDot | null;
  baseline: MapDot | null;
  target: MapDot | null;
  pitchAxis: Axis;
  genderedBands: boolean;
}) {
  const refs = referenceLabels(genderedBands);
  return (
    <ChartCard
      title="Pitch and brightness"
      height={HEIGHT}
      caption={`← ${AXIS_LABELS.resonance.low} · ${AXIS_LABELS.resonance.high} → · ↑ ${AXIS_LABELS.pitch.high}. Scored on the vowel you picked. ${refs.source}`}
    >
      {(width) => (
        <MapCanvas
          width={width}
          utterances={utterances}
          live={live}
          baseline={baseline}
          target={target}
          pitchAxis={pitchAxis}
          genderedBands={genderedBands}
        />
      )}
    </ChartCard>
  );
}

// Reference areas (opt-in only): x = the group's end of the resonance scale
// ± 0.25 (a quarter of the separation between the ends; a marker, not a
// spread), y = the group's speaker-median F0 ± 1 SD on a log scale (§1.2).
const REF_HALF_WIDTH = 0.25;

function MapCanvas({
  width,
  utterances,
  live,
  baseline,
  target,
  pitchAxis,
  genderedBands,
}: {
  width: number;
  utterances: MapDot[];
  live: MapDot | null;
  baseline: MapDot | null;
  target: MapDot | null;
  pitchAxis: Axis;
  genderedBands: boolean;
}) {
  const { c } = useTheme();
  const size = { width, height: HEIGHT };
  const at = (d: MapDot) => mapPoint(d.st, d.resonance, pitchAxis, size);
  const refs = referenceLabels(genderedBands);
  const areas = showReferenceBands(genderedBands)
    ? (['low', 'high'] as const).map((end) => {
        const g = REFERENCE_NORMS.groups[end].f0SpeakerMedianHz;
        const centre = end === 'low' ? 0 : 1;
        const a = mapPoint(hzToSt(Math.exp(g.logMean + g.logSd)), centre - REF_HALF_WIDTH, pitchAxis, size);
        const b = mapPoint(hzToSt(Math.exp(g.logMean - g.logSd)), centre + REF_HALF_WIDTH, pitchAxis, size);
        return { end, x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y, label: refs[end] };
      })
    : [];
  const x0 = mapPoint(pitchAxis.min, 0, pitchAxis, size).x;
  const x1 = mapPoint(pitchAxis.min, 1, pitchAxis, size).x;
  return (
    <>
      <Canvas style={{ width, height: HEIGHT }}>
        {areas.map((r) => (
          <Rect key={r.end} x={r.x} y={r.y} width={r.w} height={r.h} color={c.surface300} />
        ))}
        {octaveLines(pitchAxis).map((st) => {
          const y = mapPoint(st, 0, pitchAxis, size).y;
          return <Line key={st} p1={v(0, y)} p2={v(width, y)} color={c.line} strokeWidth={1} />;
        })}
        {[x0, x1].map((x) => (
          <Line key={x} p1={v(x, 0)} p2={v(x, HEIGHT)} color={c.line} strokeWidth={1}>
            <DashPathEffect intervals={[4, 4]} />
          </Line>
        ))}
        {baseline ? <Circle cx={at(baseline).x} cy={at(baseline).y} r={6} color={c.inkMuted} /> : null}
        {target ? <Circle cx={at(target).x} cy={at(target).y} r={11} color={c.zone} style="stroke" strokeWidth={2.5} /> : null}
        {utterances.map((d, i) => {
          const p = at(d);
          // Older utterances fade so the newest stands out.
          const alpha = 0.35 + (0.65 * (i + 1)) / utterances.length;
          return <Circle key={i} cx={p.x} cy={p.y} r={5} color={c.dimBrightness} opacity={alpha} />;
        })}
        {live ? <Circle cx={at(live).x} cy={at(live).y} r={8} color={c.dimPitch} style="stroke" strokeWidth={3} /> : null}
      </Canvas>
      {areas.map((r) => (
        <ChartLabel key={r.end} x={r.x + r.w / 2} y={r.y - 6} align="center">
          {r.label}
        </ChartLabel>
      ))}
      <ChartLabel x={4} y={HEIGHT - 6}>
        {AXIS_LABELS.resonance.low}
      </ChartLabel>
      <ChartLabel x={4} y={HEIGHT - 6} align="right">
        {AXIS_LABELS.resonance.high}
      </ChartLabel>
      {baseline ? (
        <ChartLabel x={at(baseline).x + 8} y={at(baseline).y}>
          start
        </ChartLabel>
      ) : null}
      {target ? (
        <ChartLabel x={at(target).x + 14} y={at(target).y} color={c.zone}>
          target
        </ChartLabel>
      ) : null}
    </>
  );
}

export const MAP_RESONANCE_AXIS = RESONANCE_AXIS;
