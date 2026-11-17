//! Cleaning a frame-by-frame F0 track: octave-jump guard, then median filter.

use crate::units::hz_to_st;

/// Settings for [`smooth`]. Defaults follow handbook §3.2.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct SmoothConfig {
    /// Median filter length in frames (odd; 1 disables it).
    pub median_frames: usize,
    /// Largest change between adjacent frames, in semitones, that counts as
    /// continuous.
    pub max_jump_st: f64,
    /// A run entered or left by a larger jump is dropped unless it lasts at
    /// least this many frames.
    pub min_run_frames: usize,
}

impl Default for SmoothConfig {
    fn default() -> Self {
        Self {
            median_frames: 5,
            max_jump_st: 7.0,
            min_run_frames: 5, // 50 ms at a 10 ms hop
        }
    }
}

/// Smooths a whole track whose ends are the ends of the signal.
pub fn smooth(raw: &[Option<f64>], cfg: &SmoothConfig) -> Vec<Option<f64>> {
    smooth_window(raw, cfg, false, false)
}

/// Smooths a window of a longer track.
///
/// `open_start` / `open_end` say the track continues past that edge (as in
/// streaming). A run touching an open edge may be longer than it looks, so it
/// is never dropped for being short.
pub fn smooth_window(
    raw: &[Option<f64>],
    cfg: &SmoothConfig,
    open_start: bool,
    open_end: bool,
) -> Vec<Option<f64>> {
    let n = raw.len();
    let st: Vec<Option<f64>> = raw.iter().map(|v| v.map(hz_to_st)).collect();

    // 1. Jump guard. Split voiced frames into continuity runs.
    let mut guarded = raw.to_vec();
    let mut i = 0;
    while i < n {
        if st[i].is_none() {
            i += 1;
            continue;
        }
        let start = i;
        i += 1;
        while i < n
            && let (Some(a), Some(b)) = (st[i - 1], st[i])
            && (b - a).abs() <= cfg.max_jump_st
        {
            i += 1;
        }
        let end = i; // exclusive
        let jump_before = start > 0 && st[start - 1].is_some();
        let jump_after = end < n && st[end].is_some();
        let touches_open = (open_start && start == 0) || (open_end && end == n);
        if end - start < cfg.min_run_frames && (jump_before || jump_after) && !touches_open {
            guarded[start..end].fill(None);
        }
    }

    // 2. Median over the voiced frames in a centred window.
    let radius = cfg.median_frames / 2;
    if radius == 0 {
        return guarded;
    }
    let mut out = vec![None; n];
    let mut buf = Vec::with_capacity(cfg.median_frames);
    for (i, o) in out.iter_mut().enumerate() {
        if guarded[i].is_none() {
            continue;
        }
        buf.clear();
        let lo = i.saturating_sub(radius);
        let hi = (i + radius).min(n - 1);
        buf.extend(guarded[lo..=hi].iter().flatten());
        buf.sort_by(f64::total_cmp);
        let m = buf.len();
        *o = Some(if m % 2 == 1 {
            buf[m / 2]
        } else {
            0.5 * (buf[m / 2 - 1] + buf[m / 2])
        });
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn track(values: &[f64]) -> Vec<Option<f64>> {
        values.iter().map(|&v| (v > 0.0).then_some(v)).collect()
    }

    #[test]
    fn short_octave_blip_is_removed() {
        let mut v = vec![200.0; 20];
        v[8] = 400.0;
        v[9] = 400.0;
        let out = smooth(&track(&v), &SmoothConfig::default());
        assert!(out.iter().all(|f| f.is_none_or(|f| f == 200.0)));
        assert_eq!(out[8], None);
        assert_eq!(out[10], Some(200.0));
    }

    #[test]
    fn sustained_jump_is_kept() {
        let mut v = vec![200.0; 10];
        v.extend([400.0; 10]);
        let out = smooth(&track(&v), &SmoothConfig::default());
        assert!(out.iter().all(Option::is_some));
        assert_eq!(out[15], Some(400.0));
    }

    #[test]
    fn short_isolated_run_is_kept() {
        // A short voiced run with silence on both sides has no jump to judge.
        let v = [0.0, 0.0, 180.0, 181.0, 182.0, 0.0, 0.0];
        let out = smooth(&track(&v), &SmoothConfig::default());
        assert_eq!(out[3], Some(181.0));
    }

    #[test]
    fn open_edge_run_is_not_dropped() {
        let mut v = vec![200.0; 10];
        v.extend([400.0; 2]);
        let closed = smooth_window(&track(&v), &SmoothConfig::default(), false, false);
        let open = smooth_window(&track(&v), &SmoothConfig::default(), false, true);
        assert_eq!(closed[11], None);
        assert!(open[11].is_some());
    }

    #[test]
    fn median_removes_single_frame_wobble_and_keeps_glides() {
        let mut v: Vec<f64> = (0..30).map(|i| 150.0 + i as f64).collect();
        v[15] = 172.0; // 7 Hz off the glide, within the jump limit
        let out = smooth(&track(&v), &SmoothConfig::default());
        assert_eq!(out[15], Some(166.0)); // median of 163, 164, 172, 166, 167
        assert_eq!(out[10], Some(160.0));
    }
}
