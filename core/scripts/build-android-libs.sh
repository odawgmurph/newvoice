#!/usr/bin/env bash
# Builds newvoice-ffi for Android (arm64-v8a, armeabi-v7a, x86_64; API 24,
# the first level with the UNPROCESSED audio source) and its UniFFI Kotlin
# bindings. Needs cargo-ndk and ANDROID_NDK_HOME.
#
#   core/scripts/build-android-libs.sh <android-module-dir>
#
# <android-module-dir> (app/modules/newvoice-audio/android) receives:
#   src/main/jniLibs/<abi>/libnewvoice_ffi.so
#   src/main/java/uniffi/newvoice_ffi/newvoice_ffi.kt
set -euo pipefail

out="${1:?usage: build-android-libs.sh <android-module-dir>}"
core="$(cd "$(dirname "$0")/.." && pwd)"
mkdir -p "$out"
out="$(cd "$out" && pwd)"

cd "$core"
rm -rf "$out/src/main/jniLibs" "$out/src/main/java/uniffi"
cargo ndk -t arm64-v8a -t armeabi-v7a -t x86_64 -P 24 -o "$out/src/main/jniLibs" \
  build -p newvoice-ffi --release --locked

# Bindings come from the host build of the same crate (library mode).
cargo build -p newvoice-ffi --release --locked
host_lib="target/release/libnewvoice_ffi.so"
[ -f "$host_lib" ] || host_lib="target/release/libnewvoice_ffi.dylib"
cargo run -q -p uniffi-bindgen --release --locked -- \
  generate --library "$host_lib" --language kotlin --out-dir "$out/src/main/java"
echo "wrote $out/src/main/{jniLibs,java/uniffi}"
