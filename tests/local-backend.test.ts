import { describe, expect, it, vi } from 'vitest';
import { LocalBackendFallbackError, createLocalGenerator, runWithLocalFallback } from '../src/providers/local-backend';

describe('local inference backend fallback', () => {
  it('uses WASM directly when WebGPU is not available', async () => {
    const create = vi.fn(async (backend: 'webgpu' | 'wasm') => backend);
    const fallback = vi.fn();

    const result = await createLocalGenerator('wasm', create, fallback);

    expect(result).toEqual({ generator: 'wasm', backend: 'wasm' });
    expect(create).toHaveBeenCalledOnce();
    expect(create).toHaveBeenCalledWith('wasm');
    expect(fallback).not.toHaveBeenCalled();
  });

  it('retries a failed WebGPU initialization with WASM', async () => {
    const create = vi.fn(async (backend: 'webgpu' | 'wasm') => {
      if (backend === 'webgpu') throw new Error('adapter could not start');
      return 'ready';
    });
    const fallback = vi.fn();

    const result = await createLocalGenerator('webgpu', create, fallback);

    expect(result).toEqual({ generator: 'ready', backend: 'wasm' });
    expect(create.mock.calls.map(([backend]) => backend)).toEqual(['webgpu', 'wasm']);
    expect(fallback).toHaveBeenCalledOnce();
  });

  it('retries an inference runtime failure with WASM and only once', async () => {
    const run = vi.fn(async (backend: 'webgpu' | 'wasm') => {
      if (backend === 'webgpu') throw new Error('GPU device lost');
      return 'refined prompt';
    });
    const fallback = vi.fn();

    const result = await runWithLocalFallback('webgpu', run, fallback);

    expect(result).toEqual({ generator: 'refined prompt', backend: 'wasm' });
    expect(run.mock.calls.map(([backend]) => backend)).toEqual(['webgpu', 'wasm']);
    expect(fallback).toHaveBeenCalledOnce();
  });

  it('does not switch providers or retry if WASM inference itself fails', async () => {
    const run = vi.fn(async () => { throw new Error('CPU allocation failed'); });
    const fallback = vi.fn();

    await expect(runWithLocalFallback('wasm', run, fallback)).rejects.toThrow('CPU allocation failed');
    expect(run).toHaveBeenCalledOnce();
    expect(fallback).not.toHaveBeenCalled();
  });

  it('does not fall back for a model artifact failure', async () => {
    const create = vi.fn(async () => { throw new Error('model file is missing'); });
    const fallback = vi.fn();

    await expect(createLocalGenerator('webgpu', create, fallback, () => false)).rejects.toThrow('model file is missing');
    expect(create).toHaveBeenCalledOnce();
    expect(fallback).not.toHaveBeenCalled();
  });

  it('keeps both backend errors when the controlled fallback also fails', async () => {
    const run = vi.fn(async (backend: 'webgpu' | 'wasm') => { throw new Error(`${backend} failed`); });

    await expect(runWithLocalFallback('webgpu', run, vi.fn())).rejects.toMatchObject({
      name: 'LocalBackendFallbackError',
      primaryError: expect.objectContaining({ message: 'webgpu failed' }),
      fallbackError: expect.objectContaining({ message: 'wasm failed' }),
    } satisfies Partial<LocalBackendFallbackError>);
  });
});
