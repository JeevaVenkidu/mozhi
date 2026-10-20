import { afterEach, describe, expect, it, vi } from 'vitest';
import { localModelFilesLock, withLocalModelLock } from '../src/services/local-model-lock';

afterEach(() => vi.unstubAllGlobals());

describe('local model cross-context lock', () => {
  it('runs a management action only when the exclusive model lock is available', async () => {
    const operation = vi.fn(async () => 'removed');
    const request = vi.fn(async (_name: string, _options: unknown, callback: (lock: object | null) => Promise<unknown>) => callback(null));
    vi.stubGlobal('navigator', { locks: { request } });

    await expect(withLocalModelLock('exclusive', operation, true)).resolves.toEqual({ acquired: false });
    expect(request).toHaveBeenCalledWith(localModelFilesLock, { mode: 'exclusive', ifAvailable: true }, expect.any(Function));
    expect(operation).not.toHaveBeenCalled();
  });

  it('shares the same lock used by inference and returns the operation value', async () => {
    const operation = vi.fn(async () => 'enhanced');
    const request = vi.fn(async (_name: string, _options: unknown, callback: (lock: object | null) => Promise<unknown>) => callback({}));
    vi.stubGlobal('navigator', { locks: { request } });

    await expect(withLocalModelLock('shared', operation)).resolves.toEqual({ acquired: true, value: 'enhanced' });
    expect(request).toHaveBeenCalledWith(localModelFilesLock, { mode: 'shared' }, expect.any(Function));
  });

  it('aborts an inference that is waiting behind a model-management lock', async () => {
    const operation = vi.fn(async () => 'must not run');
    const request = vi.fn((_name: string, options: { signal?: AbortSignal }) => new Promise((_resolve, reject) => {
      options.signal?.addEventListener('abort', () => reject(new DOMException('Request cancelled', 'AbortError')), { once: true });
    }));
    vi.stubGlobal('navigator', { locks: { request } });
    const controller = new AbortController();
    const pending = withLocalModelLock('shared', operation, false, controller.signal);

    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(request).toHaveBeenCalledWith(localModelFilesLock, { mode: 'shared', signal: controller.signal }, expect.any(Function));
    expect(operation).not.toHaveBeenCalled();
  });
});
