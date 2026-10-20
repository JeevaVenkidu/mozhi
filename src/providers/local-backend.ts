export type LocalBackend = 'webgpu' | 'wasm';

export interface LocalGeneratorResult<T> {
  generator: T;
  backend: LocalBackend;
}

/** Preserves both backend failures when a controlled fallback also fails. */
export class LocalBackendFallbackError extends Error {
  constructor(
    readonly primaryError: unknown,
    readonly fallbackError: unknown,
  ) {
    super('WebGPU and the WASM fallback both failed.');
    this.name = 'LocalBackendFallbackError';
  }
}

/** Try the requested local backend, then retry once with WASM if WebGPU cannot initialize. */
export async function createLocalGenerator<T>(
  preferredBackend: LocalBackend,
  create: (backend: LocalBackend) => Promise<T>,
  onWasmFallback: () => void,
  shouldFallback: (error: unknown) => boolean = () => true,
): Promise<LocalGeneratorResult<T>> {
  if (preferredBackend === 'wasm') {
    return { generator: await create('wasm'), backend: 'wasm' };
  }

  try {
    return { generator: await create('webgpu'), backend: 'webgpu' };
  } catch (primaryError) {
    if (!shouldFallback(primaryError)) throw primaryError;
    onWasmFallback();
    try {
      return { generator: await create('wasm'), backend: 'wasm' };
    } catch (fallbackError) {
      throw new LocalBackendFallbackError(primaryError, fallbackError);
    }
  }
}

/** Retry an inference once with WASM after a WebGPU runtime failure. */
export async function runWithLocalFallback<T>(
  backend: LocalBackend,
  run: (backend: LocalBackend) => Promise<T>,
  onWasmFallback: () => void | Promise<void>,
  shouldFallback: (error: unknown) => boolean = () => true,
): Promise<LocalGeneratorResult<T>> {
  if (backend === 'wasm') {
    return { generator: await run('wasm'), backend: 'wasm' };
  }

  try {
    return { generator: await run('webgpu'), backend: 'webgpu' };
  } catch (primaryError) {
    if (!shouldFallback(primaryError)) throw primaryError;
    await onWasmFallback();
    try {
      return { generator: await run('wasm'), backend: 'wasm' };
    } catch (fallbackError) {
      throw new LocalBackendFallbackError(primaryError, fallbackError);
    }
  }
}
