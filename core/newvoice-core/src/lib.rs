//! NewVoice analysis core.
//!
//! Platform-independent DSP shared by the iOS, Android and WebAssembly builds.
//! Stage 1 of `docs/build-plan.md` fills this in (framing, VAD, pitch, formants,
//! vocal tract length, voice quality). Keep it free of platform and FFI code:
//! bindings live in `newvoice-ffi`.

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
