import { afterEach, describe, expect, it, vi } from 'vitest';
import { LocalModelProvider } from '../src/providers/local-model';

afterEach(() => vi.unstubAllGlobals());

function createWorker() {
  const listeners = new Map<string, EventListener[]>();
  const worker = {
    postMessage: vi.fn((message: { id: number }) => {
      queueMicrotask(() => {
        for (const listener of listeners.get('message') ?? []) {
          listener({ data: { id: message.id, type: 'progress', progress: { stage: 'generating' } } } as MessageEvent);
          listener({ data: { id: message.id, type: 'result', result: 'A refined prompt.' } } as MessageEvent);
        }
      });
    }),
    addEventListener: vi.fn((type: string, listener: EventListener) => {
      listeners.set(type, [...(listeners.get(type) ?? []), listener]);
    }),
    removeEventListener: vi.fn((type: string, listener: EventListener) => {
      listeners.set(type, (listeners.get(type) ?? []).filter((item) => item !== listener));
    }),
    terminate: vi.fn(),
  };
  return worker;
}

describe('local model provider bridge', () => {
  it('forwards progress and returns the worker result', async () => {
    const worker = createWorker();
    const onProgress = vi.fn();
    const provider = new LocalModelProvider(onProgress, () => worker);

    await expect(provider.enhance({ prompt: 'Write a note', mode: 'typo' })).resolves.toBe('A refined prompt.');
    expect(worker.postMessage).toHaveBeenCalledWith({
      id: 1,
      type: 'enhance',
      request: { prompt: 'Write a note', mode: 'typo' },
      preferredBackend: undefined,
    });
    expect(onProgress).toHaveBeenCalledWith({ stage: 'generating' });
    expect(worker.removeEventListener).toHaveBeenCalledTimes(2);
  });

  it('terminates the worker and preserves AbortError on cancellation', async () => {
    const worker = createWorker();
    worker.postMessage.mockImplementation(() => {});
    vi.stubGlobal('navigator', { locks: { request: async (_name: string, _options: unknown, callback: (lock: object) => Promise<unknown>) => callback({}) } });
    const provider = new LocalModelProvider(() => {}, () => worker);
    const controller = new AbortController();
    const pending = provider.enhance({ prompt: 'Cancel me', mode: 'typo' }, controller.signal);

    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(worker.terminate).toHaveBeenCalledOnce();
  });
});
