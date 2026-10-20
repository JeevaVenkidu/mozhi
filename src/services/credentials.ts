const apiKeyKey = 'mozhi-online-api-key';

/** Secrets are intentionally kept outside the non-secret settings object. */
export async function hasOnlineApiKey(): Promise<boolean> {
  const stored = await chrome.storage.local.get(apiKeyKey);
  return typeof stored[apiKeyKey] === 'string' && stored[apiKeyKey].length > 0;
}

export async function readOnlineApiKey(): Promise<string | undefined> {
  const stored = await chrome.storage.local.get(apiKeyKey);
  const key = stored[apiKeyKey];
  return typeof key === 'string' && key.length > 0 ? key : undefined;
}

export async function saveOnlineApiKey(apiKey: string): Promise<void> {
  const normalized = apiKey.trim();
  if (!normalized) throw new Error('Enter an API key before saving.');
  if (normalized.length > 4096) throw new Error('The API key is too long.');
  await chrome.storage.local.set({ [apiKeyKey]: normalized });
}

export async function removeOnlineApiKey(): Promise<void> {
  await chrome.storage.local.remove(apiKeyKey);
}
