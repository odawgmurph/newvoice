#!/usr/bin/env bash
# Builds newvoice-ffi for iOS (device + Apple-silicon simulator) as an
# XCFramework, plus its UniFFI Swift bindings. Runs on macOS (Xcode).
#
#   core/scripts/build-ios-xcframework.sh <out-dir>
#
# <out-dir> receives:
#   NewVoiceFFI.xcframework        the static library (device + simulator)
#   newvoice_ffi.swift             the generated Swift API (LiveAnalyser, ...)
#   include/newvoice_ffiFFI.h      the C interface the Swift file calls
#
# The header goes into the consuming pod's own sources rather than into the
# XCFramework: the generated Swift only imports `newvoice_ffiFFI` when such
# a module exists, and otherwise sees the C functions through the pod's own
# module, so the declarations exist exactly once.
set -euo pipefail

out="${1:?usage: build-ios-xcframework.sh <out-dir>}"
core="$(cd "$(dirname "$0")/.." && pwd)"
mkdir -p "$out"
out="$(cd "$out" && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

cd "$core"
for target in aarch64-apple-ios aarch64-apple-ios-sim; do
  cargo build -p newvoice-ffi --release --locked --target "$target"
done

# Bindings come from the host build of the same crate (library mode reads
# the interface from the compiled library's metadata).
cargo build -p newvoice-ffi --release --locked
host_lib="target/release/libnewvoice_ffi.dylib"
cargo run -q -p uniffi-bindgen --release --locked -- \
  generate --library "$host_lib" --language swift --out-dir "$work/bindings"

rm -rf "$out/NewVoiceFFI.xcframework" "$out/include"
xcodebuild -create-xcframework \
  -library target/aarch64-apple-ios/release/libnewvoice_ffi.a \
  -library target/aarch64-apple-ios-sim/release/libnewvoice_ffi.a \
  -output "$out/NewVoiceFFI.xcframework"
mkdir -p "$out/include"
cp "$work/bindings/newvoice_ffiFFI.h" "$out/include/"
cp "$work/bindings/newvoice_ffi.swift" "$out/"
echo "wrote $out/{NewVoiceFFI.xcframework,newvoice_ffi.swift,include/newvoice_ffiFFI.h}"
