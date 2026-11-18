#!/usr/bin/env bash
# Builds newvoice-ffi for iOS (device + Apple-silicon simulator) as an
# XCFramework, plus its UniFFI Swift bindings. Runs on macOS (Xcode).
#
#   core/scripts/build-ios-xcframework.sh <out-dir>
#
# <out-dir> receives:
#   NewVoiceFFI.xcframework   static library + C header + module map
#                             (Swift imports it as `newvoice_ffiFFI`)
#   newvoice_ffi.swift        the generated Swift API (LiveAnalyser, ...)
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

# Each XCFramework slice gets the header plus the module map, renamed to
# module.modulemap so clang finds it.
mkdir -p "$work/include"
cp "$work/bindings/newvoice_ffiFFI.h" "$work/include/"
cp "$work/bindings/newvoice_ffiFFI.modulemap" "$work/include/module.modulemap"

rm -rf "$out/NewVoiceFFI.xcframework"
xcodebuild -create-xcframework \
  -library target/aarch64-apple-ios/release/libnewvoice_ffi.a -headers "$work/include" \
  -library target/aarch64-apple-ios-sim/release/libnewvoice_ffi.a -headers "$work/include" \
  -output "$out/NewVoiceFFI.xcframework"
cp "$work/bindings/newvoice_ffi.swift" "$out/"
echo "wrote $out/NewVoiceFFI.xcframework and $out/newvoice_ffi.swift"
