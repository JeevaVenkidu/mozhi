import { afterEach, describe, expect, it, vi } from 'vitest';
import { LocalModelManager, LocalModelWorkerError } from '../src/providers/local-model-manager';
import type { LocalWorkerRequest, LocalWorkerResponse } from '../src/providers/local-worker-protocol';

function createWorker(respond: (request: LocalWorkerRequest, emit: (response: LocalWorkerResponse) => void) => void) {
  const listeners = new Map<string, EventListener[]>();
  const worker = {
    postMessage: vi.fn((request: LocalWorkerRequest) => {
      respond(request, (response) => queueMicrotask(() => {
        for (const listener of listeners.get('message') ?? []) listener({ data: response } as MessageEvent);
      }));
    }),
    addEventListener: vi.fn((type: string, listener: EventListener) => listeners.set(type, [...(listeners.get(type) ?? []), listener])),
    removeEventListener: vi.fn((type: string, listener: EventListener) => listeners.set(type, (listeners.get(type) ?? []).filter((item) => item !== listener))),
    terminate: vi.fn(),
  };
  return worker;
}

afterEach(() => vi.unstubAllGlobals());

describe('local model manager bridge', () => {
  it('checks readiness without starting a download', async () => {
    const worker = createWorker((request, emit) => emit({ id: request.id, type: 'model-status', downloaded: true, backend: 'wasm', backends: ['wasm'] }));
    const manager = new LocalModelManager(() => worker);

    await expect(manager.checkStatus()).resolves.toEqual({ downloaded: true, backend: 'wasm', backends: ['wasm'] });
    expect(worker.postMessage).toHaveBeenCalledWith({ id: 1, type: 'model-status' });
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it('reports explicit download progress and final ready backend', async () => {
    const worker = createWorker((request, emit) => {
      emit({ id: request.id, type: 'progress', progress: { stage: 'downloading', progress: 48, file: 'model.onnx' } });
      emit({ id: request.id, type: 'model-downloaded', backend: 'webgpu' });
    });
    const manager = new LocalModelManager(() => worker);
    const onProgress = vi.fn();

    await expect(manager.download(onProgress)).resolves.toEqual({ backend: 'webgpu' });
    expect(worker.postMessage).toHaveBeenCalledWith({ id: 1, type: 'download-model' });
    expect(onProgress).toHaveBeenCalledWith({ stage: 'downloading', progress: 48, file: 'model.onnx' });
  });

  it('keeps an explicitly requested WASM fallback separate from normal ready checks', async () => {
    const worker = createWorker((request, emit) => emit({ id: request.id, type: 'model-downloaded', backend: 'wasm' }));
    const manager = new LocalModelManager(() => worker);

    await expect(manager.download(() => {}, undefined, 'wasm')).resolves.toEqual({ backend: 'wasm' });
    expect(worker.postMessage).toHaveBeenCalledWith({ id: 1, type: 'download-model', backend: 'wasm' });
  });

  it('runs an explicit local smoke-test verification without a download command', async () => {
    const worker = createWorker((request, emit) => emit({ id: request.id, type: 'model-verified', backend: 'wasm' }));
    const manager = new LocalModelManager(() => worker);

    await expect(manager.verify(() => {}, undefined, 'wasm')).resolves.toEqual({ backend: 'wasm' });
    expect(worker.postMessage).toHaveBeenCalledWith({ id: 1, type: 'verify-model', backend: 'wasm' });
  });

  it('forwards sequential diagnostic checks and returns the full report', async () => {
    const check = { id: 'wasm-execute', label: 'WASM compile and execute', status: 'PASS' as const, detail: 'WASM returned 42.' };
    const report = { generatedAt: '2026-10-15T00:00:00Z', browser: 'Chrome', modelId: 'model', modelRevision: 'rev', checks: [check] };
    const worker = createWorker((request, emit) => {
      emit({ id: request.id, type: 'diagnostic-progress', progress: { completed: 7, total: 16, check } });
      emit({ id: request.id, type: 'diagnostics-complete', report });
    });
    const manager = new LocalModelManager(() => worker);
    const onProgress = vi.fn();

    await expect(manager.runDiagnostics(onProgress)).resolves.toEqual(report);
    expect(onProgress).toHaveBeenCalledWith({ completed: 7, total: 16, check });
    expect(worker.postMessage).toHaveBeenCalledWith({ id: 1, type: 'run-diagnostics' });
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it('cancels an active download and terminates its worker', async () => {
    const worker = createWorker(() => {});
    const manager = new LocalModelManager(() => worker);
    const controller = new AbortController();
    const pending = manager.download(() => {}, controller.signal);
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it('surfaces worker failures instead of marking the model ready', async () => {
    const worker = createWorker((request, emit) => emit({ id: request.id, type: 'error', message: 'Model host unavailable', diagnostic: { category: 'model-download-failed' } }));
    const manager = new LocalModelManager(() => worker);

    await expect(manager.download(() => {})).rejects.toMatchObject({
      name: 'LocalModelWorkerError',
      message: 'Model host unavailable',
      diagnostic: { category: 'model-download-failed' },
    } satisfies Partial<LocalModelWorkerError>);
  });

  it('deletes the model cache through the explicit management command', async () => {
    const worker = createWorker((request, emit) => emit({ id: request.id, type: 'model-deleted', deleted: true }));
    const manager = new LocalModelManager(() => worker);

    await expect(manager.delete()).resolves.toEqual({ deleted: true });
    expect(worker.postMessage).toHaveBeenCalledWith({ id: 1, type: 'delete-model' });
  });
});
