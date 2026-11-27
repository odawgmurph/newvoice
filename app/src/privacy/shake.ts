// Shake-to-exit detection (Stage 4 quick-exit gesture; handbook §4.3). Pure,
// so `npm test` can check it doesn't fire on ordinary handling.
//
// A shake is several sharp jolts in a short time: at least `peaks`
// accelerometer readings above `thresholdG` (total acceleration, in g)
// within `windowMs`, each separated by `minGapMs` so one jolt counts once.
// Walking peaks around 1.2–1.5 g and setting a phone down briefly reaches
// about 2 g; a deliberate shake goes well past 2.5 g repeatedly.

export const SHAKE = { thresholdG: 2.5, peaks: 3, windowMs: 1200, minGapMs: 120 } as const;

export class ShakeDetector {
  private times: number[] = [];

  /** Feed one reading (x, y, z in g). Returns true when a shake completes. */
  push(x: number, y: number, z: number, t: number): boolean {
    const g = Math.sqrt(x * x + y * y + z * z);
    if (g < SHAKE.thresholdG) return false;
    const last = this.times[this.times.length - 1];
    if (last != null && t - last < SHAKE.minGapMs) return false;
    this.times = [...this.times.filter((s) => t - s <= SHAKE.windowMs), t];
    if (this.times.length >= SHAKE.peaks) {
      this.times = [];
      return true;
    }
    return false;
  }
}
