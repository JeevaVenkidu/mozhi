import { defaultSettings, type UserSettings } from '../core/types';
import { localModel } from '../providers/local-model-config';

const settingsKey = 'mozhi-settings';

export async function loadSettings(): Promise<UserSettings> {
  const stored = await chrome.storage.local.get(settingsKey);
  return {
    ...defaultSettings,
    ...(stored[settingsKey] as Partial<UserSettings> | undefined),
    // Model selection is currently fixed by the packaged runtime. Migrate stale
    // settings so the UI cannot advertise a model that the worker no longer uses.
    localModelId: localModel.id,
  };
}

export async function saveSettings(settings: UserSettings): Promise<void> {
  await chrome.storage.local.set({ [settingsKey]: settings });
}
