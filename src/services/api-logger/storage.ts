import type { ApiErrorLogEntry } from './types';

export const API_ERROR_LOGS_STORAGE_KEY = 'mozhi-api-error-logs';
export const MAX_LOG_ENTRIES = 50;

/**
 * Loads stored API error log entries from extension storage.
 */
export async function loadApiErrorLogs(): Promise<ApiErrorLogEntry[]> {
  if (typeof chrome === 'undefined' || !chrome?.storage?.local) {
    return [];
  }
  try {
    const data = await chrome.storage.local.get(API_ERROR_LOGS_STORAGE_KEY);
    const raw = data[API_ERROR_LOGS_STORAGE_KEY];
    if (Array.isArray(raw)) {
      return raw.filter((item): item is ApiErrorLogEntry => (
        typeof item === 'object' && item !== null && typeof item.id === 'string' && typeof item.timestamp === 'number'
      ));
    }
    return [];
  } catch {
    return [];
  }
}

/**
 * Persists log entries with a hard retention limit (FIFO).
 */
export async function saveApiErrorLogs(logs: ApiErrorLogEntry[]): Promise<void> {
  if (typeof chrome === 'undefined' || !chrome?.storage?.local) {
    return;
  }
  const bounded = logs.slice(0, MAX_LOG_ENTRIES);
  await chrome.storage.local.set({ [API_ERROR_LOGS_STORAGE_KEY]: bounded });
}

/**
 * Appends a new log entry, ensuring deduplication by correlationId and enforcing retention limit.
 */
export async function appendApiErrorLog(entry: ApiErrorLogEntry): Promise<void> {
  if (typeof chrome === 'undefined' || !chrome?.storage?.local) {
    return;
  }
  try {
    const current = await loadApiErrorLogs();
    // Prevent duplicate entries for the same failure in an operation
    const duplicate = current.some((e) => e.correlationId === entry.correlationId && e.operation === entry.operation && e.stage === entry.stage);
    if (duplicate) return;

    const next = [entry, ...current].slice(0, MAX_LOG_ENTRIES);
    await chrome.storage.local.set({ [API_ERROR_LOGS_STORAGE_KEY]: next });
  } catch {
    // Isolated failure - never propagate storage error to API caller
  }
}

/**
 * Deletes ONLY the stored diagnostic log entries from extension storage.
 * Does not touch provider settings, API keys, model files, prompt history, or other data.
 */
export async function clearApiErrorLogs(): Promise<void> {
  if (typeof chrome === 'undefined' || !chrome?.storage?.local) {
    return;
  }
  await chrome.storage.local.remove([API_ERROR_LOGS_STORAGE_KEY]);
}
