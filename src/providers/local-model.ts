import { ProviderError } from '../core/enhancer';
import type { EnhancementRequest } from '../core/types';
import { validateLocalRequest } from '../core/validation';
import type { ModelProvider } from './provider.interface';
import type { LocalInferenceProgress } from './local-model-config';
import type { LocalBackend } from './local-backend';
import type { LocalWorkerRequest, LocalWorkerResponse } from './local-worker-protocol';
import { withLocalModelLock } from '../services/local-model-lock';

interface WorkerPort {
  postMessage(message: LocalWorkerRequest): void;
  addEventListener(type: 'message', listener: EventListener): void;
  addEventListener(type: 'error', listener: EventListener): void;
  removeEventListener(type: 'message', listener: EventListener): void;
  removeEventListener(type: 'error', listener: EventListener): void;
  terminate(): void;
}

type WorkerFactory = () => WorkerPort;

const createWorker: WorkerFactory = () => new Worker(new URL('./local-model.worker.ts', import.meta.url), { type: 'module' });

export class LocalModelProvider implements ModelProvider {
  private worker: WorkerPort | null = null;
  private requestId = 0;
  private busy = false;

  constructor(
    private readonly onProgress: (progress: LocalInferenceProgress) => void = () => {},
    private readonly workerFactory: WorkerFactory = createWorker,
    private preferredBackend?: LocalBackend,
  ) {}

  setPreferredBackend(backend?: LocalBackend) {
    this.preferredBackend = backend;
  }

  async enhance(request: EnhancementRequest, signal?: AbortSignal): Promise<string> {
    const validated = validateLocalRequest(request);
    if (this.busy) return Promise.reject(new ProviderError('The local model is already processing a prompt.'));
    if (signal?.aborted) return Promise.reject(new DOMException('Request cancelled', 'AbortError'));
    this.busy = true;
    try {
      const locked = await withLocalModelLock('shared', () => {
        if (signal?.aborted) return Promise.reject(new DOMException('Request cancelled', 'AbortError'));
        return this.runWorker(validated, signal);
      }, false, signal);
      return locked.value!;
    } catch (error) {
      this.busy = false;
      throw error;
    }
  }

  private runWorker(request: EnhancementRequest, signal?: AbortSignal): Promise<string> {
    if (signal?.aborted) return Promise.reject(new DOMException('Request cancelled', 'AbortError'));
    const worker = this.worker ??= this.workerFactory();
    const id = ++this.requestId;

    return new Promise<string>((resolve, reject) => {
      const cleanup = () => {
        worker.removeEventListener('message', onMessage);
        worker.removeEventListener('error', onError);
        signal?.removeEventListener('abort', onAbort);
        this.busy = false;
      };
      const onMessage: EventListener = (event) => {
        const message = (event as MessageEvent<LocalWorkerResponse>).data;
        if (message.id !== id) return;
        if (message.type === 'progress') {
          this.onProgress(message.progress);
          return;
        }
        cleanup();
        if (message.type === 'result') resolve(message.result);
        else if (message.type === 'error') reject(new ProviderError(message.message));
        else reject(new ProviderError('The local model worker returned an unexpected response.'));
      };
      const onError: EventListener = () => {
        cleanup();
        worker.terminate();
        if (this.worker === worker) this.worker = null;
        reject(new ProviderError('The local model worker stopped unexpectedly. Try again.'));
      };
      const onAbort = () => {
        cleanup();
        worker.terminate();
        if (this.worker === worker) this.worker = null;
        reject(new DOMException('Request cancelled', 'AbortError'));
      };

      worker.addEventListener('message', onMessage);
      worker.addEventListener('error', onError);
      signal?.addEventListener('abort', onAbort, { once: true });
      worker.postMessage({ id, type: 'enhance', request, preferredBackend: this.preferredBackend });
    });
  }
}
