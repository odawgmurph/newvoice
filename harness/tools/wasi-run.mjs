// Runs a WASI (preview 1) program under Node's built-in WASI, with the
// working directory's root preopened. Used by the harness to check that the
// WebAssembly build of newvoice-cli prints the same numbers as the native one.
//
//   node tools/wasi-run.mjs <program.wasm> [args...]
import { readFile } from "node:fs/promises";
import { WASI } from "node:wasi";

const [program, ...args] = process.argv.slice(2);
const wasi = new WASI({
  version: "preview1",
  args: [program, ...args],
  env: {},
  preopens: { "/": "/" },
  returnOnExit: true,
});
const module = await WebAssembly.compile(await readFile(program));
const instance = await WebAssembly.instantiate(module, wasi.getImportObject());
process.exitCode = wasi.start(instance);
