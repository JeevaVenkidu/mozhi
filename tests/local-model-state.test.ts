import { afterEach, describe, expect, it, vi } from 'vitest';
import { localModel } from '../src/providers/local-model-config';
import { initialLocalModelState, loadLocalModelState, localModelStateStorageKey, recoverLocalModelState, saveLocalModelState } from '../src/services/local-model-state';

function stubStorage() {
  const values: Record<string, unknown> = {};
  const local = {
    get: vi.fn(async (key: string) => ({ [key]: values[key] })),
    set: vi.fn(async (items: Record<string, unknown>) => { Object.assign(values, items); }),
  };
  vi.stubGlobal('chrome', { storage: { local } });
  return { values, local };
}

afterEach(() => vi.unstubAllGlobals());

describe('local model status', () => {
  it('persists progress and restores a ready backend selection', async () => {
    const { values } = stubStorage();
    await saveLocalModelState({ status: 'ready', progress: 100, backend: 'wasm', updatedAt: 1 });

    await expect(loadLocalModelState()).resolves.toMatchObject({ status: 'ready', progress: 100, backend: 'wasm' });
    expect(values[localModelStateStorageKey]).toMatchObject({
      status: 'ready',
      backend: 'wasm',
      modelId: localModel.id,
      modelRevision: localModel.revision,
      verificationVersion: 3,
    });
  });

  it('downgrades old non-empty-only readiness and requires a quality retest without deleting files', async () => {
    const { values } = stubStorage();
    values[localModelStateStorageKey] = {
      status: 'ready',
      progress: 100,
      backend: 'webgpu',
      backends: ['webgpu'],
      verifiedBackends: ['webgpu'],
      modelId: localModel.id,
      modelRevision: localModel.revision,
      updatedAt: 1,
    };

    await expect(loadLocalModelState()).resolves.toMatchObject({
      status: 'downloaded',
      progress: 100,
      backend: 'webgpu',
      backends: ['webgpu'],
      message: expect.stringContaining('did not verify its quality'),
    });
    expect(await loadLocalModelState()).not.toHaveProperty('verifiedBackends');
  });

  it('discards persisted readiness from a different model revision', async () => {
    const { values } = stubStorage();
    values[localModelStateStorageKey] = {
      status: 'ready',
      progress: 100,
      backend: 'webgpu',
      modelId: 'onnx-community/SmolLM2-360M-ONNX',
      modelRevision: '539c1088be2dcd673c39059d25a6bc4aec625504',
      updatedAt: 1,
    };

    await expect(loadLocalModelState()).resolves.toMatchObject({ status: 'not-downloaded', progress: null });
  });

  it('recovers a closed download as interrupted and keeps the saved progress', () => {
    const previous = { status: 'downloading' as const, progress: 62, updatedAt: 1 };
    expect(recoverLocalModelState(previous, false)).toMatchObject({ status: 'interrupted', progress: 62 });
  });

  it('requires a smoke-test verification before cached files are marked ready', () => {
    expect(recoverLocalModelState(initialLocalModelState(), true, 'webgpu', ['webgpu']))
      .toMatchObject({ status: 'downloaded', progress: 100, backend: 'webgpu' });
  });

  it('restores ready only when a cached backend has passed the smoke test', () => {
    expect(recoverLocalModelState({ status: 'ready', progress: 100, backend: 'webgpu', verifiedBackends: ['webgpu'], updatedAt: 1 }, true, 'webgpu', ['webgpu']))
      .toMatchObject({ status: 'ready', progress: 100, backend: 'webgpu', verifiedBackends: ['webgpu'] });
  });

  it('clears a stale ready state when browser cache files are missing', () => {
    expect(recoverLocalModelState({ status: 'ready', progress: 100, backend: 'wasm', updatedAt: 1 }, false))
      .toMatchObject({ status: 'not-downloaded', message: expect.stringContaining('no longer') });
  });
});
