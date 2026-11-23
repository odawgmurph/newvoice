//! Pitch units: semitones, note names and cents.
//!
//! Semitone values use the MIDI scale (A4 = 440 Hz = 69 ST), so a semitone
//! reading is also a note number. Differences in semitones are what the
//! feedback uses; the absolute reference only matters for note names.

/// Frequency of MIDI note 69 (A4).
pub const A4_HZ: f64 = 440.0;
/// MIDI note number of A4.
pub const A4_MIDI: f64 = 69.0;

/// Hertz to semitones on the MIDI scale.
pub fn hz_to_st(hz: f64) -> f64 {
    A4_MIDI + 12.0 * (hz / A4_HZ).log2()
}

/// Semitones on the MIDI scale to hertz.
pub fn st_to_hz(st: f64) -> f64 {
    A4_HZ * 2f64.powf((st - A4_MIDI) / 12.0)
}

/// Interval from `from_hz` to `to_hz` in cents.
pub fn cents(from_hz: f64, to_hz: f64) -> f64 {
    1200.0 * (to_hz / from_hz).log2()
}

const NOTE_NAMES: [&str; 12] = [
    "C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B",
];

/// The nearest equal-tempered note to a frequency.
#[derive(Debug, Clone, PartialEq)]
pub struct Note {
    /// MIDI note number of the nearest note.
    pub midi: i32,
    /// Name without octave, for example `"F♯"`.
    pub name: &'static str,
    /// Scientific pitch octave (C4 is middle C).
    pub octave: i32,
    /// Offset from the nearest note, in cents (−50 to +50).
    pub cents: f64,
}

impl Note {
    pub fn from_hz(hz: f64) -> Self {
        let st = hz_to_st(hz);
        let midi = st.round() as i32;
        Self {
            midi,
            name: NOTE_NAMES[midi.rem_euclid(12) as usize],
            octave: midi.div_euclid(12) - 1,
            cents: (st - f64::from(midi)) * 100.0,
        }
    }
}

/// Percentile with linear interpolation between order statistics
/// (Hyndman–Fan type 7, the default in NumPy and R). `sorted` must be sorted.
pub fn percentile_sorted(sorted: &[f64], p: f64) -> f64 {
    assert!(!sorted.is_empty(), "percentile of an empty set");
    let h = (sorted.len() - 1) as f64 * p.clamp(0.0, 100.0) / 100.0;
    let lo = h.floor() as usize;
    let hi = h.ceil() as usize;
    sorted[lo] + (h - lo as f64) * (sorted[hi] - sorted[lo])
}

/// Median of an unsorted set. Returns `None` when empty.
pub fn median(values: &[f64]) -> Option<f64> {
    if values.is_empty() {
        return None;
    }
    let mut v = values.to_vec();
    v.sort_by(f64::total_cmp);
    Some(percentile_sorted(&v, 50.0))
}

/// Utterance-level pitch statistics, computed on voiced frames only.
///
/// These follow handbook §3.2: the median and percentiles rather than the
/// mean in hertz, which octave errors and skew bias.
#[derive(Debug, Clone, PartialEq)]
pub struct PitchStats {
    /// Number of voiced frames used.
    pub voiced_frames: usize,
    /// Voiced duration in seconds (frames × hop).
    pub voiced_s: f64,
    pub median_hz: f64,
    pub median_st: f64,
    /// 5th percentile: the bottom of the comfortable range on a glide (handbook E2).
    pub p5_st: f64,
    pub p10_st: f64,
    pub p90_st: f64,
    /// 95th percentile: the top of the comfortable range on a glide.
    pub p95_st: f64,
    /// Standard deviation in semitones (population SD).
    pub sd_st: f64,
    /// 5th to 95th percentile range in semitones.
    pub range_5_95_st: f64,
}

impl PitchStats {
    /// Statistics over voiced F0 values in hertz. `hop_s` converts the frame
    /// count to a duration. Returns `None` when there are no voiced frames.
    pub fn from_hz(f0_hz: &[f64], hop_s: f64) -> Option<Self> {
        if f0_hz.is_empty() {
            return None;
        }
        let mut st: Vec<f64> = f0_hz.iter().map(|&f| hz_to_st(f)).collect();
        st.sort_by(f64::total_cmp);
        let n = st.len() as f64;
        let mean = st.iter().sum::<f64>() / n;
        let var = st.iter().map(|v| (v - mean).powi(2)).sum::<f64>() / n;
        let median_st = percentile_sorted(&st, 50.0);
        let p5_st = percentile_sorted(&st, 5.0);
        let p95_st = percentile_sorted(&st, 95.0);
        Some(Self {
            voiced_frames: st.len(),
            voiced_s: n * hop_s,
            median_hz: st_to_hz(median_st),
            median_st,
            p5_st,
            p10_st: percentile_sorted(&st, 10.0),
            p90_st: percentile_sorted(&st, 90.0),
            p95_st,
            sd_st: var.sqrt(),
            range_5_95_st: p95_st - p5_st,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn semitone_round_trip_and_reference() {
        assert!((hz_to_st(440.0) - 69.0).abs() < 1e-12);
        assert!((hz_to_st(220.0) - 57.0).abs() < 1e-12);
        assert!((st_to_hz(hz_to_st(187.3)) - 187.3).abs() < 1e-9);
        assert!((cents(100.0, 200.0) - 1200.0).abs() < 1e-9);
    }

    #[test]
    fn note_names() {
        let a = Note::from_hz(440.0);
        assert_eq!((a.name, a.octave, a.midi), ("A", 4, 69));
        let c = Note::from_hz(261.63);
        assert_eq!((c.name, c.octave), ("C", 4));
        assert!(c.cents.abs() < 1.0);
        // 25 cents above F#3 (MIDI 54).
        let f = Note::from_hz(st_to_hz(54.25));
        assert_eq!((f.name, f.octave), ("F♯", 3));
        assert!((f.cents - 25.0).abs() < 1e-9);
    }

    #[test]
    fn percentiles_match_numpy_linear() {
        let v = [1.0, 2.0, 3.0, 4.0, 10.0];
        assert_eq!(percentile_sorted(&v, 50.0), 3.0);
        assert!((percentile_sorted(&v, 90.0) - 7.6).abs() < 1e-12);
        assert!((percentile_sorted(&v, 10.0) - 1.4).abs() < 1e-12);
        assert_eq!(median(&[3.0, 1.0, 2.0, 4.0]), Some(2.5));
        assert_eq!(median(&[]), None);
    }

    #[test]
    fn pitch_stats_of_a_one_octave_glide() {
        // Uniform in semitones from 48 to 60 ST.
        let hz: Vec<f64> = (0..=120)
            .map(|i| st_to_hz(48.0 + i as f64 / 10.0))
            .collect();
        let s = PitchStats::from_hz(&hz, 0.01).unwrap();
        assert_eq!(s.voiced_frames, 121);
        assert!((s.median_st - 54.0).abs() < 1e-9);
        assert!((s.range_5_95_st - 10.8).abs() < 1e-9);
        assert!((s.p95_st - s.p5_st - s.range_5_95_st).abs() < 1e-12);
        assert!(s.p5_st <= s.p10_st && s.p90_st <= s.p95_st);
        assert!((s.p90_st - s.p10_st - 9.6).abs() < 1e-9);
        assert!((s.sd_st - 12.0 / 12f64.sqrt()).abs() < 0.05);
        assert!(PitchStats::from_hz(&[], 0.01).is_none());
    }
}
