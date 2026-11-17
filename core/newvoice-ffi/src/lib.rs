//! Native bindings for the NewVoice analysis core.
//!
//! The Swift/Kotlin audio module (Stage 2) calls into this crate on its audio
//! thread. Only computed results cross back to JavaScript, never raw audio.

uniffi::setup_scaffolding!();

/// Version of the analysis core linked into this build.
#[uniffi::export]
pub fn core_version() -> String {
    newvoice_core::VERSION.to_owned()
}

#[cfg(test)]
mod tests {
    #[test]
    fn reports_core_version() {
        assert_eq!(super::core_version(), newvoice_core::VERSION);
    }
}
