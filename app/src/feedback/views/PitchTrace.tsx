import { Canvas, DashPathEffect, Line, Path, Rect, Skia } from '@shopify/react-native-skia';
import { useMemo } from 'react';

import { useTheme } from '../../ui/theme';
import { AXIS_LABELS } from '../labels.ts';
import { TRACE_WINDOW_S, type TracePoint } from '../fading.ts';
import { octaveLines, stToY, traceX, type Axis } from '../geometry.ts';
import { classifyPitch, type PitchZone } from '../zones.ts';
import { ChartCard, ChartLabel, v } from './chart';

const HEIGHT = 220;

/**
 * Live pitch on a semitone axis with the target zone (handbook §3.9).
 * Segments in the zone are drawn in the zone colour; anything above the
 * comfortable p90 is drawn in the caution colour and never in the zone
 * colour, whatever the zone says (§2.4: never reward F0 above it).
 */
export function PitchTrace({
  points,
  tEnd,
  axis,
  zone,
  caption,
}: {
  points: TracePoint[];
  tEnd: number;
  axis: Axis;
  zone: PitchZone | null;
  caption?: string;
}) {
  return (
    <ChartCard title="Pitch" height={HEIGHT} caption={caption ?? `Last ${TRACE_WINDOW_S} s · ↑ ${AXIS_LABELS.pitch.high}`}>
      {(width) => <TraceCanvas width={width} points={points} tEnd={tEnd} axis={axis} zone={zone} />}
    </ChartCard>
  );
}

function TraceCanvas({
  width,
  points,
  tEnd,
  axis,
  zone,
}: {
  width: number;
  points: TracePoint[];
  tEnd: number;
  axis: Axis;
  zone: PitchZone | null;
}) {
  const { c } = useTheme();
  const y = (st: number) => stToY(st, axis, HEIGHT);
  const paths = useMemo(() => {
    const kinds = { plain: Skia.PathBuilder.Make(), zone: Skia.PathBuilder.Make(), caution: Skia.PathBuilder.Make() };
    let prev: { x: number; y: number } | null = null;
    for (const p of points) {
      if (p.st == null || !Number.isFinite(p.st)) {
        prev = null;
        continue;
      }
      const pt = { x: traceX(p.t, tEnd, TRACE_WINDOW_S, width), y: stToY(p.st, axis, HEIGHT) };
      const cls = zone ? classifyPitch(p.st, zone) : 'plain';
      const kind = cls === 'above-comfortable' ? 'caution' : cls === 'in' ? 'zone' : 'plain';
      // Each segment takes the class of its end point; a lone point is a dot.
      kinds[kind].moveTo(prev?.x ?? pt.x - 1, prev?.y ?? pt.y).lineTo(pt.x, pt.y);
      prev = pt;
    }
    return { plain: kinds.plain.detach(), zone: kinds.zone.detach(), caution: kinds.caution.detach() };
  }, [points, tEnd, width, axis, zone]);

  const p90Y = zone ? y(zone.comfortableP90St) : null;
  return (
    <>
      <Canvas style={{ width, height: HEIGHT }}>
        {zone ? <Rect x={0} y={y(zone.hi)} width={width} height={y(zone.lo) - y(zone.hi)} color={c.zoneTint} /> : null}
        {octaveLines(axis).map((st) => (
          <Line key={st} p1={v(0, y(st))} p2={v(width, y(st))} color={c.line} strokeWidth={1} />
        ))}
        {p90Y != null ? (
          <Line p1={v(0, p90Y)} p2={v(width, p90Y)} color={c.dimBrightness} strokeWidth={1.5}>
            <DashPathEffect intervals={[6, 5]} />
          </Line>
        ) : null}
        <Path path={paths.plain} style="stroke" strokeWidth={3} color={c.dimPitch} strokeCap="round" strokeJoin="round" />
        <Path path={paths.zone} style="stroke" strokeWidth={3} color={c.zone} strokeCap="round" strokeJoin="round" />
        <Path path={paths.caution} style="stroke" strokeWidth={3} color={c.dimBrightness} strokeCap="round" strokeJoin="round" />
      </Canvas>
      {octaveLines(axis).map((st) => (
        <ChartLabel key={st} x={4} y={y(st) - 8}>
          {`C${st / 12 - 1}`}
        </ChartLabel>
      ))}
      {p90Y != null ? (
        <ChartLabel x={4} y={p90Y - 8} align="right" color={c.dimBrightness}>
          comfortable top
        </ChartLabel>
      ) : null}
      {zone ? (
        <ChartLabel x={4} y={y(zone.hi) + 10} align="right" color={c.zone}>
          your zone
        </ChartLabel>
      ) : null}
    </>
  );
}
