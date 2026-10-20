import { localModel } from '../providers/local-model-config';

/** Removes Mozhi preferences, the separately stored credential, and its model cache. */
export async function clearAllmozhiData(): Promise<{ modelCacheCleared: boolean; cacheError: boolean }> {
  await chrome.storage.local.remove([
    'mozhi-settings',
    'mozhi-online-api-key',
    'mozhi-prompt-session',
    'mozhi-local-model-state',
    'mozhi-api-error-logs',
  ]);
  try {
    return { modelCacheCleared: await caches.delete(localModel.cacheName), cacheError: false };
  } catch {
    return { modelCacheCleared: false, cacheError: true };
  }
}

export const clearAllMozhiData = clearAllmozhiData;
