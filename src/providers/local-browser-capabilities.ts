/** Compiles and executes a tiny add function to verify real WASM execution. */
export async function runMinimalWasmProbe(): Promise<void> {
  if (typeof WebAssembly === 'undefined') throw new Error('WebAssembly is not available in this execution context.');

  const moduleBytes = Uint8Array.from([
    0, 97, 115, 109, 1, 0, 0, 0,
    1, 7, 1, 96, 2, 127, 127, 1, 127,
    3, 2, 1, 0,
    7, 7, 1, 3, 97, 100, 100, 0, 0,
    10, 9, 1, 7, 0, 32, 0, 32, 1, 106, 11,
  ]);
  const { instance } = await WebAssembly.instantiate(moduleBytes);
  const add = instance.exports.add;
  if (typeof add !== 'function' || (add as (left: number, right: number) => number)(19, 23) !== 42) {
    throw new Error('The WebAssembly module did not return the expected value.');
  }
}
