import { describe, expect, it } from 'vitest';
import { runMinimalWasmProbe } from '../src/providers/local-browser-capabilities';

describe('browser capability probes', () => {
  it('compiles and executes the minimal WASM module', async () => {
    await expect(runMinimalWasmProbe()).resolves.toBeUndefined();
  });
});
