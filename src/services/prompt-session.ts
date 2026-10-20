export interface PromptSession {
  prompt: string;
  result: string;
}

export const promptSessionStorageKey = 'mozhi-prompt-session';
const emptyPromptSession: PromptSession = { prompt: '', result: '' };
let promptWriteQueue: Promise<void> = Promise.resolve();

function enqueuePromptWrite(operation: () => Promise<void>): Promise<void> {
  const write = promptWriteQueue.then(operation);
  promptWriteQueue = write.catch(() => { });
  return write;
}

/** The lightweight, non-sensitive popup draft and last successful result. */
export async function loadPromptSession(): Promise<PromptSession> {
  const stored = await chrome.storage.local.get(promptSessionStorageKey);
  const value = stored[promptSessionStorageKey] as Partial<PromptSession> | undefined;
  return {
    prompt: typeof value?.prompt === 'string' ? value.prompt : '',
    result: typeof value?.result === 'string' ? value.result : '',
  };
}

export async function savePromptSession(session: PromptSession): Promise<void> {
  await enqueuePromptWrite(() => chrome.storage.local.set({ [promptSessionStorageKey]: session }));
}

/** Clears only prompt content; provider and enhancement preferences are separate. */
export async function clearPromptSession(): Promise<void> {
  await enqueuePromptWrite(() => chrome.storage.local.remove(promptSessionStorageKey));
}

export function emptySession(): PromptSession {
  return { ...emptyPromptSession };
}
