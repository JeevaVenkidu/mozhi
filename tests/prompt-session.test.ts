import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearPromptSession, loadPromptSession, promptSessionStorageKey, savePromptSession } from '../src/services/prompt-session';

function stubStorage() {
  const values: Record<string, unknown> = {};
  const local = {
    get: vi.fn(async (key: string) => ({ [key]: values[key] })),
    set: vi.fn(async (items: Record<string, unknown>) => { Object.assign(values, items); }),
    remove: vi.fn(async (key: string) => { delete values[key]; }),
  };
  vi.stubGlobal('chrome', { storage: { local } });
  return { values, local };
}

afterEach(() => vi.unstubAllGlobals());

describe('popup prompt session persistence', () => {
  it('restores the draft and most recent result after a popup is reopened', async () => {
    const { values } = stubStorage();
    await savePromptSession({ prompt: 'Draft prompt', result: 'Last successful result' });

    // A fresh call represents the new popup document created after dismissal.
    await expect(loadPromptSession()).resolves.toEqual({ prompt: 'Draft prompt', result: 'Last successful result' });
    expect(values[promptSessionStorageKey]).toEqual({ prompt: 'Draft prompt', result: 'Last successful result' });
  });

  it('returns a safe empty session for missing or malformed stored data', async () => {
    const { values } = stubStorage();
    values[promptSessionStorageKey] = { prompt: 42, result: null };

    await expect(loadPromptSession()).resolves.toEqual({ prompt: '', result: '' });
  });

  it('removes the saved draft and result only when explicitly cleared', async () => {
    const { values, local } = stubStorage();
    await savePromptSession({ prompt: 'Keep until reset', result: 'Saved output' });
    await clearPromptSession();

    expect(local.remove).toHaveBeenCalledWith(promptSessionStorageKey);
    expect(values[promptSessionStorageKey]).toBeUndefined();
    await expect(loadPromptSession()).resolves.toEqual({ prompt: '', result: '' });
  });

  it('surfaces storage failures so the popup can show a recovery message', async () => {
    const { local } = stubStorage();
    local.set.mockRejectedValueOnce(new Error('storage denied'));

    await expect(savePromptSession({ prompt: 'Prompt', result: '' })).rejects.toThrow('storage denied');
  });
});
