// Exercise items that depend on the user (Stage 5).

import type { PitchZone } from '../feedback/zones.ts';

/** Keep pitch-match targets at least this far under the comfortable p90 (§2.4: never reward above it). */
export const TARGET_MARGIN_ST = 0.5;

/**
 * Pitch-match targets (E1) from offsets around the zone centre: the zone
 * carries the baseline, the goal and the current level (zones.ts). Each is
 * kept between the bottom of the comfortable range and just under its p90,
 * so no target ever asks for pitch above the comfortable range.
 */
export function pitchTargets(offsetsSt: number[], zone: PitchZone, comfortableP10St: number): number[] {
  const hi = zone.comfortableP90St - TARGET_MARGIN_ST;
  return offsetsSt.map((o) => Math.round(Math.max(Math.min(zone.centre + o, hi), Math.min(comfortableP10St, hi)) * 10) / 10);
}
