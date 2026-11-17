//! NewVoice analysis core.
//!
//! Platform-independent DSP shared by the iOS, Android and WebAssembly builds.
//! Keep it free of platform and FFI code: bindings live in `newvoice-ffi`.

pub mod formant;
pub mod lpc;
pub mod pitch;
pub mod resample;
pub mod roots;
pub mod units;
pub mod vtl;

#[cfg(test)]
pub(crate) mod testsig;

/// Version of the analysis core. Scores are only comparable across equal versions.
pub const VERSION: &str = env!("CARGO_PKG_VERSION");

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn version_is_set() {
        assert!(!VERSION.is_empty());
    }
}
