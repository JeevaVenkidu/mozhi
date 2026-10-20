import type { LocalBackend } from '../providers/local-backend';
import { localModel } from '../providers/local-model-config';

export type LocalModelStatus = 'not-downloaded' | 'downloaded' | 'downloading' | 'ready' | 'interrupted' | 'error';

export interface LocalModelState {
  status: LocalModelStatus;
  progress: number | null;
  modelId?: string;
  modelRevision?: string;
  verificationVersion?: number;
  backend?: LocalBackend;
  backends?: LocalBackend[];
  verifiedBackends?: LocalBackend[];
  file?: string;
  message?: string;
  updatedAt: number;
}

const localModelStateKey = 'mozhi-local-model-state';
const localModelVerificationVersion = 3;

export function initialLocalModelState(): LocalModelState {
  return { status: 'not-downloaded', progress: null, updatedAt: Date.now() };
}

export async function loadLocalModelState(): Promise<LocalModelState> {
  const stored = await chrome.storage.local.get(localModelStateKey);
  const value = stored[localModelStateKey] as Partial<LocalModelState> | undefined;
  const statuses: LocalModelStatus[] = ['not-downloaded', 'downloaded', 'downloading', 'ready', 'interrupted', 'error'];
  if (!value || !statuses.includes(value.status as LocalModelStatus)) return initialLocalModelState();
  if (value.modelId !== localModel.id || value.modelRevision !== localModel.revision) {
    return {
      ...initialLocalModelState(),
      message: 'The previous cached model was not the instruction-tuned model Mozhi now uses. Download the compatible model to use Local mode.',
    };
  }
  const needsQualityReverification = value.status === 'ready'
    && value.verificationVersion !== localModelVerificationVersion;
  return {
    status: needsQualityReverification ? 'downloaded' : value.status as LocalModelStatus,
    progress: typeof value.progress === 'number' ? Math.max(0, Math.min(100, value.progress)) : null,
    verificationVersion: localModelVerificationVersion,
    ...(value.backend === 'webgpu' || value.backend === 'wasm' ? { backend: value.backend } : {}),
    ...(Array.isArray(value.backends) ? { backends: value.backends.filter((item): item is LocalBackend => item === 'webgpu' || item === 'wasm') } : {}),
    ...(!needsQualityReverification && Array.isArray(value.verifiedBackends) ? { verifiedBackends: value.verifiedBackends.filter((item): item is LocalBackend => item === 'webgpu' || item === 'wasm') } : {}),
    ...(typeof value.file === 'string' ? { file: value.file } : {}),
    ...(needsQualityReverification
      ? { message: 'The previous check confirmed output existed, but did not verify its quality. Run Test local inference again.' }
      : typeof value.message === 'string' ? { message: value.message } : {}),
    updatedAt: typeof value.updatedAt === 'number' ? value.updatedAt : 0,
  };
}

export async function saveLocalModelState(state: LocalModelState): Promise<void> {
  await chrome.storage.local.set({
    [localModelStateKey]: {
      ...state,
      modelId: localModel.id,
      modelRevision: localModel.revision,
      verificationVersion: localModelVerificationVersion,
      updatedAt: Date.now(),
    },
  });
}

/** A status check after reopening Settings resolves stale progress or cache eviction. */
export function recoverLocalModelState(previous: LocalModelState, downloaded: boolean, backend?: LocalBackend, backends?: LocalBackend[]): LocalModelState {
  if (downloaded) {
    const verifiedBackends = previous.verifiedBackends?.filter((item) => backends?.includes(item)) ?? [];
    if (verifiedBackends.length > 0) {
      const verifiedBackend = verifiedBackends.includes(backend ?? 'wasm') ? backend : verifiedBackends[0];
      return { status: 'ready', progress: 100, ...(verifiedBackend ? { backend: verifiedBackend } : {}), ...(backends ? { backends, verifiedBackends } : {}), updatedAt: Date.now() };
    }
    return { status: 'downloaded', progress: 100, ...(backend ? { backend } : {}), ...(backends ? { backends } : {}), message: 'Model files downloaded. Verify the model before using Local mode.', updatedAt: Date.now() };
  }
  if (previous.status === 'downloading') {
    return { status: 'interrupted', progress: previous.progress, message: 'The download stopped before the model was ready. Start it again to resume missing files.', updatedAt: Date.now() };
  }
  if (previous.status === 'ready') {
    return { status: 'not-downloaded', progress: null, message: 'The model files are no longer in this browser cache.', updatedAt: Date.now() };
  }
  return previous;
}

export const localModelStateStorageKey = localModelStateKey;
