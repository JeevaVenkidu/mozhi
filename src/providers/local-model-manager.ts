import type { LocalBackend } from './local-backend';
import type { LocalInferenceProgress } from './local-model-config';
import type { DiagnosticProgress, LocalDiagnosticReport, LocalModelDiagnostic } from './local-diagnostics';
import type { LocalWorkerRequest, LocalWorkerResponse } from './local-worker-protocol';

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

export interface LocalModelCheck {
  downloaded: boolean;
  backend?: LocalBackend;
  backends: LocalBackend[];
}

export class LocalModelWorkerError extends Error {
  constructor(message: string, readonly diagnostic?: LocalModelDiagnostic) {
    super(message);
    this.name = 'LocalModelWorkerError';
  }
}

export class LocalModelManager {
  private requestId = 0;

  constructor(private readonly workerFactory: WorkerFactory = createWorker) {}

  async checkStatus(): Promise<LocalModelCheck> {
    const response = await this.request('model-status', 'model-status');
    return { downloaded: response.downloaded, ...(response.backend ? { backend: response.backend } : {}), backends: response.backends };
  }

  async runDiagnostics(onProgress: (progress: DiagnosticProgress) => void = () => {}): Promise<LocalDiagnosticReport> {
    const response = await this.request('run-diagnostics', 'diagnostics-complete', undefined, undefined, undefined, onProgress);
    return response.report;
  }

  async download(onProgress: (progress: LocalInferenceProgress) => void, signal?: AbortSignal, backend?: LocalBackend): Promise<{ backend: LocalBackend }> {
    const response = await this.request('download-model', 'model-downloaded', onProgress, signal, backend);
    return { backend: response.backend };
  }

  async verify(onProgress: (progress: LocalInferenceProgress) => void, signal?: AbortSignal, backend?: LocalBackend): Promise<{ backend: LocalBackend }> {
    const response = await this.request('verify-model', 'model-verified', onProgress, signal, backend);
    return { backend: response.backend };
  }

  async delete(): Promise<{ deleted: boolean }> {
    const response = await this.request('delete-model', 'model-deleted');
    return { deleted: response.deleted };
  }

  private request<T extends LocalWorkerResponse['type']>(
    command: Extract<LocalWorkerRequest, { type: 'model-status' | 'run-diagnostics' | 'verify-model' | 'download-model' | 'delete-model' }>['type'],
    responseType: T,
    onProgress?: (progress: LocalInferenceProgress) => void,
    signal?: AbortSignal,
    backend?: LocalBackend,
    onDiagnosticProgress?: (progress: DiagnosticProgress) => void,
  ): Promise<Extract<LocalWorkerResponse, { type: T }>> {
    if (signal?.aborted) return Promise.reject(new DOMException('Request cancelled', 'AbortError'));
    const worker = this.workerFactory();
    const id = ++this.requestId;

    return new Promise((resolve, reject) => {
      const cleanup = () => {
        worker.removeEventListener('message', onMessage);
        worker.removeEventListener('error', onError);
        signal?.removeEventListener('abort', onAbort);
        worker.terminate();
      };
      const onMessage: EventListener = (event) => {
        const message = (event as MessageEvent<LocalWorkerResponse>).data;
        if (message.id !== id) return;
        if (message.type === 'progress') {
          onProgress?.(message.progress);
          return;
        }
        if (message.type === 'diagnostic-progress') {
          onDiagnosticProgress?.(message.progress);
          return;
        }
        cleanup();
        if (message.type === 'error') reject(new LocalModelWorkerError(message.message, message.diagnostic));
        else if (message.type === responseType) resolve(message as Extract<LocalWorkerResponse, { type: T }>);
        else reject(new Error('The local model returned an unexpected response.'));
      };
      const onError: EventListener = () => {
        cleanup();
        reject(new LocalModelWorkerError('The local model manager worker stopped unexpectedly.', { category: 'worker-initialization-failed' }));
      };
      const onAbort = () => {
        cleanup();
        reject(new DOMException('Request cancelled', 'AbortError'));
      };

      worker.addEventListener('message', onMessage);
      worker.addEventListener('error', onError);
      signal?.addEventListener('abort', onAbort, { once: true });
      worker.postMessage({ id, type: command, ...((command === 'download-model' || command === 'verify-model') && backend ? { backend } : {}) } as LocalWorkerRequest);
    });
  }
}
