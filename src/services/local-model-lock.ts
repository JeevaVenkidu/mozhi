export const localModelFilesLock = 'mozhi-local-model-files';

type LockMode = 'shared' | 'exclusive';

/** Shared locks protect inference; exclusive locks protect download and removal. */
export async function withLocalModelLock<T>(
  mode: LockMode,
  operation: () => Promise<T>,
  ifAvailable = false,
  signal?: AbortSignal,
): Promise<{ acquired: boolean; value?: T }> {
  if (signal?.aborted) throw signal.reason ?? new DOMException('Request cancelled', 'AbortError');
  const lockManager = globalThis.navigator?.locks;
  if (!lockManager) return { acquired: true, value: await operation() };

  return lockManager.request(localModelFilesLock, { mode, ...(ifAvailable ? { ifAvailable: true } : {}), ...(signal ? { signal } : {}) }, async (lock) => {
    if (!lock) return { acquired: false };
    return { acquired: true, value: await operation() };
  });
}
