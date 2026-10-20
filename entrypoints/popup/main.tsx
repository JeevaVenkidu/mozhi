import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../../src/styles.css';
import { Icon, MozhiMark } from '../../src/components/icons';
import { ModeSelector } from '../../src/components/mode-selector';
import { ProviderSelector } from '../../src/components/provider-selector';
import { enhancePrompt } from '../../src/core/enhancer';
import { defaultSettings, type EnhancementMode, type ProviderKind } from '../../src/core/types';
import { LOCAL_MAX_PROMPT_LENGTH } from '../../src/core/validation';
import { insertIntoChatGPT } from '../../src/integrations/chatgpt';
import { LocalModelProvider } from '../../src/providers/local-model';
import { localModel, type LocalInferenceProgress } from '../../src/providers/local-model-config';
import { mockProvider } from '../../src/providers/mock-provider';
import { OpenAICompatibleProvider } from '../../src/providers/openai-compatible';
import { hasOnlineApiKey, readOnlineApiKey } from '../../src/services/credentials';
import { initialLocalModelState, loadLocalModelState, localModelStateStorageKey, type LocalModelState } from '../../src/services/local-model-state';
import { loadPromptSession, savePromptSession, clearPromptSession, promptSessionStorageKey } from '../../src/services/prompt-session';
import { saveComparisonSession } from '../../src/services/comparison-session';
import { requestOnlineHostPermission } from '../../src/services/online-permissions';
import { loadSettings, saveSettings } from '../../src/services/settings';
import type { ModelProvider } from '../../src/providers/provider.interface';
import { creatorInfo } from '../../src/core/about-config';

function Popup() {
  const [prompt, setPrompt] = useState('');
  const [result, setResult] = useState('');
  const [provider, setProvider] = useState<ProviderKind>(defaultSettings.provider);
  const [mode, setMode] = useState<EnhancementMode>(defaultSettings.enhancementMode);
  const [onlineBaseUrl, setOnlineBaseUrl] = useState('');
  const [onlineModel, setOnlineModel] = useState('');
  const [localModelId, setLocalModelId] = useState(defaultSettings.localModelId);
  const [localModelState, setLocalModelState] = useState<LocalModelState>({ status: 'not-downloaded', progress: null, updatedAt: 0 });
  const [modelProgress, setModelProgress] = useState<LocalInferenceProgress | null>(null);
  const [status, setStatus] = useState<'idle' | 'working' | 'copied' | 'cancelled' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const [storageMessage, setStorageMessage] = useState('');
  const [insertNotice, setInsertNotice] = useState('');
  const [pendingReplacement, setPendingReplacement] = useState<{ signature: string; text: string } | null>(null);
  const [hasApiKey, setHasApiKey] = useState(false);
  const [ready, setReady] = useState(false);
  const [preferencesLoaded, setPreferencesLoaded] = useState(false);
  const [promptSessionLoaded, setPromptSessionLoaded] = useState(false);
  const [promptCopied, setPromptCopied] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const localProviderRef = useRef<LocalModelProvider | null>(null);
  const copyTimer = useRef<ReturnType<typeof globalThis.setTimeout> | undefined>(undefined);
  const promptCopyTimer = useRef<ReturnType<typeof globalThis.setTimeout> | undefined>(undefined);

  useEffect(() => {
    document.documentElement.style.width = '390px';
    document.body.style.width = '390px';
    document.body.style.overflowX = 'hidden';
  }, []);

  useEffect(() => {
    void Promise.allSettled([loadSettings(), hasOnlineApiKey(), loadPromptSession(), loadLocalModelState()]).then((values) => {
      const [settings, apiKey, session, modelState] = values;
      if (settings.status === 'fulfilled') {
        const loadedProvider = settings.value.provider;
        setProvider(loadedProvider);
        setMode(loadedProvider === 'local' ? 'typo' : settings.value.enhancementMode);
        setOnlineBaseUrl(settings.value.onlineBaseUrl);
        setOnlineModel(settings.value.onlineModel);
        setLocalModelId(settings.value.localModelId);
        setPreferencesLoaded(true);
      }
      if (apiKey.status === 'fulfilled') setHasApiKey(apiKey.value);
      if (session.status === 'fulfilled') {
        setPrompt(session.value.prompt);
        setResult(session.value.result);
        setPromptSessionLoaded(true);
      }
      if (modelState.status === 'fulfilled') setLocalModelState(modelState.value);
      if (session.status === 'rejected') setStorageMessage('Saved prompt data could not be read. Existing prompt data will not be overwritten.');
      else if (values.some((value) => value.status === 'rejected')) setStorageMessage('Some saved settings could not be read. The popup is still usable.');
      setReady(true);
    });
  }, []);

  useEffect(() => {
    if (!preferencesLoaded) return;
    void saveSettings({ provider, enhancementMode: mode, localModelId, onlineBaseUrl, onlineModel })
      .catch(() => setStorageMessage('Could not save your provider or mode preference.'));
  }, [mode, localModelId, onlineBaseUrl, onlineModel, provider, preferencesLoaded]);

  useEffect(() => {
    if (!promptSessionLoaded) return;
    const timer = globalThis.setTimeout(() => {
      void savePromptSession({ prompt, result }).catch(() => setStorageMessage('Could not save this prompt session.'));
    }, 180);
    const persistOnClose = () => { void savePromptSession({ prompt, result }).catch(() => {}); };
    window.addEventListener('pagehide', persistOnClose);
    return () => {
      globalThis.clearTimeout(timer);
      window.removeEventListener('pagehide', persistOnClose);
    };
  }, [prompt, result, promptSessionLoaded]);

  useEffect(() => {
    const onStorageChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      const change = changes[localModelStateStorageKey];
      const next = change?.newValue as LocalModelState | undefined;
      if (area === 'local' && change) setLocalModelState(next?.status ? next : initialLocalModelState());
      if (area === 'local' && changes[promptSessionStorageKey] && changes[promptSessionStorageKey].newValue === undefined) {
        setPrompt('');
        setResult('');
        setPromptSessionLoaded(true);
      }
    };
    chrome.storage.onChanged.addListener(onStorageChanged);
    return () => chrome.storage.onChanged.removeListener(onStorageChanged);
  }, []);

  async function enhance() {
    if (!prompt.trim() || status === 'working') return;
    const controller = new AbortController();
    abortRef.current = controller;
    setStatus('working');
    setErrorMessage('');
    setInsertNotice('');
    setModelProgress(null);
    try {
      if (promptSessionLoaded) {
        await savePromptSession({ prompt, result }).catch(() => setStorageMessage('Could not save this prompt session.'));
      }
      if (controller.signal.aborted) throw new DOMException('Request cancelled', 'AbortError');
      let selectedProvider: ModelProvider = mockProvider;
      if (provider === 'openai-compatible') {
        if (!hasApiKey) throw new Error('Add an API key in Settings before using Online mode.');
        const config = { baseUrl: onlineBaseUrl, model: onlineModel };
        const permissionGranted = await requestOnlineHostPermission(config);
        if (!permissionGranted) throw new Error('Allow access to the configured endpoint in Chrome, or switch to Local mode.');
        const apiKey = await readOnlineApiKey();
        if (!apiKey) throw new Error('Add an API key in Settings before using Online mode.');
        selectedProvider = new OpenAICompatibleProvider(config, apiKey);
      } else {
        if (mode !== 'typo') {
          throw new Error('Local model only supports Typo & Grammar Fix mode. Switch to Online BYOK for other modes.');
        }
        if (prompt.length > LOCAL_MAX_PROMPT_LENGTH) {
          throw new Error(`Local prompt correction is provisionally limited to ${LOCAL_MAX_PROMPT_LENGTH} characters (currently ${prompt.length}). Shorten your text or switch to Online BYOK.`);
        }
        if (localModelState.status !== 'ready') {
          throw new Error(localModelState.status === 'downloaded'
            ? 'Run Test local inference in Settings before using Local mode.'
            : 'Download the local model in Settings before enhancing.');
        }
        localProviderRef.current ??= new LocalModelProvider(setModelProgress, undefined, localModelState.backend);
        localProviderRef.current.setPreferredBackend(localModelState.backend);
        selectedProvider = localProviderRef.current;
      }
      const enhanced = await enhancePrompt({ prompt, mode }, selectedProvider, controller.signal);
      if (abortRef.current !== controller) return;
      setResult(enhanced);
      if (promptSessionLoaded) {
        await savePromptSession({ prompt, result: enhanced }).catch(() => setStorageMessage('Could not save the enhanced result.'));
      }
      setStatus('idle');
    } catch (error) {
      if (abortRef.current !== controller) return;
      if (controller.signal.aborted || (error instanceof DOMException && error.name === 'AbortError')) {
        setStatus('cancelled');
      } else {
        setStatus('error');
        setErrorMessage(error instanceof Error ? error.message : 'Could not enhance the prompt. Your original text and previous result are unchanged.');
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  }

  function cancel() {
    abortRef.current?.abort();
    setModelProgress(null);
  }

  function reset() {
    abortRef.current?.abort();
    abortRef.current = null;
    setPrompt('');
    setResult('');
    setPromptSessionLoaded(true);
    setErrorMessage('');
    setInsertNotice('');
    setPendingReplacement(null);
    setModelProgress(null);
    setStatus('idle');
    void clearPromptSession().catch(() => setStorageMessage('The prompt cleared, but saved data could not be removed.'));
  }

  async function copyPrompt() {
    if (!prompt) return;
    try {
      await navigator.clipboard.writeText(prompt);
      setPromptCopied(true);
      if (promptCopyTimer.current) globalThis.clearTimeout(promptCopyTimer.current);
      promptCopyTimer.current = globalThis.setTimeout(() => setPromptCopied(false), 1600);
    } catch {
      setErrorMessage('Could not copy the original prompt. Select the text and copy it manually.');
    }
  }

  async function openComparisonTab() {
    if (!result || !prompt) return;
    try {
      await saveComparisonSession({ original: prompt, enhanced: result, mode });
      await chrome.tabs.create({ url: chrome.runtime.getURL('compare.html') });
    } catch {
      setErrorMessage('Could not open comparison page.');
    }
  }

  async function copy() {
    if (!result || status === 'working') return;
    try {
      await navigator.clipboard.writeText(result);
      setStatus('copied');
      if (copyTimer.current) globalThis.clearTimeout(copyTimer.current);
      copyTimer.current = globalThis.setTimeout(() => setStatus((current) => current === 'copied' ? 'idle' : current), 1600);
    } catch {
      setErrorMessage('Could not copy the result. Select the text and copy it manually.');
    }
  }

  async function insertResult(signature?: string) {
    if (!result || status === 'working') return;
    setErrorMessage('');
    setInsertNotice('');
    try {
      const insertion = await insertIntoChatGPT(result, signature);
      if (insertion.status === 'needs-confirmation') {
        setPendingReplacement({ signature: insertion.signature, text: result });
      } else if (insertion.status === 'changed') {
        setPendingReplacement(null);
        setErrorMessage('The ChatGPT prompt changed while you were confirming. Review it and insert again.');
      } else {
        setPendingReplacement(null);
        setInsertNotice('Inserted in ChatGPT. Review it there before sending.');
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Could not insert the prompt into ChatGPT.');
    }
  }

  const working = status === 'working';
  const modelReady = localModelState.status === 'ready';

  return <main className="mozhi-scrollbar flex max-h-[580px] min-h-[460px] w-[390px] max-w-[390px] flex-col gap-3 overflow-x-hidden overflow-y-auto bg-canvas p-3.5 text-ink">
    <header className="flex items-center justify-between pb-2.5 border-b border-line-subtle">
      <div className="flex items-center gap-2">
        <div className="grid size-6 place-items-center rounded-lg bg-ink text-white shadow-xs">
          <MozhiMark className="size-3.5" />
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          <h1 className="font-serif text-lg font-bold tracking-tight text-ink leading-none">Mozhi</h1>
          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-subtle text-muted-ink border border-line">
            v0.1.0
          </span>
          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-subtle text-muted-ink border border-line">
            மொழி
          </span>
          <a
            href={creatorInfo.websiteUrl}
            target="_blank"
            rel="noopener noreferrer"
            title={`Created by ${creatorInfo.name}`}
            className="text-[10px] font-mono text-muted-ink/75 hover:text-indigo transition underline-offset-2 hover:underline ml-0.5"
          >
            by {creatorInfo.name}
          </a>
        </div>
      </div>

      <button
        type="button"
        onClick={() => void chrome.runtime.openOptionsPage()}
        aria-label="Open settings in a new tab"
        title="Settings"
        className="grid size-7 place-items-center rounded-lg border border-line bg-surface text-muted-ink hover:text-ink hover:bg-subtle transition active:scale-95 shadow-2xs"
      >
        <Icon name="settings" className="size-3.5" />
      </button>
    </header>

    <ProviderSelector
      value={provider}
      onChange={(nextProvider) => {
        setProvider(nextProvider);
        if (nextProvider === 'local') {
          setMode('typo');
        }
      }}
      compact
      disabled={working || !ready || !preferencesLoaded}
    />
    {provider === 'local' && !modelReady && (
      <p className="-mt-2 flex min-h-5 items-center gap-1.5 text-xs text-muted-ink" aria-live="polite">
        <span className="size-1.5 shrink-0 rounded-full bg-orange" />
        <span className="truncate">
          {localModelState.status === 'downloading'
            ? 'Model download in progress in Settings'
            : localModelState.status === 'downloaded'
            ? 'Model downloaded — verification needed'
            : 'Local model not downloaded'}
        </span>
        <button
          type="button"
          onClick={() => void chrome.runtime.openOptionsPage()}
          className="ml-auto min-h-6 shrink-0 px-1 text-xs font-semibold text-indigo underline underline-offset-2"
        >
          Settings
        </button>
      </p>
    )}

    <ModeSelector
      value={mode}
      onChange={setMode}
      provider={provider}
      onSwitchToOnline={(targetMode) => {
        setProvider('openai-compatible');
        setMode(targetMode);
      }}
      compact
      disabled={working || !ready || !preferencesLoaded}
    />

    <section aria-labelledby="prompt-label" className="doppelrand-shell p-1">
      <div className="doppelrand-core p-3 flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <label id="prompt-label" htmlFor="prompt" className="text-[10px] font-mono font-semibold tracking-wider uppercase text-muted-ink">
            Your Prompt
          </label>
          <div className="flex items-center gap-2">
            {prompt.trim() && (
              <button
                type="button"
                onClick={() => void copyPrompt()}
                title="Copy original prompt"
                className="text-[10px] font-mono text-indigo hover:text-indigo-hover transition flex items-center gap-1 font-medium"
              >
                <Icon name={promptCopied ? 'check' : 'copy'} className="size-3" />
                <span>{promptCopied ? 'Copied' : 'Copy'}</span>
              </button>
            )}
            <span className={`text-[10px] font-mono tabular-nums ${
              provider === 'local' && prompt.length > LOCAL_MAX_PROMPT_LENGTH ? 'text-danger font-semibold' : 'text-faint'
            }`}>
              {provider === 'local'
                ? `${prompt.length}/${LOCAL_MAX_PROMPT_LENGTH} (Local limit)`
                : `${prompt.length}/20,000`}
            </span>
          </div>
        </div>
        <textarea
          id="prompt"
          maxLength={20_000}
          value={prompt}
          readOnly={working || !ready}
          onChange={(event) => { setPrompt(event.target.value); setErrorMessage(''); }}
          placeholder="What would you like to ask or refine?"
          className="min-h-[82px] w-full resize-y rounded-xl bg-canvas/40 p-2.5 text-xs leading-relaxed text-ink placeholder:text-muted-ink/60 border border-line-subtle outline-none transition focus:border-indigo focus:bg-white read-only:bg-canvas/60"
        />
        {provider === 'local' && prompt.length > LOCAL_MAX_PROMPT_LENGTH && (
          <p role="alert" className="text-[11px] leading-tight text-danger font-medium mt-1">
            Prompt exceeds local provisional limit of {LOCAL_MAX_PROMPT_LENGTH} characters ({prompt.length}/{LOCAL_MAX_PROMPT_LENGTH}). Shorten your text or switch to Online BYOK.
          </p>
        )}
      </div>
    </section>

    <div className="flex gap-2 items-center">
      {working ? (
        <button
          type="button"
          onClick={cancel}
          className="flex min-h-10 flex-1 items-center justify-center gap-2 rounded-xl border border-danger/30 bg-danger-soft px-3 text-xs font-semibold text-danger transition hover:bg-danger/10 active:scale-[0.98]"
        >
          <Icon name="x" className="size-4" />Cancel
        </button>
      ) : (
        <button
          type="button"
          disabled={!ready || !prompt.trim() || (provider === 'local' && (!modelReady || prompt.length > LOCAL_MAX_PROMPT_LENGTH))}
          onClick={() => void enhance()}
          className="group relative flex min-h-10 flex-1 items-center justify-center gap-2 rounded-xl bg-ink px-3 text-xs font-semibold text-white shadow-xs transition-all duration-200 hover:bg-black active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
        >
          <span>Enhance prompt</span>
          <div className="w-5 h-5 rounded-full bg-white/10 flex items-center justify-center transition-transform duration-200 group-hover:scale-110">
            <Icon name="sparkle" className="size-3 text-white" />
          </div>
        </button>
      )}
      <button
        type="button"
        onClick={reset}
        aria-label="Reset prompt and result"
        title="Reset prompt and result"
        className="grid min-h-10 min-w-10 place-items-center rounded-xl border border-line bg-surface text-muted-ink transition hover:border-line hover:bg-subtle hover:text-ink active:scale-95"
      >
        <Icon name="reset" className="size-4" />
      </button>
    </div>

    <section aria-labelledby="preview-label" className="doppelrand-shell p-1">
      <div className="doppelrand-core p-3 flex flex-col gap-2">
        <div className="flex min-h-6 items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 min-w-0">
            <h2 id="preview-label" className="text-[10px] font-mono font-semibold tracking-wider uppercase text-muted-ink shrink-0">
              Enhanced Result
            </h2>
            {result && (
              <span className="text-[9px] font-mono px-1.5 py-0.2 rounded bg-indigo-soft text-indigo-900 border border-indigo/20 uppercase font-semibold shrink-0">
                {mode}
              </span>
            )}
          </div>
          {result && (
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={() => void openComparisonTab()}
                disabled={working}
                title="Open detailed side-by-side comparison in a new tab"
                className="flex items-center gap-1 rounded-lg border border-line bg-surface px-2 py-0.5 text-xs font-medium text-muted-ink hover:text-ink hover:bg-subtle transition shadow-2xs disabled:opacity-40"
              >
                <Icon name="compare" className="size-3" />
                <span>Compare</span>
              </button>
              <button
                type="button"
                onClick={() => void copy()}
                disabled={working}
                title="Copy enhanced prompt to clipboard"
                className={`flex items-center gap-1 rounded-lg border border-line bg-surface px-2.5 py-0.5 text-xs font-medium transition shadow-2xs ${
                  status === 'copied' ? 'bg-emerald-soft text-emerald-800 border-emerald/30' : 'text-muted-ink hover:text-ink hover:bg-subtle'
                } disabled:opacity-40`}
              >
                <Icon name={status === 'copied' ? 'check' : 'copy'} className="size-3" />
                <span>{status === 'copied' ? 'Copied' : 'Copy'}</span>
              </button>
            </div>
          )}
        </div>
        {working && (
          <div role="status" aria-live="polite" className="flex items-center gap-2 text-xs text-muted-ink">
            <span className="size-3 animate-spin rounded-full border-2 border-indigo border-r-transparent" />
            {provider === 'local' ? localProgressLabel(modelProgress) : 'Enhancing with your configured online provider…'}
          </div>
        )}
        <textarea
          aria-label="Edit enhanced prompt"
          maxLength={30_000}
          value={result}
          readOnly={working || !ready}
          onChange={(event) => setResult(event.target.value)}
          placeholder={ready ? 'Your refined prompt will appear here.' : 'Restoring your last prompt…'}
          className="mozhi-scrollbar min-h-[74px] w-full resize-y rounded-xl bg-canvas/40 p-2.5 text-xs leading-relaxed text-ink placeholder:text-muted-ink/60 border border-line-subtle outline-none transition focus:border-indigo focus:bg-white read-only:bg-canvas/60"
        />
        {result && (
          <button
            type="button"
            onClick={() => void insertResult()}
            disabled={working}
            title="Review and safely insert prompt into ChatGPT"
            className="flex min-h-9 w-full items-center justify-center gap-2 rounded-xl bg-ink px-3 text-xs font-semibold text-white shadow-xs transition hover:bg-black active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40"
          >
            <span>Review &amp; Insert</span>
            <Icon name="arrow" className="size-3.5" />
          </button>
        )}
      </div>
    </section>

    {pendingReplacement && (
      <section role="alertdialog" aria-labelledby="replace-title" aria-describedby="replace-description" className="rounded-xl border border-amber-300 bg-amber-50/90 p-3 shadow-xs">
        <h3 id="replace-title" className="text-xs font-semibold text-amber-950">Replace the current ChatGPT prompt?</h3>
        <p id="replace-description" className="mt-1 text-xs leading-normal text-amber-900">The field isn’t empty. Mozhi will insert text only; it will not send it.</p>
        <div className="mt-2.5 flex flex-wrap gap-2">
          <button type="button" onClick={() => void insertResult(pendingReplacement.signature)} disabled={pendingReplacement.text !== result} className="min-h-8 rounded-lg bg-amber-950 px-3 text-xs font-semibold text-white hover:bg-black disabled:opacity-50">Replace prompt</button>
          <button type="button" autoFocus onClick={() => setPendingReplacement(null)} className="min-h-8 rounded-lg border border-amber-300 bg-white px-3 text-xs font-semibold text-amber-950 hover:bg-amber-50">Keep current text</button>
        </div>
      </section>
    )}
    {insertNotice && <p role="status" className="text-xs text-emerald-700 font-medium">{insertNotice}</p>}
    {status === 'cancelled' && <p role="status" className="text-xs text-muted-ink">Enhancement cancelled. Your saved prompt and previous result are unchanged.</p>}
    {errorMessage && <p role="alert" className="text-xs leading-normal text-danger">{errorMessage}</p>}
    {storageMessage && <p role="status" className="text-xs leading-normal text-orange">{storageMessage}</p>}

    <footer className="pt-2 border-t border-line-subtle flex flex-col items-center gap-1 text-center">
      <p className="text-[10px] font-mono font-medium text-muted-ink">
        Write anywhere <span className="text-faint">→</span> Refine with Mozhi <span className="text-faint">→</span> Review &amp; safely insert
      </p>
      <p className="text-[10px] leading-relaxed text-faint">
        {provider === 'local'
          ? (modelReady
              ? 'Local on-device: prompt correction stays on this device only when local inference is used.'
              : 'Local model selected: download and verify model files in Settings before refining.')
          : 'Online BYOK: prompt is sent to your configured provider endpoint only when you choose Enhance.'}
      </p>
    </footer>
  </main>;
}

function localProgressLabel(progress: LocalInferenceProgress | null): string {
  if (!progress) return 'Loading the local model…';
  if (progress.stage === 'loading') return 'Loading the local model…';
  if (progress.stage === 'fallback') return 'WebGPU could not start. Switching to WASM…';
  return 'Enhancing on this device…';
}

createRoot(document.getElementById('root')!).render(<Popup />);
