//! `cargo run -p uniffi-bindgen -- generate --library <lib> --language swift --out-dir <dir>`
//!
//! The UniFFI bindings generator, pinned to the same uniffi version as
//! `newvoice-ffi` (generator and scaffolding must match).

fn main() {
    uniffi::uniffi_bindgen_main()
}
