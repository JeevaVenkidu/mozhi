import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultSettings } from '../src/core/types';
import { hasOnlineApiKey, readOnlineApiKey, removeOnlineApiKey, saveOnlineApiKey } from '../src/services/credentials';
import { loadSettings, saveSettings } from '../src/services/settings';
import { clearAllMozhiData } from '../src/services/user-data';

function stubStorage() {
  const values: Record<string, unknown> = {};
  const local = {
    get: vi.fn(async (key: string) => ({ [key]: values[key] })),
    set: vi.fn(async (items: Record<string, unknown>) => { Object.assign(values, items); }),
    remove: vi.fn(async (keys: string | string[]) => {
      for (const key of Array.isArray(keys) ? keys : [keys]) delete values[key];
    }),
  };
  vi.stubGlobal('chrome', { storage: { local } });
  return { values, local };
}

afterEach(() => vi.unstubAllGlobals());

describe('settings and credential storage', () => {
  it('migrates older settings with defaults and persists user preferences', async () => {
    const { values } = stubStorage();
    values['mozhi-settings'] = { provider: 'openai-compatible', onlineModel: 'my-model' };

    await expect(loadSettings()).resolves.toEqual({
      ...defaultSettings,
      provider: 'openai-compatible',
      onlineModel: 'my-model',
    });
    await saveSettings({ ...defaultSettings, enhancementMode: 'advanced' });
    await expect(loadSettings()).resolves.toMatchObject({ enhancementMode: 'advanced' });
  });

  it('migrates a saved local model id to the configured instruct model', async () => {
    const { values } = stubStorage();
    values['mozhi-settings'] = { ...defaultSettings, localModelId: 'onnx-community/SmolLM2-360M-ONNX' };

    await expect(loadSettings()).resolves.toMatchObject({ localModelId: 'onnx-community/SmolLM2-360M-Instruct-ONNX' });
  });

  it('restores the selected provider and enhancement mode when the popup reopens', async () => {
    stubStorage();
    const selected = { ...defaultSettings, provider: 'openai-compatible' as const, enhancementMode: 'advanced' as const };
    await saveSettings(selected);

    await expect(loadSettings()).resolves.toEqual(selected);
  });

  it('stores credentials separately, supports removal, and never includes a key in settings', async () => {
    const { values } = stubStorage();
    await saveSettings(defaultSettings);
    await saveOnlineApiKey('  secret-token  ');

    expect(await hasOnlineApiKey()).toBe(true);
    expect(await readOnlineApiKey()).toBe('secret-token');
    expect(values['mozhi-settings']).toEqual(defaultSettings);
    expect(JSON.stringify(values['mozhi-settings'])).not.toContain('secret-token');

    await removeOnlineApiKey();
    expect(await hasOnlineApiKey()).toBe(false);
    expect(await readOnlineApiKey()).toBeUndefined();
  });

  it('clears both saved credentials and the namespaced model cache', async () => {
    const { local } = stubStorage();
    const cacheApi = { delete: vi.fn(async () => true) };
    vi.stubGlobal('caches', cacheApi);

    await expect(clearAllMozhiData()).resolves.toEqual({ modelCacheCleared: true, cacheError: false });
    expect(local.remove).toHaveBeenCalledWith(['mozhi-settings', 'mozhi-online-api-key', 'mozhi-prompt-session', 'mozhi-local-model-state', 'mozhi-api-error-logs']);
    expect(cacheApi.delete).toHaveBeenCalledWith('mozhi-local-model-cache');
  });
});
