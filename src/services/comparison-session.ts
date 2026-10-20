import type { EnhancementMode } from '../core/types';

export interface ComparisonSession {
  original: string;
  enhanced: string;
  mode: EnhancementMode;
  createdAt: number;
}

export const comparisonSessionStorageKey = 'mozhi-comparison-session';

/**
 * Safely persists comparison data in chrome.storage.local.
 * Avoids putting user prompts, API keys, or text in URL parameters or browser history.
 */
export async function saveComparisonSession(data: {
  original: string;
  enhanced: string;
  mode: EnhancementMode;
}): Promise<void> {
  const session: ComparisonSession = {
    original: data.original,
    enhanced: data.enhanced,
    mode: data.mode,
    createdAt: Date.now(),
  };
  await chrome.storage.local.set({ [comparisonSessionStorageKey]: session });
}

/**
 * Loads comparison data from chrome.storage.local.
 * Handles missing or invalid comparison data gracefully.
 */
export async function loadComparisonSession(): Promise<ComparisonSession | null> {
  try {
    const stored = await chrome.storage.local.get(comparisonSessionStorageKey);
    const value = stored[comparisonSessionStorageKey] as Partial<ComparisonSession> | undefined;
    if (!value || typeof value.original !== 'string' || typeof value.enhanced !== 'string') {
      return null;
    }
    return {
      original: value.original,
      enhanced: value.enhanced,
      mode: value.mode ?? 'balanced',
      createdAt: typeof value.createdAt === 'number' ? value.createdAt : Date.now(),
    };
  } catch {
    return null;
  }
}

/**
 * Clears comparison session data after use or on reset.
 */
export async function clearComparisonSession(): Promise<void> {
  try {
    await chrome.storage.local.remove(comparisonSessionStorageKey);
  } catch {
    // Ignore storage cleanup errors
  }
}
