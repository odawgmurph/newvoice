import { Skia, vec, type SkPath } from '@shopify/react-native-skia';
import { useState, type ReactNode } from 'react';
import { StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';

import { radius, space, type, useTheme } from '../../ui/theme';
import type { Point } from '../geometry.ts';

/** A chart card that measures its own width, so charts fill the screen column. */
export function ChartCard({
  title,
  caption,
  height,
  children,
}: {
  title: string;
  caption?: string;
  height: number;
  children: (width: number) => ReactNode;
}) {
  const { c } = useTheme();
  const [width, setWidth] = useState(0);
  const onLayout = (e: LayoutChangeEvent) => setWidth(Math.floor(e.nativeEvent.layout.width));
  return (
    <View style={[styles.card, { backgroundColor: c.surface200, borderColor: c.line }]}>
      <Text style={[styles.title, { color: c.ink }]}>{title}</Text>
      <View style={{ height }} onLayout={onLayout}>
        {width > 0 ? children(width) : null}
      </View>
      {caption ? <Text style={[styles.caption, { color: c.inkMuted }]}>{caption}</Text> : null}
    </View>
  );
}

/** A text label positioned over a chart. */
export function ChartLabel({
  x,
  y,
  children,
  align = 'left',
  color,
}: {
  x: number;
  y: number;
  children: ReactNode;
  align?: 'left' | 'right' | 'center';
  color?: string;
}) {
  const { c } = useTheme();
  const shift = align === 'right' ? { right: x } : align === 'center' ? { left: x - 60, width: 120 } : { left: x };
  return (
    <Text
      style={[styles.label, { top: y - 8, color: color ?? c.inkMuted, textAlign: align }, shift]}
      numberOfLines={1}
    >
      {children}
    </Text>
  );
}

/** A polyline (open or closed) through points. */
export function polyline(points: Point[], close = false): SkPath {
  const p = Skia.PathBuilder.Make();
  points.forEach((pt, i) => (i === 0 ? p.moveTo(pt.x, pt.y) : p.lineTo(pt.x, pt.y)));
  if (close && points.length > 2) p.close();
  return p.detach();
}

export const v = vec;

const styles = StyleSheet.create({
  card: { borderRadius: radius.lg, borderWidth: 1, padding: space[4], marginBottom: space[4] },
  title: { ...type.label, marginBottom: space[2] },
  caption: { ...type.caption, marginTop: space[2] },
  label: { ...type.caption, position: 'absolute' },
});
