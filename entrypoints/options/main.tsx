import { useEffect, useRef, useState, type FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import '../../src/styles.css';
import { Icon, MozhiMark } from '../../src/components/icons';
import { ProviderSelector } from '../../src/components/provider-selector';
import { OpenAICompatibleProvider, OnlineProviderError } from '../../src/providers/openai-compatible';
import { localModel } from '../../src/providers/local-model-config';
import { LocalModelManager, LocalModelWorkerError, type LocalModelCheck } from '../../src/providers/local-model-manager';
import type { LocalBackend } from '../../src/providers/local-backend';
import { createDiagnosticFailureReport, diagnosticRecommendation, formatDiagnosticReport, localDiagnosticCode, safeDiagnosticDetail, selectDiagnosticBackend, type DiagnosticCheck, type DiagnosticProgress, type LocalDiagnosticReport } from '../../src/providers/local-diagnostics';
import { validateOnlineProviderConfig } from '../../src/providers/online-config';
import { requestOnlineHostPermission } from '../../src/services/online-permissions';
import { requestLocalModelPermission } from '../../src/services/local-model-permissions';
import { hasOnlineApiKey, readOnlineApiKey, removeOnlineApiKey, saveOnlineApiKey } from '../../src/services/credentials';
import { loadSettings, saveSettings } from '../../src/services/settings';
import { clearAllMozhiData } from '../../src/services/user-data';
import { initialLocalModelState, loadLocalModelState, localModelStateStorageKey, recoverLocalModelState, saveLocalModelState, type LocalModelState } from '../../src/services/local-model-state';
import { withLocalModelLock } from '../../src/services/local-model-lock';
import { modes, defaultSettings, type UserSettings } from '../../src/core/types';
import { modeDefinitions } from '../../src/core/mode-definitions';
import {
  loadApiErrorLogs,
  clearApiErrorLogs,
  formatDiagnosticReportText,
  sanitizeLogForExport,
  API_ERROR_LOGS_STORAGE_KEY,
  type ApiErrorLogEntry,
} from '../../src/services/api-logger';
import {
  getExtensionPermissionsInfo,
  describeHostPermissionPurpose,
  type ExtensionPermissionsInfo,
} from '../../src/services/permissions-info';
import { creatorInfo } from '../../src/core/about-config';

const SECTION_IDS = ['processing', 'mode-guide', 'local-model', 'local-diagnostics', 'api-logs', 'permissions', 'privacy', 'about'] as const;
type SectionId = typeof SECTION_IDS[number];

const NAV_ITEMS: Array<{ id: SectionId; label: string }> = [
  { id: 'processing', label: '01 / Processing' },
  { id: 'mode-guide', label: '02 / Mode Guide' },
  { id: 'local-model', label: '03 / Local Model' },
  { id: 'local-diagnostics', label: '04 / Diagnostics' },
  { id: 'api-logs', label: '05 / API Error Logs' },
  { id: 'permissions', label: '06 / Permissions & Access' },
  { id: 'privacy', label: '07 / Privacy & Data' },
  { id: 'about', label: '08 / About Mozhi' },
];

function Options() {
  const extensionVersion = chrome.runtime?.getManifest?.()?.version ?? '0.1.0';
  const [settings, setSettings] = useState<UserSettings>(defaultSettings);
  const [activeSection, setActiveSection] = useState<SectionId>('processing');
  const [hasApiKey, setHasApiKey] = useState(false);
  const [permissionsInfo, setPermissionsInfo] = useState<ExtensionPermissionsInfo | null>(null);
  const [apiKeyDraft, setApiKeyDraft] = useState('');
  const [saved, setSaved] = useState('');
  const [error, setError] = useState('');
  const [connectionStatus, setConnectionStatus] = useState<'idle' | 'testing' | 'connected' | 'error'>('idle');
  const [connectionMessage, setConnectionMessage] = useState('');
  const [confirmClear, setConfirmClear] = useState(false);
  const [confirmDeleteModel, setConfirmDeleteModel] = useState(false);
  const [localModelState, setLocalModelState] = useState<LocalModelState>(initialLocalModelState);
  const [diagnosticReport, setDiagnosticReport] = useState<LocalDiagnosticReport | null>(null);
  const [diagnosticChecks, setDiagnosticChecks] = useState<DiagnosticCheck[]>([]);
  const [diagnosticProgress, setDiagnosticProgress] = useState<DiagnosticProgress | null>(null);
  const [diagnosticsRunning, setDiagnosticsRunning] = useState(false);
  const [reportCopied, setReportCopied] = useState(false);
  const [modelNotice, setModelNotice] = useState('');
  const [modelBusy, setModelBusy] = useState(false);
  const [modelStatusChecked, setModelStatusChecked] = useState(false);

  const [apiLogs, setApiLogs] = useState<ApiErrorLogEntry[]>([]);
  const [apiLogsLoading, setApiLogsLoading] = useState(true);
  const [apiLogsNotice, setApiLogsNotice] = useState('');
  const [apiLogsError, setApiLogsError] = useState('');
  const [confirmClearLogs, setConfirmClearLogs] = useState(false);
  const [clearingLogs, setClearingLogs] = useState(false);
  const [logsReportCopied, setLogsReportCopied] = useState(false);
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null);
  const [logSeverityFilter, setLogSeverityFilter] = useState<'all' | 'critical' | 'error' | 'warning'>('all');
  const [logStageFilter, setLogStageFilter] = useState<string>('all');
  const [logSearchQuery, setLogSearchQuery] = useState('');

  const modelManager = useRef<LocalModelManager | null>(null);
  const modelAbort = useRef<AbortController | null>(null);
  const progressSaveTimer = useRef<ReturnType<typeof globalThis.setTimeout> | undefined>(undefined);
  const isProgrammaticScroll = useRef(false);
  const scrollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  if (!modelManager.current) modelManager.current = new LocalModelManager();

  function updateSettings(next: UserSettings) {
    setSettings(next);
    setConnectionStatus('idle');
    setConnectionMessage('');
  }

  function scrollToSection(id: SectionId, updateUrl = true) {
    const element = document.getElementById(id);
    if (!element) return;

    setActiveSection(id);
    isProgrammaticScroll.current = true;
    if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);

    if (updateUrl && window.location.hash !== `#${id}`) {
      window.history.pushState(null, '', `#${id}`);
    }

    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    element.scrollIntoView({ behavior: prefersReducedMotion ? 'auto' : 'smooth', block: 'start' });

    scrollTimeoutRef.current = setTimeout(() => {
      isProgrammaticScroll.current = false;
    }, prefersReducedMotion ? 50 : 800);
  }

  function handleNavClick(event: React.MouseEvent<HTMLAnchorElement>, id: SectionId) {
    event.preventDefault();
    scrollToSection(id, true);
  }

  useEffect(() => {
    const applyHash = () => {
      const hash = window.location.hash.replace('#', '') as SectionId;
      if (SECTION_IDS.includes(hash)) {
        scrollToSection(hash, false);
      }
    };

    const timer = setTimeout(applyHash, 100);
    window.addEventListener('hashchange', applyHash);

    return () => {
      clearTimeout(timer);
      window.removeEventListener('hashchange', applyHash);
    };
  }, []);

  useEffect(() => {
    const sectionElements = SECTION_IDS.map((id) => document.getElementById(id)).filter(Boolean) as HTMLElement[];
    if (!sectionElements.length) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (isProgrammaticScroll.current) return;

        const scrollBottom = window.innerHeight + window.scrollY;
        const totalHeight = document.documentElement.scrollHeight;
        if (totalHeight - scrollBottom < 80) {
          setActiveSection('about');
          return;
        }

        if (window.scrollY < 120) {
          setActiveSection('processing');
          return;
        }

        const visible = entries.filter((e) => e.isIntersecting);
        if (visible.length > 0) {
          const best = visible.reduce((prev, curr) =>
            curr.intersectionRatio > prev.intersectionRatio ? curr : prev
          );
          const targetId = best.target.id as SectionId;
          if (SECTION_IDS.includes(targetId)) {
            setActiveSection(targetId);
          }
        }
      },
      {
        root: null,
        rootMargin: '-80px 0px -45% 0px',
        threshold: [0, 0.15, 0.3, 0.5, 0.75, 1.0],
      }
    );

    sectionElements.forEach((el) => observer.observe(el));

    let ticking = false;
    const handleScroll = () => {
      if (isProgrammaticScroll.current || ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        ticking = false;
        if (isProgrammaticScroll.current) return;

        if (window.scrollY < 120) {
          setActiveSection('processing');
        } else if (document.documentElement.scrollHeight - (window.innerHeight + window.scrollY) < 60) {
          setActiveSection('about');
        }
      });
    };

    window.addEventListener('scroll', handleScroll, { passive: true });

    return () => {
      observer.disconnect();
      window.removeEventListener('scroll', handleScroll);
      if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
    };
  }, []);

  useEffect(() => {
    void Promise.allSettled([loadSettings(), hasOnlineApiKey(), loadLocalModelState()]).then(async ([settingsResult, keyResult, modelResult]) => {
      if (settingsResult.status === 'fulfilled') setSettings(settingsResult.value);
      if (keyResult.status === 'fulfilled') setHasApiKey(keyResult.value);
      if (modelResult.status === 'fulfilled') {
        const previous = modelResult.value;
        setLocalModelState(previous);
        if (previous.message && previous.status === 'not-downloaded') setModelNotice(previous.message);
        try {
          const checked = await withLocalModelLock('exclusive', () => modelManager.current!.checkStatus(), true);
          if (checked.acquired && checked.value) {
            const recovered = recoverLocalModelState(previous, checked.value.downloaded, checked.value.backend, checked.value.backends);
            setLocalModelState(recovered);
            await saveLocalModelState(recovered);
          }
        } catch {
          setModelNotice('Could not verify the model cache. Try again or retry the download.');
        }
      } else {
        setModelNotice('Could not read the saved model status. Check the model cache in Settings.');
      }
      setModelStatusChecked(true);
      if (settingsResult.status === 'rejected' || keyResult.status === 'rejected') setError('Some saved settings could not be loaded.');
    });

    void loadApiErrorLogs()
      .then((logs) => {
        setApiLogs(logs);
        setApiLogsLoading(false);
      })
      .catch(() => {
        setApiLogsLoading(false);
      });

    void getExtensionPermissionsInfo().then(setPermissionsInfo);

    const onStorageChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'local') {
        const modelChange = changes[localModelStateStorageKey];
        if (modelChange) {
          const next = modelChange.newValue as LocalModelState | undefined;
          setLocalModelState(next?.status ? next : initialLocalModelState());
        }
        const logsChange = changes[API_ERROR_LOGS_STORAGE_KEY];
        if (logsChange) {
          const nextLogs = logsChange.newValue as ApiErrorLogEntry[] | undefined;
          setApiLogs(Array.isArray(nextLogs) ? nextLogs : []);
        }
      }
    };
    chrome.storage.onChanged.addListener(onStorageChanged);
    return () => chrome.storage.onChanged.removeListener(onStorageChanged);
  }, []);

  async function save(event: FormEvent) {
    event.preventDefault();
    setError('');
    try {
      await saveSettings(settings);
      setSaved('Settings saved');
      globalThis.setTimeout(() => setSaved(''), 1800);
    } catch {
      setError('Could not save settings. Try again.');
    }
  }

  async function saveKey() {
    setError('');
    try {
      await saveOnlineApiKey(apiKeyDraft);
      setApiKeyDraft('');
      setHasApiKey(true);
      setConnectionStatus('idle');
      setConnectionMessage('');
      setSaved('API key saved');
      globalThis.setTimeout(() => setSaved(''), 1800);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save the API key.');
    }
  }

  async function removeKey() {
    await removeOnlineApiKey();
    setApiKeyDraft('');
    setHasApiKey(false);
    setConnectionStatus('idle');
    setConnectionMessage('');
    setSaved('API key removed');
    globalThis.setTimeout(() => setSaved(''), 1800);
  }

  async function testConnection() {
    setError('');
    setConnectionStatus('testing');
    setConnectionMessage('Testing endpoint connection…');
    try {
      const config = { baseUrl: settings.onlineBaseUrl, model: settings.onlineModel };
      validateOnlineProviderConfig(config);
      const permissionGranted = await requestOnlineHostPermission(config);
      if (!permissionGranted) throw new OnlineProviderError('Allow endpoint access in Chrome to test this connection.');
      const apiKey = await readOnlineApiKey();
      if (!apiKey) throw new OnlineProviderError('Save an API key before testing the connection.');
      const provider = new OpenAICompatibleProvider(config, apiKey);
      await provider.testConnection();
      setConnectionStatus('connected');
      setConnectionMessage('Connection successful');
    } catch (cause) {
      setConnectionStatus('error');
      const msg = cause instanceof Error ? cause.message : 'Could not connect to the endpoint.';
      setConnectionMessage(msg);
      setError(msg);
    }
  }

  async function clearLocalData() {
    setError('');
    try {
      const locked = await withLocalModelLock('exclusive', clearAllMozhiData, true);
      if (!locked.acquired || !locked.value) throw new Error('The local model is in use or downloading. Wait for it to finish before clearing saved data.');
      const outcome = locked.value;
      setSettings(defaultSettings);
      setHasApiKey(false);
      setApiKeyDraft('');
      setLocalModelState(initialLocalModelState());
      setApiLogs([]);
      setConnectionStatus('idle');
      setConfirmClear(false);
      setSaved(outcome.cacheError
        ? 'Saved settings, prompt, and API key cleared; model cache cleanup failed.'
        : outcome.modelCacheCleared
          ? 'Saved settings, prompt, API key, and downloaded model cleared.'
          : 'Saved settings, prompt, and API key cleared; no model cache was present.');
      globalThis.setTimeout(() => setSaved(''), 3500);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not clear saved settings. Try again.');
    }
  }

  async function downloadLocalModel(requestedBackend?: LocalBackend) {
    if (modelBusy || diagnosticsRunning || !modelStatusChecked || localModelState.status === 'downloading') return;
    // Begin only a user-initiated permission request while this click is active.
    const permissionRequest = localModelState.status === 'downloaded' ? undefined : requestLocalModelPermission();
    setModelBusy(true);
    setModelNotice('');
    setConfirmDeleteModel(false);
    const controller = new AbortController();
    modelAbort.current = controller;
    try {
      const locked = await withLocalModelLock('exclusive', async () => {
        const existing = await modelManager.current!.checkStatus();
        if (existing.downloaded && (!requestedBackend || existing.backends.includes(requestedBackend))) {
          const verified = await modelManager.current!.verify(() => {}, controller.signal, requestedBackend);
          const readyState: LocalModelState = {
            status: 'ready', progress: 100, backend: verified.backend, backends: existing.backends,
            verifiedBackends: [...new Set([...(localModelState.verifiedBackends ?? []), verified.backend])], updatedAt: Date.now(),
          };
          setLocalModelState(readyState);
          await saveLocalModelState(readyState);
          return 'verified' as const;
        }

        const permission = await (permissionRequest ?? requestLocalModelPermission());
        if (!permission) throw new Error('Allow access to Hugging Face in Chrome to download the model.');

        let current: LocalModelState = { status: 'downloading', progress: 0, message: 'Starting model download…', backends: existing.backends, updatedAt: Date.now() };
        setLocalModelState(current);
        try {
          await saveLocalModelState(current);
        } catch {
          setModelNotice('Download started, but its status could not be saved. Keep this Settings tab open until it finishes.');
        }

        try {
          const downloaded = await modelManager.current!.download((progress) => {
            current = {
              ...current,
              progress: typeof progress.progress === 'number' ? Math.max(0, Math.min(100, progress.progress)) : current.progress,
              ...(progress.file ? { file: progress.file } : {}),
              message: progress.stage === 'loading' ? 'Preparing the local runtime…' : progress.stage === 'fallback' ? 'WebGPU could not start. Preparing WASM instead…' : 'Downloading model files…',
              updatedAt: Date.now(),
            };
            setLocalModelState(current);
            if (progressSaveTimer.current) globalThis.clearTimeout(progressSaveTimer.current);
            progressSaveTimer.current = globalThis.setTimeout(() => {
              void saveLocalModelState(current).catch(() => setModelNotice('Download is continuing, but progress could not be saved.'));
            }, 500);
          }, controller.signal, requestedBackend);
          if (progressSaveTimer.current) globalThis.clearTimeout(progressSaveTimer.current);
          const readyState: LocalModelState = {
            status: 'ready', progress: 100, backend: downloaded.backend, backends: [...new Set([...existing.backends, downloaded.backend])],
            verifiedBackends: [...new Set([...(localModelState.verifiedBackends ?? []), downloaded.backend])], updatedAt: Date.now(),
          };
          setLocalModelState(readyState);
          await saveLocalModelState(readyState);
          return 'downloaded' as const;
        } catch (cause) {
          if (progressSaveTimer.current) globalThis.clearTimeout(progressSaveTimer.current);
          const checked = await modelManager.current!.checkStatus().catch((): LocalModelCheck => ({ downloaded: false, backends: [] }));
          const interrupted = controller.signal.aborted;
          const verifiedBackends = localModelState.verifiedBackends?.filter((item) => checked.backends.includes(item)) ?? [];
          const next: LocalModelState = checked.downloaded
            ? verifiedBackends.length > 0
              ? { status: 'ready', progress: 100, ...(checked.backend ? { backend: checked.backend } : {}), backends: checked.backends, verifiedBackends, updatedAt: Date.now() }
              : { status: 'downloaded', progress: 100, ...(checked.backend ? { backend: checked.backend } : {}), backends: checked.backends, message: diagnosticMessage(cause), updatedAt: Date.now() }
            : interrupted
              ? { status: 'interrupted', progress: current.progress, message: 'Download cancelled. Start it again to resume missing files.', updatedAt: Date.now() }
              : { status: 'error', progress: null, message: cause instanceof Error ? cause.message : 'The model download failed. Check your connection and retry.', updatedAt: Date.now() };
          setLocalModelState(next);
          await saveLocalModelState(next).catch(() => setModelNotice('The model status could not be saved.'));
          if (!interrupted && !checked.downloaded) setModelNotice(next.message ?? 'Download failed. Check your connection and retry.');
          return interrupted ? 'cancelled' as const : checked.downloaded ? 'downloaded-unverified' as const : 'failed' as const;
        }
      }, true);

      if (!locked.acquired) setModelNotice('The local model is in use or downloading in another Mozhi window. Try again when it finishes.');
      else if (locked.value === 'downloaded' || locked.value === 'verified') setModelNotice('Model verified and ready on this device.');
    } catch (cause) {
      const message = diagnosticMessage(cause);
      if (localModelState.status === 'ready') {
        setModelNotice(message);
      } else {
        const next: LocalModelState = localModelState.status === 'downloaded'
          ? { ...localModelState, message, updatedAt: Date.now() }
          : controller.signal.aborted
          ? { status: 'interrupted', progress: localModelState.progress, message: 'Download cancelled. Start it again to resume missing files.', updatedAt: Date.now() }
          : { status: 'error', progress: null, message, updatedAt: Date.now() };
        setLocalModelState(next);
        await saveLocalModelState(next).catch(() => setModelNotice('The model status could not be saved.'));
        if (!controller.signal.aborted) setModelNotice(message);
      }
    } finally {
      if (progressSaveTimer.current) globalThis.clearTimeout(progressSaveTimer.current);
      modelAbort.current = null;
      setModelBusy(false);
    }
  }

  async function runLocalDiagnostics() {
    if (modelBusy || diagnosticsRunning) return;
    setDiagnosticsRunning(true);
    setDiagnosticReport(null);
    setDiagnosticChecks([]);
    setDiagnosticProgress(null);
    setReportCopied(false);
    setModelNotice('');
    try {
      const locked = await withLocalModelLock('exclusive', () => modelManager.current!.runDiagnostics((progress) => {
        setDiagnosticProgress(progress);
        setDiagnosticChecks((checks) => [...checks.filter((check) => check.id !== progress.check.id), progress.check]);
      }), true);
      if (!locked.acquired || !locked.value) {
        setModelNotice('The local model is in use or managed in another Mozhi window. Try diagnostics again when it finishes.');
        return;
      }
      setDiagnosticReport(locked.value);
      setDiagnosticChecks(locked.value.checks);
    } catch (cause) {
      const report = createDiagnosticFailureReport(
        browserLabelForSettings(),
        localModel.id,
        localModel.revision,
        cause instanceof LocalModelWorkerError && cause.diagnostic?.detail ? cause.diagnostic.detail : cause,
      );
      setDiagnosticReport(report);
      setDiagnosticChecks(report.checks);
    } finally {
      setDiagnosticsRunning(false);
      setDiagnosticProgress(null);
    }
  }

  async function testLocalInference() {
    if (modelBusy || diagnosticsRunning) return;
    if (!diagnosticReport) {
      setModelNotice('Run Local Model Diagnostics first, then test inference.');
      return;
    }
    setModelBusy(true);
    setModelNotice('Running a short on-device inference test…');
    let attemptedBackend: LocalBackend | undefined;
    try {
      const locked = await withLocalModelLock('exclusive', async () => {
        const cache = await modelManager.current!.checkStatus();
        if (!cache.downloaded) throw new Error('Model files are not downloaded. Download them explicitly before testing inference.');
        attemptedBackend = selectDiagnosticBackend(diagnosticReport, cache.backends) ?? undefined;
        if (!attemptedBackend) throw new Error('Diagnostics did not find a backend with passing browser and model compatibility checks.');
        const tested = await modelManager.current!.verify(() => {}, undefined, attemptedBackend);
        return { cache, tested };
      }, true);
      if (!locked.acquired || !locked.value) throw new Error('The local model is in use in another Mozhi window. Try the test again when it finishes.');
      const { cache, tested } = locked.value;
      setDiagnosticReport((report) => report ? updateDiagnosticChecks(report, [
        ...(tested.backend !== attemptedBackend ? [{
          id: `${attemptedBackend}-runtime`,
          label: `${attemptedBackend} model runtime initialization`,
          status: 'FAIL' as const,
          backend: attemptedBackend,
          detail: `${attemptedBackend} initialized, but failed the grammar check (produced unreadable output); inference completed on the WASM fallback.`,
        }] : []),
        { id: `${tested.backend}-runtime`, label: `${tested.backend} model runtime initialization`, status: 'PASS', backend: tested.backend, detail: 'Transformers.js initialized the cached model in the inference worker.' },
        { id: 'model-inference', label: 'Real model inference', status: 'PASS', backend: tested.backend, detail: `The model produced the expected grammar correction on ${tested.backend} for the fixed smoke test.` },
      ]) : report);
      const next: LocalModelState = {
        status: 'ready', progress: 100, backend: tested.backend, backends: cache.backends,
        verifiedBackends: [...new Set([...(localModelState.verifiedBackends ?? []), tested.backend])], updatedAt: Date.now(),
      };
      setLocalModelState(next);
      await saveLocalModelState(next);
      setModelNotice(`Local inference succeeded on ${tested.backend}.`);
    } catch (cause) {
      const errorMessage = diagnosticActionMessage(cause);
      const diagnostic = cause instanceof LocalModelWorkerError ? cause.diagnostic : undefined;
      const failure: DiagnosticCheck = {
        id: 'model-inference', label: 'Real model inference', status: 'FAIL',
        ...(diagnostic?.backend ?? attemptedBackend ? { backend: diagnostic?.backend ?? attemptedBackend } : {}),
        detail: diagnostic?.detail || safeDiagnosticDetail(cause) || errorMessage,
      };
      setDiagnosticReport((report) => report ? updateDiagnosticChecks(report, [
        ...(attemptedBackend ? [{
          id: `${attemptedBackend}-runtime`,
          label: `${attemptedBackend} model runtime initialization`,
          status: diagnostic?.stage === 'inference' ? 'PASS' as const : 'FAIL' as const,
          backend: attemptedBackend,
          detail: diagnostic?.stage === 'inference'
            ? 'Transformers.js initialized the model, but inference did not pass the smoke test.'
            : diagnostic?.detail || safeDiagnosticDetail(cause) || errorMessage,
        }] : []),
        ...(diagnostic?.fallbackCategory ? [{
          id: 'wasm-runtime',
          label: 'wasm model runtime initialization',
          status: diagnostic.fallbackStage === 'inference' ? 'PASS' as const : 'FAIL' as const,
          backend: 'wasm' as const,
          detail: diagnostic.fallbackStage === 'inference'
            ? 'Transformers.js initialized the WASM model, but inference did not pass the smoke test.'
            : diagnostic.fallbackDetail || 'The WASM fallback could not initialize.',
        }] : []),
        failure,
      ]) : report);
      const failedBackend = diagnostic?.backend ?? attemptedBackend;
      const failedBackends = new Set<LocalBackend>(diagnostic?.fallbackCategory
        ? ['webgpu', 'wasm']
        : failedBackend ? [failedBackend] : []);
      const verifiedBackends = (localModelState.verifiedBackends ?? []).filter((backend) => !failedBackends.has(backend));
      const next: LocalModelState = verifiedBackends.length > 0
        ? { ...localModelState, status: 'ready', backend: verifiedBackends[0], verifiedBackends, message: errorMessage, updatedAt: Date.now() }
        : { status: 'downloaded', progress: 100, backend: failedBackend, backends: localModelState.backends, message: errorMessage, updatedAt: Date.now() };
      setLocalModelState(next);
      await saveLocalModelState(next).catch(() => setModelNotice('The inference failure was found, but model status could not be saved.'));
      setModelNotice(errorMessage);
    } finally {
      setModelBusy(false);
    }
  }

  async function copyDiagnosticReport() {
    if (!diagnosticReport) return;
    try {
      await navigator.clipboard.writeText(formatDiagnosticReport(diagnosticReport));
      setReportCopied(true);
      globalThis.setTimeout(() => setReportCopied(false), 1800);
    } catch {
      setModelNotice('Could not copy the report. Select the displayed results and copy them manually.');
    }
  }

  function cancelModelDownload() {
    modelAbort.current?.abort();
  }

  function diagnosticMessage(cause: unknown): string {
    if (cause instanceof LocalModelWorkerError && cause.diagnostic) return `${cause.message} Diagnostic: ${localDiagnosticCode(cause.diagnostic)}.`;
    return cause instanceof Error ? cause.message : 'The model download failed. Check your connection and retry.';
  }

  async function deleteLocalModel() {
    if (modelBusy || !modelStatusChecked) return;
    setModelBusy(true);
    setModelNotice('');
    try {
      const locked = await withLocalModelLock('exclusive', () => modelManager.current!.delete(), true);
      if (!locked.acquired) throw new Error('The local model is in use. Wait for enhancement to finish, then try again.');
      if (!locked.value?.deleted) throw new Error('The model cache could not be removed. Try again.');
      const next = initialLocalModelState();
      setLocalModelState(next);
      await saveLocalModelState(next);
      setConfirmDeleteModel(false);
      setModelNotice('Downloaded model removed from this browser.');
    } catch (cause) {
      setModelNotice(cause instanceof Error ? cause.message : 'Could not remove the model. Try again.');
    } finally {
      setModelBusy(false);
    }
  }

  async function handleClearLogs() {
    setClearingLogs(true);
    setApiLogsError('');
    try {
      await clearApiErrorLogs();
      setApiLogs([]);
      setConfirmClearLogs(false);
      setApiLogsNotice('API diagnostic logs cleared.');
      globalThis.setTimeout(() => setApiLogsNotice(''), 3000);
    } catch (err) {
      setApiLogsError(err instanceof Error ? err.message : 'Could not clear API error logs.');
    } finally {
      setClearingLogs(false);
    }
  }

  async function copyApiDiagnosticReport(entriesToCopy: ApiErrorLogEntry[]) {
    if (!entriesToCopy.length) return;
    try {
      const text = formatDiagnosticReportText(entriesToCopy);
      await navigator.clipboard.writeText(text);
      setLogsReportCopied(true);
      globalThis.setTimeout(() => setLogsReportCopied(false), 2000);
    } catch {
      setApiLogsError('Could not copy the diagnostic report to clipboard.');
    }
  }

  function exportApiLogsJson(entriesToExport: ApiErrorLogEntry[]) {
    try {
      const sanitized = entriesToExport.map(sanitizeLogForExport);
      const jsonString = `data:text/json;charset=utf-8,${encodeURIComponent(JSON.stringify(sanitized, null, 2))}`;
      const downloadAnchor = document.createElement('a');
      downloadAnchor.setAttribute('href', jsonString);
      downloadAnchor.setAttribute('download', `mozhi-api-error-logs-${new Date().toISOString().slice(0, 10)}.json`);
      document.body.appendChild(downloadAnchor);
      downloadAnchor.click();
      downloadAnchor.remove();
      setApiLogsNotice('Exported sanitized diagnostic logs as JSON.');
      globalThis.setTimeout(() => setApiLogsNotice(''), 3000);
    } catch {
      setApiLogsError('Failed to export diagnostic logs as JSON.');
    }
  }

  const filteredApiLogs = apiLogs.filter((entry) => {
    if (logSeverityFilter !== 'all' && entry.severity !== logSeverityFilter) return false;
    if (logStageFilter !== 'all' && entry.stage !== logStageFilter) return false;
    if (logSearchQuery.trim()) {
      const q = logSearchQuery.toLowerCase();
      const match =
        entry.errorMessage.toLowerCase().includes(q) ||
        entry.errorName.toLowerCase().includes(q) ||
        entry.provider.toLowerCase().includes(q) ||
        entry.model.toLowerCase().includes(q) ||
        entry.correlationId.toLowerCase().includes(q) ||
        entry.operation.toLowerCase().includes(q) ||
        (entry.errorCode && entry.errorCode.toLowerCase().includes(q)) ||
        (entry.httpStatus && String(entry.httpStatus).includes(q));
      if (!match) return false;
    }
    return true;
  });

  const primaryDiagnosticIssue = diagnosticReport?.checks.find((check) => check.status === 'FAIL')
    ?? diagnosticReport?.checks.find((check) => check.status === 'UNAVAILABLE');

  return <div className="min-h-dvh bg-canvas text-ink">
    <header className="sticky top-0 z-30 border-b border-line bg-surface/90 backdrop-blur-md">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-5 py-3.5 sm:px-8">
        <div className="flex items-center gap-3">
          <div className="grid size-9 place-items-center rounded-xl bg-ink text-white shadow-xs">
            <MozhiMark className="size-5" />
          </div>
          <div className="flex items-baseline gap-2">
            <p className="text-base font-bold tracking-tight text-ink">Mozhi</p>
            <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-subtle text-muted-ink border border-line">மொழி</span>
            <span className="text-xs text-muted-ink hidden sm:inline">• Extension Settings</span>
          </div>
        </div>
        <p className="hidden items-center gap-2 text-xs font-mono text-muted-ink sm:flex">
          <Icon name="shield" className="size-3.5 text-indigo" />
          Preferences stay in this browser
        </p>
      </div>
    </header>

    <main className="mx-auto grid max-w-7xl gap-8 px-5 pb-16 pt-8 sm:px-8 sm:pt-10 lg:grid-cols-[16rem_minmax(0,1fr)] lg:gap-12">
      <aside className="lg:sticky lg:top-24 lg:self-start">
        <p className="mb-1 text-[10px] font-mono font-semibold tracking-wider uppercase text-indigo">Configuration</p>
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-ink">Settings</h1>
        <p className="mt-2 max-w-xs text-xs leading-relaxed text-muted-ink">
          Choose how prompts are refined and what Mozhi keeps on this device.
        </p>
        <nav aria-label="Settings sections" className="mt-6 flex gap-1.5 overflow-x-auto pb-1 mozhi-scrollbar lg:flex-col lg:overflow-visible lg:pb-0">
          {NAV_ITEMS.map((item) => {
            const isActive = activeSection === item.id;
            return (
              <a
                key={item.id}
                href={`#${item.id}`}
                onClick={(e) => handleNavClick(e, item.id)}
                aria-current={isActive ? 'location' : undefined}
                className={`group relative flex min-h-10 shrink-0 items-center justify-between rounded-xl px-3.5 py-2 text-xs transition-all duration-200 outline-none focus-visible:ring-2 focus-visible:ring-indigo ${
                  isActive
                    ? 'bg-ink font-semibold text-white shadow-xs'
                    : 'bg-transparent font-medium text-muted-ink hover:bg-surface hover:text-ink'
                }`}
              >
                <span className="flex items-center gap-2">
                  <span
                    className={`h-3.5 w-1 rounded-full transition-all duration-200 ${
                      isActive ? 'bg-indigo' : 'bg-transparent group-hover:bg-line'
                    }`}
                  />
                  <span>{item.label}</span>
                </span>
                {isActive && (
                  <span className="size-1.5 rounded-full bg-emerald animate-pulse hidden lg:inline-block" />
                )}
              </a>
            );
          })}
        </nav>
        <div className="mt-8 hidden rounded-2xl bg-subtle p-4 border border-line text-xs lg:block">
          <div className="flex items-center gap-2 font-semibold text-ink">
            <Icon name="shield" className="size-4 text-indigo" />
            Local by default
          </div>
          <p className="mt-1.5 text-xs leading-relaxed text-muted-ink">
            Mozhi will not change providers in the background. Your selection stays in your control.
          </p>
        </div>
      </aside>

      <form onSubmit={save} className="min-w-0 space-y-8">
        <section id="processing" aria-labelledby="processing-title" className="scroll-mt-24">
          <div className="mb-3">
            <p className="text-[10px] font-mono font-semibold tracking-wider text-indigo uppercase">01 / Processing Engine</p>
            <h2 id="processing-title" className="text-lg font-bold tracking-tight text-ink">Choose a provider</h2>
          </div>
          <div className="doppelrand-shell p-1.5 sm:p-2">
            <div className="doppelrand-core p-5 sm:p-7">
              <p className="mb-5 max-w-2xl text-xs sm:text-sm leading-relaxed text-muted-ink">
                The selected provider is always visible in the popup. Mozhi never switches providers automatically.
              </p>
              <ProviderSelector value={settings.provider} onChange={(provider) => updateSettings({ ...settings, provider })} />
              {settings.provider === 'openai-compatible' && (
                <div className="mt-6 space-y-5 border-t border-line-subtle pt-5">
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-ink" htmlFor="base-url">Endpoint URL</label>
                    <input
                      id="base-url"
                      type="url"
                      value={settings.onlineBaseUrl}
                      onChange={(event) => updateSettings({ ...settings, onlineBaseUrl: event.target.value })}
                      placeholder="https://api.example.com/v1"
                      autoComplete="url"
                      className="min-h-11 w-full rounded-xl border border-line bg-surface px-3.5 text-xs text-ink outline-none transition focus:border-indigo focus:ring-1 focus:ring-indigo"
                    />
                    <p className="mt-1 text-[11px] leading-normal text-muted-ink">Use the provider&apos;s HTTPS API base URL, such as https://api.example.com/v1.</p>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-ink" htmlFor="model">Model name</label>
                    <input
                      id="model"
                      value={settings.onlineModel}
                      onChange={(event) => updateSettings({ ...settings, onlineModel: event.target.value })}
                      placeholder="your-model-name"
                      autoComplete="off"
                      className="min-h-11 w-full rounded-xl border border-line bg-surface px-3.5 text-xs text-ink outline-none transition focus:border-indigo focus:ring-1 focus:ring-indigo"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-ink" htmlFor="api-key">API key</label>
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <input
                        id="api-key"
                        type="password"
                        value={apiKeyDraft}
                        onChange={(event) => setApiKeyDraft(event.target.value)}
                        placeholder={hasApiKey ? 'A key is saved — enter a new key to replace it' : 'Paste your provider API key'}
                        autoComplete="new-password"
                        className="min-h-11 min-w-0 flex-1 rounded-xl border border-line bg-surface px-3.5 text-xs text-ink outline-none transition focus:border-indigo focus:ring-1 focus:ring-indigo"
                      />
                      <button
                        type="button"
                        onClick={saveKey}
                        disabled={!apiKeyDraft.trim()}
                        className="min-h-11 rounded-xl bg-ink px-4 text-xs font-semibold text-white transition hover:bg-black disabled:cursor-not-allowed disabled:opacity-45"
                      >
                        Save key
                      </button>
                    </div>
                    <p className="mt-1 text-[11px] leading-normal text-muted-ink">{hasApiKey ? 'An API key is stored in this extension.' : 'No API key is saved.'}</p>
                  </div>
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center gap-3">
                      <button
                        type="button"
                        onClick={testConnection}
                        disabled={connectionStatus === 'testing' || !settings.onlineBaseUrl || !settings.onlineModel || !hasApiKey}
                        className="min-h-10 rounded-xl border border-indigo px-4 text-xs font-semibold text-indigo transition hover:bg-indigo-soft disabled:cursor-not-allowed disabled:opacity-45"
                      >
                        {connectionStatus === 'testing' ? 'Testing…' : 'Test connection'}
                      </button>
                      {connectionStatus === 'connected' && (
                        <span aria-live="polite" className="inline-flex items-center gap-1.5 rounded-lg border border-emerald/25 bg-emerald-soft px-3 py-1.5 text-xs font-semibold text-emerald-800">
                          <Icon name="check" className="size-3.5 text-emerald-700" />
                          {connectionMessage || 'Connection successful'}
                        </span>
                      )}
                      {hasApiKey && (
                        <button type="button" onClick={removeKey} className="min-h-10 rounded-xl px-3 text-xs font-semibold text-danger transition hover:bg-danger-soft sm:ml-auto">
                          Remove API key
                        </button>
                      )}
                    </div>
                    {connectionStatus === 'error' && (
                      <div role="alert" aria-live="assertive" className="flex items-start gap-2 rounded-xl border border-danger/25 bg-danger-soft p-3 text-xs text-danger">
                        <Icon name="x" className="mt-0.5 size-4 shrink-0 text-danger" />
                        <div className="min-w-0 flex-1 leading-relaxed">
                          <strong className="block font-semibold">Connection failed:</strong>
                          <span>{connectionMessage || 'Could not connect to the endpoint.'}</span>
                        </div>
                      </div>
                    )}
                  </div>
                  <p className="rounded-xl border border-indigo/20 bg-indigo-soft/60 px-4 py-3 text-xs leading-relaxed text-indigo-950">
                    <strong>Credential storage:</strong> The API key stays in Chrome extension storage and is sent only to the configured endpoint when you choose Online and enhance. Chrome does not encrypt this storage, so someone with access to your browser profile may be able to read it.
                  </p>
                </div>
              )}
            </div>
          </div>
        </section>

        <section id="mode-guide" aria-labelledby="mode-guide-title" className="scroll-mt-24">
          <div className="mb-3">
            <p className="text-[10px] font-mono font-semibold tracking-wider text-indigo uppercase">02 / Transformation Guide</p>
            <h2 id="mode-guide-title" className="text-lg font-bold tracking-tight text-ink">Mozhi Mode Transformation Guide</h2>
          </div>
          <div className="doppelrand-shell p-1.5 sm:p-2">
            <div className="doppelrand-core p-5 sm:p-7 space-y-5">
              <p className="max-w-3xl text-xs sm:text-sm leading-relaxed text-muted-ink">
                Mozhi offers four calibrated enhancement modes. Each has a distinct, predictable level of transformation that preserves your intended meaning and facts without fabricating context or altering technical identifiers.
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {modes.map((modeKey) => {
                  const def = modeDefinitions[modeKey];
                  return (
                    <div key={modeKey} className="p-4 rounded-xl border border-line bg-canvas/60 flex flex-col gap-2.5">
                      <div className="flex items-center justify-between">
                        <h3 className="text-sm font-bold text-ink">{def.name}</h3>
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-subtle text-muted-ink border border-line font-semibold">
                          {def.badge}
                        </span>
                      </div>
                      <p className="text-xs text-ink font-medium leading-normal">
                        {def.tagline}
                      </p>
                      <p className="text-xs text-muted-ink leading-relaxed">
                        {def.description}
                      </p>
                      <ul className="mt-1 space-y-1 text-xs text-muted-ink list-disc list-inside">
                        {def.characteristics.map((char, i) => (
                          <li key={i}>{char}</li>
                        ))}
                      </ul>
                      {def.disclaimer && (
                        <div className="mt-2 p-2.5 rounded-lg bg-indigo-soft/60 border border-indigo/20 text-xs text-indigo-950 font-medium">
                          <span className="font-semibold">Note:</span> {def.disclaimer}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </section>

        <section id="local-model" aria-labelledby="local-model-title" className="scroll-mt-24">
          <div className="mb-3">
            <p className="text-[10px] font-mono font-semibold tracking-wider text-indigo uppercase">03 / On-Device Model</p>
            <h2 id="local-model-title" className="text-lg font-bold tracking-tight text-ink">Local model</h2>
          </div>
          <div className="doppelrand-shell p-1.5 sm:p-2">
            <div className="doppelrand-core p-5 sm:p-7">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <h3 className="text-base font-semibold text-ink">{localModel.label}</h3>
                    <span className="text-[11px] font-mono px-1.5 py-0.5 rounded bg-subtle text-muted-ink border border-line">{localModel.license}</span>
                  </div>
                  <p className="mt-1 break-all text-xs font-mono text-faint">{settings.localModelId || localModel.id}</p>
                  <p className="mt-3 max-w-2xl text-xs sm:text-sm leading-relaxed text-muted-ink">
                    First download needs an internet connection and stores model files in this browser. About {localModel.approximateDownloadMb} MB with WebGPU or {localModel.approximateWasmDownloadMb} MB with WASM. Prompts are processed locally; nothing downloads until you choose Download model.
                  </p>
                </div>
                <div className="flex min-w-[9rem] items-center gap-2 rounded-xl bg-subtle border border-line px-3 py-2" aria-live="polite">
                  <span className={`size-2 shrink-0 rounded-full ${localModelState.status === 'ready' ? 'bg-emerald animate-pulse' : localModelState.status === 'error' ? 'bg-danger' : localModelState.status === 'downloading' ? 'animate-pulse bg-orange' : 'bg-muted-ink/40'}`} />
                  <span className="text-xs font-semibold text-ink">{modelStatusChecked ? localModelStatusLabel(localModelState) : 'Checking status…'}</span>
                </div>
              </div>

              {localModelState.status === 'downloading' && (
                <div className="mt-5 p-4 rounded-xl bg-subtle border border-line">
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs text-muted-ink">{localModelState.message || 'Downloading model files…'}</p>
                    {typeof localModelState.progress === 'number' && (
                      <span className="text-xs font-mono tabular-nums text-muted-ink">
                        {localModelState.file ? `${localModelState.file} · current file` : 'Current file'} · {Math.round(localModelState.progress)}%
                      </span>
                    )}
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-line" role="progressbar" aria-label="Current model file download progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={typeof localModelState.progress === 'number' ? Math.round(localModelState.progress) : undefined} aria-valuetext={`${localModelState.message || 'Downloading model files'}${localModelState.file ? `: ${localModelState.file}` : ''}`}>
                    <div className="h-full rounded-full bg-indigo transition-[width] duration-200" style={{ width: `${Math.max(8, Math.min(100, localModelState.progress ?? 8))}%` }} />
                  </div>
                </div>
              )}

              {localModelState.status === 'interrupted' && <p className="mt-4 text-xs leading-normal text-orange" role="status">{localModelState.message || 'Download interrupted. Start it again to resume missing files.'}</p>}
              {localModelState.status === 'error' && <p className="mt-4 text-xs leading-normal text-danger" role="alert">{localModelState.message || 'Download failed. Check your connection and try again.'}</p>}
              {modelNotice && <p className="mt-4 text-xs leading-normal text-muted-ink" role="status">{modelNotice}</p>}

              <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-line-subtle pt-5">
                {localModelState.status === 'ready' || localModelState.status === 'downloaded' ? (
                  <>
                    <button
                      type="button"
                      onClick={() => setConfirmDeleteModel(true)}
                      disabled={modelBusy || !modelStatusChecked}
                      className="min-h-10 rounded-xl border border-danger/30 px-4 text-xs font-semibold text-danger transition hover:bg-danger-soft disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {modelBusy ? 'Working…' : 'Delete downloaded model'}
                    </button>
                    {localModelState.status === 'downloaded' ? (
                      <button
                        type="button"
                        onClick={() => void testLocalInference()}
                        disabled={modelBusy || diagnosticsRunning || !modelStatusChecked}
                        className="min-h-10 rounded-xl bg-ink px-4 text-xs font-semibold text-white transition hover:bg-black disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {modelBusy ? 'Testing…' : 'Test local inference'}
                      </button>
                    ) : (
                      localModelState.backends?.includes('webgpu') && !localModelState.backends.includes('wasm') && (
                        <button
                          type="button"
                          onClick={() => void downloadLocalModel('wasm')}
                          disabled={modelBusy || !modelStatusChecked}
                          className="min-h-10 rounded-xl border border-line px-4 text-xs font-semibold text-ink transition hover:bg-subtle disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          Download WASM fallback · ~{localModel.approximateWasmDownloadMb} MB
                        </button>
                      )
                    )}
                  </>
                ) : localModelState.status === 'downloading' ? (
                  modelAbort.current ? (
                    <button type="button" onClick={cancelModelDownload} className="min-h-10 rounded-xl border border-danger/30 px-4 text-xs font-semibold text-danger transition hover:bg-danger-soft">
                      Cancel download
                    </button>
                  ) : (
                    <button type="button" disabled className="min-h-10 rounded-xl border border-line px-4 text-xs font-semibold text-muted-ink disabled:opacity-70">
                      Downloading in another Settings tab
                    </button>
                  )
                ) : (
                  <button
                    type="button"
                    onClick={() => void downloadLocalModel()}
                    disabled={modelBusy || !modelStatusChecked}
                    className="min-h-10 rounded-xl bg-ink px-4 text-xs font-semibold text-white transition hover:bg-black disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {!modelStatusChecked ? 'Checking model…' : modelBusy ? 'Preparing download…' : localModelState.status === 'interrupted' || localModelState.status === 'error' ? 'Retry download' : 'Download model'}
                  </button>
                )}
                {localModelState.status === 'downloaded' && localModelState.backends?.includes('webgpu') && !localModelState.backends.includes('wasm') && (
                  <button
                    type="button"
                    onClick={() => void downloadLocalModel('wasm')}
                    disabled={modelBusy || diagnosticsRunning || !modelStatusChecked}
                    className="min-h-10 rounded-xl border border-line px-4 text-xs font-semibold text-ink transition hover:bg-subtle disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Download WASM fallback · ~{localModel.approximateWasmDownloadMb} MB
                  </button>
                )}
                {localModelState.status === 'ready' && (
                  <>
                    <button
                      type="button"
                      onClick={() => void testLocalInference()}
                      disabled={modelBusy || diagnosticsRunning || !modelStatusChecked}
                      className="min-h-10 rounded-xl border border-indigo px-4 text-xs font-semibold text-indigo transition hover:bg-indigo-soft disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {modelBusy ? 'Testing…' : 'Test local inference'}
                    </button>
                    <p className="text-xs text-muted-ink">Verified for {localModelState.verifiedBackends?.join(' and ') || localModelState.backend}.</p>
                  </>
                )}
              </div>

              {confirmDeleteModel && (
                <div role="group" aria-labelledby="delete-model-title" className="mt-4 rounded-xl border border-danger/25 bg-danger-soft p-4">
                  <h4 id="delete-model-title" className="text-xs font-semibold text-danger">Remove the downloaded model?</h4>
                  <p className="mt-1 text-xs leading-normal text-danger">This removes Mozhi’s cached model files. Your settings, prompts, and API key stay unchanged.</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button type="button" onClick={() => void deleteLocalModel()} disabled={modelBusy} className="min-h-9 rounded-lg bg-danger px-3 text-xs font-semibold text-white transition hover:bg-red-800 disabled:opacity-50">
                      Remove model
                    </button>
                    <button type="button" onClick={() => setConfirmDeleteModel(false)} className="min-h-9 rounded-lg border border-line bg-surface px-3 text-xs font-semibold text-ink transition hover:bg-subtle">
                      Keep model
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </section>

        <section id="local-diagnostics" aria-labelledby="local-diagnostics-title" className="scroll-mt-24">
          <div className="mb-3">
            <p className="text-[10px] font-mono font-semibold tracking-wider text-indigo uppercase">04 / Troubleshooting</p>
            <h2 id="local-diagnostics-title" className="text-lg font-bold tracking-tight text-ink">Local Model Diagnostics</h2>
          </div>
          <div className="doppelrand-shell p-1.5 sm:p-2">
            <div className="doppelrand-core p-5 sm:p-7">
              <p className="max-w-3xl text-xs sm:text-sm leading-relaxed text-muted-ink">
                Checks run inside Mozhi’s inference worker. Browser capability checks do not download model files or prove that the model can generate text; use the separate inference test after model files are available.
              </p>
              <div className="mt-5 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => void runLocalDiagnostics()}
                  disabled={diagnosticsRunning || modelBusy}
                  className="min-h-10 rounded-xl bg-ink px-4 text-xs font-semibold text-white transition hover:bg-black disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {diagnosticsRunning ? 'Running diagnostics…' : 'Run Diagnostics'}
                </button>
                {diagnosticReport && (
                  <button type="button" onClick={() => void copyDiagnosticReport()} className="min-h-10 rounded-xl border border-line px-4 text-xs font-semibold text-ink transition hover:bg-subtle">
                    {reportCopied ? 'Report copied' : 'Copy report'}
                  </button>
                )}
                {diagnosticsRunning && diagnosticProgress && (
                  <span className="text-xs text-muted-ink font-mono" role="status" aria-live="polite" aria-atomic="true">
                    Check {diagnosticProgress.completed}/{diagnosticProgress.total}: {diagnosticProgress.check.status} — {diagnosticProgress.check.label}
                  </span>
                )}
              </div>
              {(diagnosticReport || diagnosticsRunning) && (
                <div className="mt-5 space-y-4">
                  {diagnosticReport && (
                    <>
                      <div className="grid gap-2 rounded-xl bg-subtle border border-line p-3 text-xs font-mono text-muted-ink sm:grid-cols-2">
                        <p><strong className="text-ink">Browser:</strong> {diagnosticReport.browser}</p>
                        <p><strong className="text-ink">Runtime:</strong> {diagnosticReport.runtime ?? 'Not identified'}</p>
                        <p><strong className="text-ink">Model:</strong> {diagnosticReport.modelId}</p>
                        <p className="sm:col-span-2"><strong className="text-ink">Revision:</strong> {diagnosticReport.modelRevision}</p>
                      </div>
                      {primaryDiagnosticIssue && (
                        <div role={primaryDiagnosticIssue.status === 'FAIL' ? 'alert' : 'status'} className={`rounded-xl p-3 text-xs ${primaryDiagnosticIssue.status === 'FAIL' ? 'border border-danger/25 bg-danger-soft text-danger' : 'bg-orange/10 text-ink'}`}>
                          <p className="font-semibold">{primaryDiagnosticIssue.status === 'FAIL' ? 'First failure' : 'First unavailable capability'}</p>
                          <p className="mt-1">{primaryDiagnosticIssue.label}: {primaryDiagnosticIssue.detail}</p>
                          <p className="mt-2 text-[11px] leading-normal">{diagnosticRecommendation(diagnosticReport)}</p>
                        </div>
                      )}
                      {!diagnosticReport.checks.some((check) => check.status === 'FAIL' || check.status === 'UNAVAILABLE') && (
                        <p className="rounded-xl border border-emerald/20 bg-emerald-soft p-3 text-xs leading-relaxed text-emerald-900 font-medium">
                          {diagnosticRecommendation(diagnosticReport)}
                        </p>
                      )}
                    </>
                  )}
                  <ul className="divide-y divide-line rounded-xl border border-line overflow-hidden" aria-label="Diagnostic check results">
                    {(diagnosticsRunning ? diagnosticChecks : diagnosticReport?.checks ?? []).map((check) => (
                      <li key={check.id} className="flex flex-col gap-1 px-3 py-2.5 sm:flex-row sm:items-start sm:gap-3 bg-surface">
                        <span className={`mt-0.5 w-24 shrink-0 text-xs font-mono font-bold ${diagnosticStatusClass(check.status)}`}>{check.status}</span>
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-semibold text-ink">{check.label}{check.backend ? ` · ${check.backend}` : ''}</p>
                          <p className="break-words text-[11px] leading-normal text-muted-ink">{check.detail}{typeof check.durationMs === 'number' ? ` (${check.durationMs} ms)` : ''}</p>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {diagnosticsRunning && !diagnosticChecks.length && <p className="mt-4 text-xs text-muted-ink" role="status">Starting the extension inference worker…</p>}
            </div>
          </div>
        </section>

        <section id="api-logs" aria-labelledby="api-logs-title" className="scroll-mt-24">
          <div className="mb-3">
            <p className="text-[10px] font-mono font-semibold tracking-wider text-indigo uppercase">05 / API Error Logs</p>
            <h2 id="api-logs-title" className="text-lg font-bold tracking-tight text-ink">API Error Logs</h2>
          </div>
          <div className="doppelrand-shell p-1.5 sm:p-2">
            <div className="doppelrand-core p-5 sm:p-7">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <p className="max-w-2xl text-xs sm:text-sm leading-relaxed text-muted-ink">
                  Sanitized diagnostic records captured when online model requests fail. No API keys, prompts, or sensitive credentials are ever stored.
                </p>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-subtle border border-line text-muted-ink">
                    {apiLogs.length} / 50 stored
                  </span>
                </div>
              </div>

              {/* Action Bar */}
              <div className="mt-5 flex flex-wrap items-center gap-2.5">
                <button
                  type="button"
                  onClick={() => setConfirmClearLogs(true)}
                  disabled={clearingLogs || apiLogs.length === 0}
                  className="min-h-9 rounded-xl border border-danger/30 px-3.5 text-xs font-semibold text-danger transition hover:bg-danger-soft disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Clear Logs
                </button>
                <button
                  type="button"
                  onClick={() => void copyApiDiagnosticReport(filteredApiLogs)}
                  disabled={filteredApiLogs.length === 0}
                  className="min-h-9 rounded-xl border border-line px-3.5 text-xs font-semibold text-ink transition hover:bg-subtle disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {logsReportCopied ? 'Report copied' : 'Copy report'}
                </button>
                <button
                  type="button"
                  onClick={() => exportApiLogsJson(filteredApiLogs)}
                  disabled={filteredApiLogs.length === 0}
                  className="min-h-9 rounded-xl border border-line px-3.5 text-xs font-semibold text-ink transition hover:bg-subtle disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Export JSON
                </button>
              </div>

              {/* Clear Confirmation Prompt */}
              {confirmClearLogs && (
                <div role="group" aria-labelledby="clear-logs-title" className="mt-4 rounded-xl border border-danger/25 bg-danger-soft p-4">
                  <h4 id="clear-logs-title" className="text-xs font-semibold text-danger">Permanently clear diagnostic logs?</h4>
                  <p className="mt-1 text-xs leading-normal text-danger">
                    This permanently deletes all stored API failure entries and diagnostic records from this browser profile. Your provider settings, API keys, and model preferences stay unchanged.
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => void handleClearLogs()}
                      disabled={clearingLogs}
                      className="min-h-9 rounded-lg bg-danger px-3 text-xs font-semibold text-white transition hover:bg-red-800 disabled:opacity-50"
                    >
                      {clearingLogs ? 'Clearing…' : 'Clear logs'}
                    </button>
                    <button
                      type="button"
                      autoFocus
                      onClick={() => setConfirmClearLogs(false)}
                      disabled={clearingLogs}
                      className="min-h-9 rounded-lg border border-line bg-surface px-3 text-xs font-semibold text-ink transition hover:bg-subtle"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {/* Status Notices */}
              {apiLogsNotice && (
                <p role="status" aria-live="polite" className="mt-3 rounded-xl border border-emerald/20 bg-emerald-soft p-3 text-xs text-emerald-900 font-medium">
                  {apiLogsNotice}
                </p>
              )}
              {apiLogsError && (
                <p role="alert" className="mt-3 rounded-xl border border-danger/25 bg-danger-soft p-3 text-xs text-danger font-medium">
                  {apiLogsError}
                </p>
              )}

              {/* Filters */}
              {apiLogs.length > 0 && (
                <div className="mt-5 grid gap-2.5 rounded-xl border border-line bg-subtle p-3 sm:grid-cols-[1fr_auto_auto]">
                  <input
                    type="search"
                    placeholder="Search logs by error, model, or correlation ID…"
                    value={logSearchQuery}
                    onChange={(e) => setLogSearchQuery(e.target.value)}
                    className="min-h-9 w-full rounded-lg border border-line bg-surface px-3 text-xs text-ink placeholder:text-muted-ink/60 focus:border-indigo focus:outline-none"
                    aria-label="Filter error logs by text"
                  />
                  <select
                    value={logSeverityFilter}
                    onChange={(e) => setLogSeverityFilter(e.target.value as typeof logSeverityFilter)}
                    className="min-h-9 rounded-lg border border-line bg-surface px-3 text-xs text-ink focus:border-indigo focus:outline-none"
                    aria-label="Filter logs by severity"
                  >
                    <option value="all">All severities</option>
                    <option value="critical">Critical</option>
                    <option value="error">Error</option>
                    <option value="warning">Warning</option>
                  </select>
                  <select
                    value={logStageFilter}
                    onChange={(e) => setLogStageFilter(e.target.value)}
                    className="min-h-9 rounded-lg border border-line bg-surface px-3 text-xs text-ink focus:border-indigo focus:outline-none"
                    aria-label="Filter logs by stage"
                  >
                    <option value="all">All stages</option>
                    <option value="http">HTTP</option>
                    <option value="transport">Transport</option>
                    <option value="parsing">Parsing</option>
                    <option value="output_validation">Output validation</option>
                    <option value="preparation">Preparation</option>
                    <option value="streaming">Streaming</option>
                    <option value="unknown">Unknown</option>
                  </select>
                </div>
              )}

              {/* List / States */}
              <div className="mt-5">
                {apiLogsLoading ? (
                  <p className="text-xs text-muted-ink" role="status">Loading diagnostic logs…</p>
                ) : apiLogs.length === 0 ? (
                  <div className="rounded-xl border border-line/60 bg-subtle/50 p-6 text-center">
                    <p className="text-xs font-semibold text-ink">No API errors recorded</p>
                    <p className="mt-1 text-xs text-muted-ink">
                      Failed online model operations will automatically capture sanitized diagnostic evidence here for troubleshooting.
                    </p>
                  </div>
                ) : filteredApiLogs.length === 0 ? (
                  <div className="rounded-xl border border-line/60 bg-subtle/50 p-6 text-center">
                    <p className="text-xs font-semibold text-ink">No logs match your filter</p>
                    <p className="mt-1 text-xs text-muted-ink">Try adjusting your search terms or filter selections.</p>
                    <button
                      type="button"
                      onClick={() => {
                        setLogSeverityFilter('all');
                        setLogStageFilter('all');
                        setLogSearchQuery('');
                      }}
                      className="mt-3 inline-flex min-h-8 items-center rounded-lg border border-line bg-surface px-3 text-xs font-medium text-ink transition hover:bg-subtle"
                    >
                      Reset filters
                    </button>
                  </div>
                ) : (
                  <ul className="divide-y divide-line rounded-xl border border-line overflow-hidden" aria-label="API Error Log Entries">
                    {filteredApiLogs.map((entry) => {
                      const isExpanded = expandedLogId === entry.id;
                      const formattedDate = new Date(entry.timestamp).toLocaleString();
                      return (
                        <li key={entry.id} className="bg-surface transition">
                          <div
                            tabIndex={0}
                            role="button"
                            aria-expanded={isExpanded}
                            onClick={() => setExpandedLogId(isExpanded ? null : entry.id)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                setExpandedLogId(isExpanded ? null : entry.id);
                              }
                            }}
                            className="flex cursor-pointer flex-col gap-2 p-3.5 sm:flex-row sm:items-start sm:justify-between hover:bg-subtle/40"
                          >
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-1.5">
                                <span className={`rounded px-1.5 py-0.5 text-[10px] font-mono font-bold uppercase ${severityBadgeClass(entry.severity)}`}>
                                  {entry.severity}
                                </span>
                                <span className={`rounded border px-1.5 py-0.5 text-[10px] font-mono font-semibold uppercase ${stageBadgeClass(entry.stage)}`}>
                                  {entry.stage}
                                </span>
                                {entry.httpStatus && (
                                  <span className="rounded border border-indigo/20 bg-indigo-soft px-1.5 py-0.5 text-[10px] font-mono font-bold text-indigo">
                                    HTTP {entry.httpStatus}
                                  </span>
                                )}
                                <span className="text-[10px] font-mono text-muted-ink">
                                  {entry.provider} · {entry.model}
                                </span>
                                <span className="ml-auto text-[10px] font-mono text-muted-ink">
                                  {formattedDate}
                                </span>
                              </div>
                              <p className="mt-2 text-xs font-medium text-ink break-words">
                                <strong className="text-danger font-semibold">{entry.errorName}:</strong> {entry.errorMessage}
                              </p>
                            </div>
                            <div className="shrink-0 self-end sm:self-center">
                              <span className="text-[11px] font-mono text-indigo hover:underline">
                                {isExpanded ? 'Hide details' : 'Details'}
                              </span>
                            </div>
                          </div>

                          {isExpanded && (
                            <div className="border-t border-line/60 bg-subtle/40 p-4 text-xs font-mono">
                              <div className="grid gap-2 text-muted-ink sm:grid-cols-2">
                                <p><strong className="text-ink">Correlation ID:</strong> {entry.correlationId}</p>
                                <p><strong className="text-ink">Operation:</strong> {entry.operation}</p>
                                <p><strong className="text-ink">Category:</strong> {entry.category}</p>
                                <p><strong className="text-ink">Duration:</strong> {entry.durationMs} ms</p>
                                <p><strong className="text-ink">Retries:</strong> {entry.retryCount}</p>
                                <p><strong className="text-ink">Endpoint:</strong> {entry.endpointOrigin || 'N/A'}{entry.endpointPath || ''}</p>
                                {entry.httpStatusText && (
                                  <p><strong className="text-ink">Status text:</strong> {entry.httpStatusText}</p>
                                )}
                                {entry.errorCode && (
                                  <p><strong className="text-ink">Safe code:</strong> {entry.errorCode}</p>
                                )}
                              </div>
                              <div className="mt-3 flex justify-end gap-2">
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    void copyApiDiagnosticReport([entry]);
                                  }}
                                  className="min-h-7 rounded-md border border-line bg-surface px-2.5 text-[11px] font-sans font-medium text-ink transition hover:bg-subtle"
                                >
                                  Copy entry
                                </button>
                              </div>
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>

              {/* Privacy Footer */}
              <p className="mt-5 text-[11px] leading-relaxed text-muted-ink/80 border-t border-line-subtle pt-4">
                <strong>Privacy guarantee:</strong> Mozhi sanitizes all diagnostic logs locally before storage and before export. Secrets, authorization headers, raw prompt contents, and URL query parameters are scrubbed automatically. Logs remain strictly on this device and are never transmitted remotely.
              </p>
            </div>
          </div>
        </section>

        <section id="permissions" aria-labelledby="permissions-title" className="scroll-mt-24">
          <div className="mb-3">
            <p className="text-[10px] font-mono font-semibold tracking-wider text-indigo uppercase">06 / Security & Transparency</p>
            <h2 id="permissions-title" className="text-lg font-bold tracking-tight text-ink">Permissions & Site Access</h2>
          </div>
          <div className="doppelrand-shell p-1.5 sm:p-2">
            <div className="doppelrand-core p-5 sm:p-7 space-y-6">
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wider text-ink">Why Mozhi requests website access</h3>
                <p className="mt-1.5 max-w-3xl text-xs sm:text-sm leading-relaxed text-muted-ink">
                  Mozhi requests website access strictly to interact with text fields and insert refined text when you choose to use the extension (such as clicking <strong>Review &amp; Insert</strong> on ChatGPT). Mozhi uses Chrome’s <code className="rounded bg-subtle px-1.5 py-0.5 text-xs font-mono text-ink">activeTab</code> and <code className="rounded bg-subtle px-1.5 py-0.5 text-xs font-mono text-ink">scripting</code> permissions, which activate only on the single active tab when you explicitly trigger an action from the extension. Mozhi does not run persistent background scripts monitoring your browsing.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 border-t border-line-subtle pt-5">
                <div className="rounded-xl border border-line bg-canvas/60 p-4 flex flex-col gap-2.5">
                  <div className="flex items-center gap-2">
                    <span className="size-2 rounded-full bg-teal-deep" />
                    <h4 className="text-xs font-bold uppercase tracking-wider text-ink">Website Access (Local DOM)</h4>
                  </div>
                  <p className="text-xs text-muted-ink leading-relaxed">
                    Operates entirely inside your browser on your device. It locates the active prompt input field, verifies your draft, and types the refined text into the field.
                  </p>
                  <div className="mt-auto rounded-lg bg-teal-soft/60 border border-teal-deep/20 p-2.5 text-xs text-teal-deep font-medium">
                    Granting website access never uploads page content or sends webpage data to an AI model.
                  </div>
                </div>

                <div className="rounded-xl border border-line bg-canvas/60 p-4 flex flex-col gap-2.5">
                  <div className="flex items-center gap-2">
                    <span className="size-2 rounded-full bg-indigo" />
                    <h4 className="text-xs font-bold uppercase tracking-wider text-ink">Sending Text to AI (Inference)</h4>
                  </div>
                  <p className="text-xs text-muted-ink leading-relaxed">
                    Only the specific prompt you enter into Mozhi is enhanced. In <strong>Local Mode</strong>, text never leaves your device (processed by on-device WebGPU/WASM). In <strong>Online BYOK Mode</strong>, text is sent to your configured HTTPS provider only when you click <em>Enhance</em>.
                  </p>
                  <div className="mt-auto rounded-lg bg-indigo-soft/60 border border-indigo/20 p-2.5 text-xs text-indigo-950 font-medium">
                    Mozhi never sends full web pages, browsing history, cookies, or background tabs.
                  </div>
                </div>
              </div>

              <div className="border-t border-line-subtle pt-5 space-y-4">
                <div>
                  <h3 className="text-xs font-bold uppercase tracking-wider text-ink">Actual Configured Host Permissions</h3>
                  <p className="mt-1 text-xs text-muted-ink">
                    Drawn directly from Mozhi’s extension manifest and active browser profile as the single source of truth.
                  </p>
                </div>

                <div className="space-y-3">
                  <div className="rounded-xl border border-line bg-subtle/50 p-4">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-ink">Required Host Permissions</span>
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-soft text-emerald-800 border border-emerald/20 font-semibold">
                        {permissionsInfo?.requiredHostPermissions.length ?? 0} Required
                      </span>
                    </div>
                    {(!permissionsInfo?.requiredHostPermissions || permissionsInfo.requiredHostPermissions.length === 0) ? (
                      <p className="mt-2 text-xs text-muted-ink">
                        None. Mozhi requires zero permanent host permissions upon install. It cannot read, monitor, or modify web pages in the background.
                      </p>
                    ) : (
                      <ul className="mt-2 space-y-1 text-xs font-mono text-ink">
                        {permissionsInfo.requiredHostPermissions.map((host) => (
                          <li key={host} className="rounded bg-surface p-1.5 border border-line">{host}</li>
                        ))}
                      </ul>
                    )}
                  </div>

                  <div className="rounded-xl border border-line bg-subtle/50 p-4">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-ink">Configured Optional Host Permissions</span>
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-subtle text-muted-ink border border-line font-semibold">
                        Requested on-demand only
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-muted-ink">
                      These origins are declared as optional in the manifest and are requested only when you trigger an action requiring them:
                    </p>
                    <div className="mt-3 space-y-2">
                      {(permissionsInfo?.optionalHostPermissions ?? []).map((pattern) => (
                        <div key={pattern} className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 rounded-lg border border-line bg-surface p-2.5 text-xs">
                          <code className="font-mono font-semibold text-indigo break-all">{pattern}</code>
                          <span className="text-[11px] text-muted-ink">{describeHostPermissionPurpose(pattern)}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-xl border border-line bg-subtle/50 p-4">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-ink">Currently Granted Origins</span>
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-indigo-soft text-indigo-900 border border-indigo/20 font-semibold">
                        {permissionsInfo?.grantedOrigins.length ?? 0} Active
                      </span>
                    </div>
                    {(!permissionsInfo?.grantedOrigins || permissionsInfo.grantedOrigins.length === 0) ? (
                      <p className="mt-2 text-xs text-muted-ink">
                        No optional host origins are currently granted in this browser profile.
                      </p>
                    ) : (
                      <ul className="mt-2 space-y-1.5">
                        {permissionsInfo.grantedOrigins.map((origin) => (
                          <li key={origin} className="flex items-center justify-between rounded-lg bg-surface border border-line p-2 text-xs font-mono text-ink">
                            <span>{origin}</span>
                            <span className="text-[10px] font-sans text-emerald-700 bg-emerald-soft px-1.5 py-0.5 rounded border border-emerald/20 font-medium">Granted</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              </div>

              <div className="border-t border-line-subtle pt-5 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-ink">How to review or restrict site access</h3>
                  <button
                    type="button"
                    onClick={() => {
                      const extId = chrome.runtime?.id;
                      const url = extId ? `chrome://extensions/?id=${extId}` : 'chrome://extensions';
                      if (chrome.tabs?.create) {
                        void chrome.tabs.create({ url }).catch(() => {});
                      }
                    }}
                    className="inline-flex items-center gap-1 rounded-lg border border-line bg-surface px-3 py-1 text-xs font-medium text-ink transition hover:bg-subtle shadow-2xs"
                  >
                    <span>Manage in Chrome</span>
                    <Icon name="arrow" className="size-3" />
                  </button>
                </div>
                <p className="text-xs sm:text-sm text-muted-ink leading-relaxed">
                  You can review or revoke Mozhi’s site access at any time through Chrome’s native extension management:
                </p>
                <ol className="list-decimal list-inside space-y-1 text-xs text-muted-ink leading-normal pl-1">
                  <li>Navigate to <code className="rounded bg-subtle px-1.5 py-0.5 font-mono text-ink">chrome://extensions</code> in your browser.</li>
                  <li>Find <strong>Mozhi</strong> and click <strong>Details</strong>.</li>
                  <li>Under <strong>Site access</strong>, select your preferred rule (<em>On click</em>, <em>On specific sites</em>, or remove granted domains).</li>
                </ol>
                <div className="mt-2 rounded-xl border border-orange/30 bg-orange/10 p-3 text-xs leading-relaxed text-ink">
                  <strong className="font-semibold text-orange-950">Functionality note:</strong> Restricting site access to <em>On click</em> is fully supported. Note that if you remove or restrict access for a site (e.g., ChatGPT), Mozhi will be unable to directly insert refined prompts into text fields on that site. You can still refine your prompts inside the extension popup and use the <strong>Copy</strong> button to paste manually.
                </div>
              </div>
            </div>
          </div>
        </section>

        <section id="privacy" aria-labelledby="privacy-title" className="scroll-mt-24">
          <div className="mb-3">
            <p className="text-[10px] font-mono font-semibold tracking-wider text-indigo uppercase">07 / Privacy & Data</p>
            <h2 id="privacy-title" className="text-lg font-bold tracking-tight text-ink">Privacy & data</h2>
          </div>
          <div className="doppelrand-shell p-1.5 sm:p-2">
            <div className="doppelrand-core px-5 sm:px-7">
              <div className="py-5">
                <h3 className="text-xs font-bold uppercase tracking-wider text-ink">Where your prompt goes</h3>
                <p className="mt-1.5 max-w-3xl text-xs sm:text-sm leading-relaxed text-muted-ink">
                  Local mode never falls back to Online. If WebGPU cannot start, Mozhi retries on your device with WASM. Online mode sends a prompt only to your configured endpoint after you click Enhance. ChatGPT insertion is manual and never submits the prompt.
                </p>
              </div>
              <div className="border-t border-line-subtle py-5">
                <div className="flex flex-wrap items-start justify-between gap-5">
                  <div className="max-w-xl">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-ink">Saved data</h3>
                    <p className="mt-1.5 text-xs sm:text-sm leading-relaxed text-muted-ink">
                      Clear Mozhi preferences, the stored API key, your saved prompt and result, and downloaded local model files from this browser profile.
                    </p>
                  </div>
                  {!confirmClear && (
                    <button
                      type="button"
                      onClick={() => setConfirmClear(true)}
                      className="min-h-10 shrink-0 rounded-xl border border-danger/30 px-4 text-xs font-semibold text-danger transition hover:bg-danger-soft"
                    >
                      Clear saved data
                    </button>
                  )}
                </div>
                {confirmClear && (
                  <div role="group" aria-labelledby="clear-title" aria-describedby="clear-description" aria-live="assertive" className="mt-4 rounded-xl border border-danger/25 bg-danger-soft p-4">
                    <h4 id="clear-title" className="text-xs font-semibold text-danger">Clear all saved Mozhi data?</h4>
                    <p id="clear-description" className="mt-1 text-xs leading-normal text-danger">
                      This removes the API key, saved prompt and result, preferences, model status, and downloaded model from this browser profile. This cannot be undone.
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button type="button" onClick={() => void clearLocalData()} className="min-h-9 rounded-lg bg-danger px-3 text-xs font-semibold text-white transition hover:bg-red-800">
                        Clear data
                      </button>
                      <button type="button" autoFocus onClick={() => setConfirmClear(false)} className="min-h-9 rounded-lg border border-line bg-surface px-3 text-xs font-semibold text-ink transition hover:bg-subtle">
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>

        <section id="about" aria-labelledby="about-title" className="scroll-mt-24">
          <div className="mb-3">
            <p className="text-[10px] font-mono font-semibold tracking-wider text-indigo uppercase">08 / About</p>
            <h2 id="about-title" className="text-lg font-bold tracking-tight text-ink">About Mozhi</h2>
          </div>
          <div className="doppelrand-shell p-1.5 sm:p-2">
            <div className="doppelrand-core p-5 sm:p-7 space-y-5">
              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2">
                    <h3 className="text-base font-bold text-ink">Mozhi</h3>
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-subtle text-muted-ink border border-line font-semibold">
                      v{extensionVersion}
                    </span>
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-subtle text-muted-ink border border-line">
                      மொழி
                    </span>
                  </div>
                  <p className="text-xs sm:text-sm text-muted-ink leading-relaxed max-w-xl">
                    A local-first prompt enhancer that refines rough thoughts without silently changing where they are processed.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <a
                    href={creatorInfo.websiteUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex min-h-9 items-center gap-1.5 rounded-xl border border-line bg-surface px-3.5 text-xs font-semibold text-ink transition hover:bg-subtle shadow-2xs"
                  >
                    <span>Website</span>
                    <Icon name="arrow" className="size-3" />
                  </a>
                  <a
                    href={creatorInfo.githubUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex min-h-9 items-center gap-1.5 rounded-xl border border-line bg-surface px-3.5 text-xs font-semibold text-ink transition hover:bg-subtle shadow-2xs"
                  >
                    <span>GitHub</span>
                    <Icon name="arrow" className="size-3" />
                  </a>
                </div>
              </div>

              <div className="border-t border-line-subtle pt-4 text-xs text-muted-ink space-y-1.5">
                <p className="font-medium text-ink">
                  Created by <span className="font-semibold text-ink">{creatorInfo.name}</span> · {creatorInfo.role}.
                </p>
                <p className="leading-relaxed text-muted-ink italic">
                  “{creatorInfo.note}”
                </p>
              </div>
            </div>
          </div>
        </section>

        <div className="flex flex-wrap items-center justify-end gap-4 border-t border-line pt-5">
          <span aria-live="polite" className="text-xs font-medium text-emerald-700">{saved}</span>
          <button className="min-h-11 rounded-xl bg-ink px-6 text-xs font-semibold text-white shadow-xs transition hover:bg-black active:scale-[0.98]" type="submit">
            Save settings
          </button>
        </div>
        {error && <p role="alert" className="text-xs leading-normal text-danger">{error}</p>}
      </form>
    </main>
  </div>;
}

function localModelStatusLabel(state: LocalModelState): string {
  switch (state.status) {
    case 'ready': return 'Downloaded and ready';
    case 'downloaded': return 'Downloaded — verification needed';
    case 'downloading': return 'Downloading';
    case 'interrupted': return 'Download interrupted';
    case 'error': return 'Download failed';
    default: return 'Not downloaded';
  }
}

function browserLabelForSettings(): string {
  const agent = navigator.userAgent;
  const match = agent.match(/Edg\/([\d.]+)/) ?? agent.match(/(?:Chrome|Chromium)\/([\d.]+)/) ?? agent.match(/Firefox\/([\d.]+)/);
  const name = /Edg\//.test(agent) ? 'Microsoft Edge' : /Chrome|Chromium\//.test(agent) ? 'Chrome/Chromium' : /Firefox\//.test(agent) ? 'Firefox' : 'Unknown browser';
  return match ? `${name} ${match[1]} (settings page user agent)` : `${name} (version unavailable)`;
}

function diagnosticStatusClass(status: DiagnosticCheck['status']): string {
  if (status === 'PASS') return 'text-teal-deep';
  if (status === 'FAIL') return 'text-danger';
  if (status === 'UNAVAILABLE') return 'text-orange';
  return 'text-muted-ink';
}

function updateDiagnosticChecks(report: LocalDiagnosticReport, updates: DiagnosticCheck[]): LocalDiagnosticReport {
  const checks = [...report.checks];
  for (const update of updates) {
    const index = checks.findIndex((check) => check.id === update.id);
    if (index === -1) checks.push(update);
    else checks[index] = update;
  }
  return { ...report, checks };
}

function diagnosticActionMessage(cause: unknown): string {
  if (cause instanceof LocalModelWorkerError) {
    const detail = cause.diagnostic?.fallbackCategory ? '' : cause.diagnostic?.detail ? ` ${cause.diagnostic.detail}` : '';
    const code = cause.diagnostic ? ` (${localDiagnosticCode(cause.diagnostic)})` : '';
    return `${cause.message}${code}${detail}`;
  }
  return safeDiagnosticDetail(cause) || 'The local inference test failed.';
}

function severityBadgeClass(severity: ApiErrorLogEntry['severity']): string {
  if (severity === 'critical') return 'border border-danger/30 bg-danger-soft text-danger';
  if (severity === 'warning') return 'border border-orange/30 bg-orange/10 text-orange-800';
  return 'border border-danger/20 bg-danger-soft/60 text-danger';
}

function stageBadgeClass(stage: ApiErrorLogEntry['stage']): string {
  if (stage === 'http') return 'border-indigo/30 bg-indigo-soft text-indigo';
  if (stage === 'transport') return 'border-orange/30 bg-orange/10 text-orange-800';
  if (stage === 'parsing') return 'border-teal-deep/30 bg-teal-soft text-teal-deep';
  if (stage === 'output_validation') return 'border-line bg-subtle text-ink';
  if (stage === 'streaming') return 'border-indigo/30 bg-indigo-soft text-indigo';
  return 'border-line bg-subtle text-muted-ink';
}

createRoot(document.getElementById('root')!).render(<Options />);
