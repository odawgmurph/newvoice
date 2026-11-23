import { Canvas, Circle, Path, Rect } from '@shopify/react-native-skia';

import { useTheme } from '../../ui/theme';
import { AXIS_LABELS, referenceLabels } from '../labels.ts';
import { ellipse, vowelPoint } from '../geometry.ts';
import { REFERENCE_NORMS } from '../referenceNorms.ts';
import type { Range } from '../zones.ts';
import { ChartCard, ChartLabel, polyline } from './chart';

const HEIGHT = 260;

export type VowelDot = { f1Hz: number; f2Hz: number };

/**
 * F1×F2 vowel chart with the two reference groups' ellipses for the
 * chosen vowel (handbook §3.9), 1 SD and 2 SD (about 39% and 86% of
 * reference tokens). Named neutrally ("darker/brighter reference") unless
 * the user opted in. Live dots are confident frames only.
 */
export function VowelChart({
  vowel,
  live,
  utterance,
  f2Zone,
  genderedBands,
}: {
  vowel: string;
  live: VowelDot[];
  utterance: VowelDot | null;
  f2Zone: Range | null;
  genderedBands: boolean;
}) {
  const norm = REFERENCE_NORMS.vowels[vowel];
  const refs = referenceLabels(genderedBands);
  return (
    <ChartCard
      title={`Vowel space · /${norm?.ipa ?? vowel}/ as in “${norm?.word ?? ''}”`}
      height={HEIGHT}
      caption={`← ${AXIS_LABELS.vowelF2.high} · ${AXIS_LABELS.vowelF2.low} → (F2) · ↓ ${AXIS_LABELS.vowelF1.high} (F1). ${refs.source}`}
    >
      {(width) => <VowelCanvas width={width} vowel={vowel} live={live} utterance={utterance} f2Zone={f2Zone} genderedBands={genderedBands} />}
    </ChartCard>
  );
}

function VowelCanvas({
  width,
  vowel,
  live,
  utterance,
  f2Zone,
  genderedBands,
}: {
  width: number;
  vowel: string;
  live: VowelDot[];
  utterance: VowelDot | null;
  f2Zone: Range | null;
  genderedBands: boolean;
}) {
  const { c } = useTheme();
  const size = { width, height: HEIGHT };
  const norm = REFERENCE_NORMS.vowels[vowel];
  if (!norm) return null;
  const refs = referenceLabels(genderedBands);
  const shapes = (['low', 'high'] as const).flatMap((end) =>
    [1, 2].map((k) => ({
      key: `${end}${k}`,
      end,
      k,
      path: polyline(
        ellipse(norm[end].f1f2MeanHz, norm[end].f1f2CovHz, k).map(([f1, f2]) => vowelPoint(f1, f2, size)),
        true,
      ),
    })),
  );
  const zoneX = f2Zone ? [vowelPoint(400, f2Zone.hi, size).x, vowelPoint(400, f2Zone.lo, size).x] : null;
  const colour = (end: 'low' | 'high') => (end === 'low' ? c.dimPitch : c.dimBrightness);
  return (
    <>
      <Canvas style={{ width, height: HEIGHT }}>
        {zoneX ? <Rect x={zoneX[0]} y={0} width={zoneX[1] - zoneX[0]} height={HEIGHT} color={c.zoneTint} /> : null}
        {shapes.map((s) => (
          <Path
            key={s.key}
            path={s.path}
            style="stroke"
            strokeWidth={s.k === 1 ? 2 : 1}
            color={colour(s.end)}
            opacity={s.k === 1 ? 0.9 : 0.45}
          />
        ))}
        {live.map((d, i) => {
          const p = vowelPoint(d.f1Hz, d.f2Hz, size);
          return <Circle key={i} cx={p.x} cy={p.y} r={3} color={c.ink} opacity={0.25 + (0.6 * (i + 1)) / live.length} />;
        })}
        {utterance ? (
          <Circle
            cx={vowelPoint(utterance.f1Hz, utterance.f2Hz, size).x}
            cy={vowelPoint(utterance.f1Hz, utterance.f2Hz, size).y}
            r={8}
            color={c.zone}
            style="stroke"
            strokeWidth={3}
          />
        ) : null}
      </Canvas>
      {(['low', 'high'] as const).map((end) => {
        const p = vowelPoint(norm[end].f1f2MeanHz[0], norm[end].f1f2MeanHz[1], size);
        return (
          <ChartLabel key={end} x={p.x} y={p.y + 4} align="center" color={colour(end)}>
            {refs[end]}
          </ChartLabel>
        );
      })}
      {zoneX ? (
        <ChartLabel x={zoneX[0] + 4} y={10} color={c.zone}>
          your zone
        </ChartLabel>
      ) : null}
    </>
  );
}
