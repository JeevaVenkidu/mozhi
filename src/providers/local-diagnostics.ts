import type { LocalBackend } from './local-backend';
import { LocalGenerationOutputError } from './local-inference-smoke-test';

export type LocalFailureCategory =
  | 'unsupported-runtime'
  | 'webgpu-unavailable'
  | 'wasm-unavailable'
  | 'model-download-failed'
  | 'model-artifact-incompatible'
  | 'out-of-memory'
  | 'worker-initialization-failed'
  | 'extension-asset-error'
  | 'inference-failed';

export interface LocalModelDiagnostic {
  category: LocalFailureCategory;
  stage?: 'initialization' | 'inference';
  fallbackStage?: 'initialization' | 'inference';
  backend?: LocalBackend;
  fallbackCategory?: LocalFailureCategory;
  detail?: string;
  primaryDetail?: string;
  fallbackDetail?: string;
  runtime?: string;
  modelId?: string;
  modelRevision?: string;
}

export type DiagnosticStatus = 'PASS' | 'FAIL' | 'UNAVAILABLE' | 'NOT TESTED';

export interface DiagnosticCheck {
  id: string;
  label: string;
  status: DiagnosticStatus;
  detail: string;
  backend?: LocalBackend;
  durationMs?: number;
}

export interface LocalDiagnosticReport {
  generatedAt: string;
  browser: string;
  runtime?: string;
  modelId: string;
  modelRevision: string;
  checks: DiagnosticCheck[];
}

export interface LocalDiagnosticProbes {
  browser: string;
  runtime?: string;
  webGpuApiAvailable: boolean;
  requestGpuAdapter(): Promise<unknown | null>;
  createGpuDevice(adapter: unknown): Promise<unknown>;
  runGpuCompute(device: unknown): Promise<void>;
  webAssemblyAvailable: boolean;
  runWasmSmoke(): Promise<void>;
  checkExtensionAssets(): Promise<string>;
  inspectModelArtifacts(): Promise<Partial<Record<LocalBackend, { cached: boolean; incomplete?: boolean; compatible?: boolean; detail: string }>>>;
}

export interface DiagnosticProgress {
  completed: number;
  total: number;
  check: DiagnosticCheck;
}

export function selectDiagnosticBackend(report: LocalDiagnosticReport, available: LocalBackend[]): LocalBackend | null {
  const status = new Map(report.checks.map((check) => [check.id, check.status]));
  if (available.includes('webgpu') && status.get('webgpu-compute') === 'PASS' && status.get('webgpu-compatibility') === 'PASS') return 'webgpu';
  if (available.includes('wasm') && status.get('wasm-execute') === 'PASS' && status.get('wasm-compatibility') === 'PASS') return 'wasm';
  return null;
}

export function diagnosticRecommendation(report: LocalDiagnosticReport): string {
  const inference = report.checks.find((check) => check.id === 'model-inference');
  if (inference?.status === 'FAIL') {
    if (/failed the fixed grammar smoke test/i.test(inference.detail)) {
      return 'The runtime started, but its generated text failed the grammar quality check. The model remains unverified; browser checks and another download will not fix this. Use Online or select a different validated model.';
    }
    return 'The local inference test failed. Review the failure detail above; browser capability checks alone do not mean the model is ready.';
  }
  if (inference?.status === 'PASS') {
    return `Local model inference passed${inference.backend ? ` on ${inference.backend}` : ''}. The model is ready for local use.`;
  }

  const failure = report.checks.find((check) => check.status === 'FAIL');
  const webgpuBrowserPassed = report.checks.find((check) => check.id === 'webgpu-compute')?.status === 'PASS';
  const wasmBrowserPassed = report.checks.find((check) => check.id === 'wasm-execute')?.status === 'PASS';
  const verifiedBackend = selectDiagnosticBackend(report, ['webgpu', 'wasm']);

  if (verifiedBackend && report.checks.some((check) => check.id === `${verifiedBackend}-artifacts` && check.status === 'PASS')) {
    return 'Browser capability and model configuration checks passed. Run the separate local inference test to verify full model initialization and generation.';
  }

  if (failure) {
    if (failure.id.includes('artifacts')) return 'Download the model files for a backend that passed its browser checks, then run the local inference test.';
    if (failure.id.includes('compatibility')) return 'The cached model configuration does not match the selected runtime. Keep this report and reinstall the model before retrying.';
    if (failure.id.includes('extension-assets') || failure.id.includes('worker-context')) return 'Reload the unpacked extension after a production build and run diagnostics again.';
    if (failure.id.startsWith('webgpu') && wasmBrowserPassed) return 'WebGPU did not pass its checks, but WASM did. Download the WASM model files explicitly, then run the local inference test.';
    if (failure.id.startsWith('wasm') && webgpuBrowserPassed) return 'WASM did not pass its checks, but WebGPU did. Download the WebGPU model files explicitly, then run the local inference test.';
    if (failure.id.startsWith('webgpu')) return 'WebGPU failed its browser check and no verified WASM path is available. Review the individual check details before retrying.';
    if (failure.id.startsWith('wasm')) return 'WASM failed its browser check and no verified WebGPU path is available. Review the individual check details before retrying.';
    return 'Review the failing check and follow the detail shown there before retrying.';
  }
  if (webgpuBrowserPassed || wasmBrowserPassed) {
    const backends = [webgpuBrowserPassed ? 'WebGPU' : '', wasmBrowserPassed ? 'WASM' : ''].filter(Boolean).join(' and ');
    return `${backends} browser checks passed. Model files are not available for a compatible inference test yet; download them explicitly, then run the local inference test.`;
  }
  if (report.checks.some((check) => check.status === 'UNAVAILABLE')) return 'No local backend passed its browser checks. Review the unavailable capabilities and failed checks; no model was downloaded.';
  return 'No model backend is ready to test yet. Download model files explicitly, then run the local inference test.';
}

export function formatDiagnosticReport(report: LocalDiagnosticReport): string {
  const lines = [
    'Mozhi local model diagnostic report',
    `Generated: ${report.generatedAt}`,
    `Browser: ${report.browser}`,
    ...(report.runtime ? [`Runtime: ${report.runtime}`] : []),
    `Model: ${report.modelId}`,
    `Revision: ${report.modelRevision}`,
    '',
    ...report.checks.map((check) => `${check.status}  ${check.label}${check.backend ? ` (${check.backend})` : ''} — ${check.detail}`),
  ];
  return lines.join('\n');
}

export function createDiagnosticFailureReport(browser: string, modelId: string, modelRevision: string, error: unknown): LocalDiagnosticReport {
  const diagnostic = diagnoseLocalModelFailure(error);
  const safeDetail = safeDiagnosticDetail(error) || localDiagnosticMessage(diagnostic);
  const failure: DiagnosticCheck = {
    id: 'worker-context',
    label: 'Extension inference worker',
    status: 'FAIL',
    detail: safeDetail,
  };
  const checks: DiagnosticCheck[] = initialDiagnosticChecks.map((check) => check.id === failure.id
    ? failure
    : { ...check, status: 'NOT TESTED', detail: 'The inference worker did not complete its diagnostic request.' });
  return { generatedAt: new Date().toISOString(), browser, modelId, modelRevision, checks };
}

const initialDiagnosticChecks: Array<Pick<DiagnosticCheck, 'id' | 'label'>> = [
  { id: 'browser', label: 'Browser and version' },
  { id: 'webgpu-api', label: 'WebGPU API in inference worker' },
  { id: 'webgpu-adapter', label: 'WebGPU adapter' },
  { id: 'webgpu-device', label: 'WebGPU device initialization' },
  { id: 'webgpu-compute', label: 'WebGPU compute operation' },
  { id: 'wasm-api', label: 'WebAssembly API' },
  { id: 'wasm-execute', label: 'WebAssembly compile and execute' },
  { id: 'worker-context', label: 'Extension inference worker' },
  { id: 'extension-assets', label: 'Packaged runtime assets' },
  { id: 'webgpu-artifacts', label: 'WebGPU model artifacts' },
  { id: 'webgpu-compatibility', label: 'WebGPU model configuration compatibility' },
  { id: 'webgpu-runtime', label: 'WebGPU model runtime initialization' },
  { id: 'wasm-artifacts', label: 'WASM model artifacts' },
  { id: 'wasm-compatibility', label: 'WASM model configuration compatibility' },
  { id: 'wasm-runtime', label: 'WASM model runtime initialization' },
  { id: 'model-inference', label: 'Real model inference' },
];

/** Runs browser checks sequentially in the same worker that serves local inference. */
export async function runLocalCapabilityDiagnostics(
  probes: LocalDiagnosticProbes,
  modelId: string,
  modelRevision: string,
  onProgress: (progress: DiagnosticProgress) => void = () => {},
): Promise<LocalDiagnosticReport> {
  const checks: DiagnosticCheck[] = [];
  const total = initialDiagnosticChecks.length;
  const add = (check: DiagnosticCheck) => {
    checks.push(check);
    onProgress({ completed: checks.length, total, check });
  };
  const run = async (
    id: string,
    status: DiagnosticStatus,
    detail: string,
    action?: () => Promise<string | void>,
    backend?: LocalBackend,
  ) => {
    const definition = initialDiagnosticChecks.find((check) => check.id === id)!;
    if (!action || status !== 'PASS') {
      add({ ...definition, status, detail, ...(backend ? { backend } : {}) });
      return undefined;
    }
    const started = performance.now();
    try {
      const actionDetail = await action();
      const check: DiagnosticCheck = { ...definition, status: 'PASS', detail: actionDetail || detail, durationMs: Math.round(performance.now() - started), ...(backend ? { backend } : {}) };
      add(check);
      return check;
    } catch (error) {
      const diagnostic = diagnoseLocalModelFailure(error, backend);
      const check: DiagnosticCheck = {
        ...definition,
        status: 'FAIL',
        detail: safeDiagnosticDetail(error) || localDiagnosticMessage(diagnostic),
        durationMs: Math.round(performance.now() - started),
        ...(backend ? { backend } : {}),
      };
      add(check);
      return undefined;
    }
  };

  await run(
    'browser',
    probes.browser.startsWith('Unknown browser') ? 'NOT TESTED' : 'PASS',
    probes.browser.startsWith('Unknown browser') ? 'The browser name or version could not be reliably identified from the inference worker user agent.' : probes.browser,
  );
  await run('webgpu-api', probes.webGpuApiAvailable ? 'PASS' : 'UNAVAILABLE', probes.webGpuApiAvailable ? 'navigator.gpu is present in the inference worker.' : 'navigator.gpu is not available in the inference worker.');

  let adapter: unknown | null = null;
  if (probes.webGpuApiAvailable) {
    const result = await run('webgpu-adapter', 'PASS', 'Requesting a GPU adapter.', async () => {
      adapter = await probes.requestGpuAdapter();
      if (!adapter) throw new Error('WebGPU returned no adapter.');
      return 'A GPU adapter was returned in the inference worker.';
    }, 'webgpu');
    if (!result) adapter = null;
  } else {
    await run('webgpu-adapter', 'NOT TESTED', 'Requires navigator.gpu.', undefined, 'webgpu');
  }

  let device: unknown | null = null;
  if (adapter) {
    const result = await run('webgpu-device', 'PASS', 'Requesting a GPU device.', async () => {
      device = await probes.createGpuDevice(adapter);
      return 'A GPU device was created.';
    }, 'webgpu');
    if (!result) device = null;
  } else {
    await run('webgpu-device', 'NOT TESTED', 'Requires a working WebGPU adapter.', undefined, 'webgpu');
  }

  if (device) {
    await run('webgpu-compute', 'PASS', 'Running a small compute shader.', async () => {
      await probes.runGpuCompute(device);
      return 'A compute shader executed and returned the expected value.';
    }, 'webgpu');
  } else {
    await run('webgpu-compute', 'NOT TESTED', 'Requires a working GPU device.', undefined, 'webgpu');
  }

  await run('wasm-api', probes.webAssemblyAvailable ? 'PASS' : 'UNAVAILABLE', probes.webAssemblyAvailable ? 'WebAssembly is present in the inference worker.' : 'WebAssembly is not available in the inference worker.');
  if (probes.webAssemblyAvailable) {
    await run('wasm-execute', 'PASS', 'Compiling and executing a small WebAssembly module.', async () => {
      await probes.runWasmSmoke();
      return 'A minimal WebAssembly module compiled, executed, and returned the expected value.';
    }, 'wasm');
  } else {
    await run('wasm-execute', 'NOT TESTED', 'Requires WebAssembly support.', undefined, 'wasm');
  }

  await run('worker-context', 'PASS', 'The diagnostic is executing inside the extension worker used for local inference.');
  await run('extension-assets', 'PASS', 'Checking packaged runtime URLs.', () => probes.checkExtensionAssets());

  let artifacts: Awaited<ReturnType<LocalDiagnosticProbes['inspectModelArtifacts']>>;
  let artifactInspectionFailed = false;
  try {
    artifacts = await probes.inspectModelArtifacts();
  } catch (error) {
    artifactInspectionFailed = true;
    const detail = safeDiagnosticDetail(error) || 'Model artifact checks could not complete.';
    await run('webgpu-artifacts', 'FAIL', detail, undefined, 'webgpu');
    await run('webgpu-compatibility', 'NOT TESTED', 'Model configuration could not be checked.', undefined, 'webgpu');
    await run('wasm-artifacts', 'FAIL', detail, undefined, 'wasm');
    await run('wasm-compatibility', 'NOT TESTED', 'Model configuration could not be checked.', undefined, 'wasm');
    artifacts = {};
  }

  if (!artifactInspectionFailed) {
    for (const backend of ['webgpu', 'wasm'] as const) {
      const artifactId = `${backend}-artifacts`;
      const compatibilityId = `${backend}-compatibility`;
      const artifact = artifacts[backend];
      if (!artifact?.cached) {
        await run(artifactId, artifact?.incomplete ? 'FAIL' : 'NOT TESTED', artifact?.detail ?? `The ${backend} model artifact set is not available in the local cache.`, undefined, backend);
        await run(compatibilityId, 'NOT TESTED', `Model configuration cannot be checked until ${backend} artifacts are available.`, undefined, backend);
        continue;
      }
      await run(artifactId, 'PASS', artifact.detail, undefined, backend);
      const compatible = artifact.compatible;
      await run(compatibilityId, compatible === false ? 'FAIL' : compatible === true ? 'PASS' : 'NOT TESTED', artifact.detail, undefined, backend);
    }
  }
  await run('webgpu-runtime', 'NOT TESTED', 'Full Transformers.js model initialization runs only during the separate inference test.', undefined, 'webgpu');
  await run('wasm-runtime', 'NOT TESTED', 'Full Transformers.js model initialization runs only during the separate inference test.', undefined, 'wasm');
  await run('model-inference', 'NOT TESTED', 'Run the separate local inference test when model files are available.', undefined);

  return {
    generatedAt: new Date().toISOString(),
    browser: probes.browser,
    ...(probes.runtime ? { runtime: probes.runtime } : {}),
    modelId,
    modelRevision,
    checks,
  };
}

export function safeDiagnosticDetail(error: unknown, sensitiveValues: string[] = []): string {
  const raw = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  const promptRedacted = sensitiveValues.reduce((detail, value) => {
    const secret = value.trim();
    if (!secret) return detail;
    const escaped = secret.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return detail.replace(new RegExp(escaped, 'gi'), '[prompt redacted]');
  }, raw);
  return promptRedacted
    .replace(/Bearer\s+[^\s,;]+/gi, 'Bearer [redacted]')
    .replace(/(api[_-]?key|authorization|token|prompt)\s*[:=]\s*[^\s,;]+/gi, '$1=[redacted]')
    .replace(/https?:\/\/[^\s)]+/gi, '[remote URL redacted]')
    .replace(/[\r\n\t]+/g, ' ')
    .slice(0, 240);
}

export function diagnoseLocalBackendFallback(
  primaryError: unknown,
  fallbackError: unknown,
  sensitiveValues: string[] = [],
): LocalModelDiagnostic {
  const primary = diagnoseLocalModelFailure(primaryError, 'webgpu');
  const fallback = diagnoseLocalModelFailure(fallbackError, 'wasm');
  const primaryDetail = safeDiagnosticDetail(primaryError, sensitiveValues) || localDiagnosticMessage(primary);
  const fallbackDetail = safeDiagnosticDetail(fallbackError, sensitiveValues) || localDiagnosticMessage(fallback);
  return {
    ...primary,
    ...(primaryError instanceof LocalGenerationOutputError ? { stage: 'inference' as const } : {}),
    ...(fallbackError instanceof LocalGenerationOutputError ? { fallbackStage: 'inference' as const } : {}),
    fallbackCategory: fallback.category,
    primaryDetail,
    fallbackDetail,
    detail: `WebGPU (${primary.category}): ${primaryDetail} | WASM (${fallback.category}): ${fallbackDetail}`,
  };
}

/**
 * Keeps browser/runtime diagnostics actionable without exposing model input or
 * transport details to the extension UI.
 */
export function diagnoseLocalModelFailure(error: unknown, backend?: LocalBackend): LocalModelDiagnostic {
  const detail = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();

  if (/out of memory|allocation failed|memory limit|oom/.test(detail)) return { category: 'out-of-memory', backend };
  // Dynamic module imports failing in extension workers are commonly caused by
  // a missing packaged runtime file or an MV3 CSP rejection of blob: imports.
  // Classify this before matching the provider name embedded in ONNX's wrapper.
  if (/failed to fetch dynamically imported module|blob:|content security policy|csp|worker|import.*module|dynamic import|script/.test(detail)) {
    return { category: 'extension-asset-error', backend };
  }
  if (/wasm|webassembly|sharedarraybuffer|simd/.test(detail)) return { category: 'wasm-unavailable', backend };
  if (/webgpu|gpu adapter|gpu device|device lost|jsep/.test(detail)) return { category: 'webgpu-unavailable', backend };
  if (/fetch|network|download|http (?:4|5)\d\d|\b403\b|\b404\b|failed to load/.test(detail)) return { category: 'model-download-failed', backend };
  if (/local_files_only|not downloaded|cache|tokenizer|config\.json|model.*(?:not found|missing|invalid)|quantiz|dtype|unsupported op|no op registered/.test(detail)) {
    return { category: 'model-artifact-incompatible', backend };
  }
  if (/not supported|unsupported browser|navigator\.gpu/.test(detail)) return { category: 'unsupported-runtime', backend };
  return { category: 'inference-failed', backend };
}

export function canFallbackToWasm(error: unknown): boolean {
  return error instanceof LocalGenerationOutputError
    || diagnoseLocalModelFailure(error, 'webgpu').category === 'webgpu-unavailable';
}

export function localDiagnosticMessage(diagnostic: LocalModelDiagnostic): string {
  if (diagnostic.fallbackCategory) {
    const primaryDetail = diagnostic.primaryDetail || 'The primary local backend could not start.';
    const fallbackDetail = diagnostic.fallbackDetail || 'The WASM fallback could not start.';
    if (
      diagnostic.stage === 'inference'
      && diagnostic.fallbackStage === 'inference'
      && /failed the fixed grammar smoke test/i.test(`${primaryDetail} ${fallbackDetail}`)
    ) {
      return 'The model ran on WebGPU and WASM, but failed the grammar check on both. It is not reliable for local prompt enhancement; use Online or choose a different validated model.';
    }
    if (diagnostic.stage === 'inference' && diagnostic.fallbackStage === 'inference') {
      return `The model initialized, but inference returned no usable text on WebGPU or WASM. ${primaryDetail} ${fallbackDetail} Open Settings → Local Model Diagnostics for details.`;
    }
    if (diagnostic.stage === 'inference') {
      return `WebGPU initialized, but inference returned no usable text. The WASM fallback also failed: ${fallbackDetail} Open Settings → Local Model Diagnostics for details.`;
    }
    if (diagnostic.fallbackStage === 'inference') {
      return `WebGPU could not initialize: ${primaryDetail} The WASM model loaded, but inference returned no usable text. Open Settings → Local Model Diagnostics for details.`;
    }
    return `Local startup failed. WebGPU (${diagnostic.category}): ${primaryDetail} WASM (${diagnostic.fallbackCategory}): ${fallbackDetail} Open Settings → Local Model Diagnostics for the full report.`;
  }
  if (diagnostic.stage === 'inference') {
    return 'The model loaded, but inference did not return usable text. See Local Model Diagnostics for the technical detail.';
  }
  switch (diagnostic.category) {
    case 'unsupported-runtime': return 'This browser does not provide a supported local inference runtime.';
    case 'webgpu-unavailable': return 'WebGPU could not initialize on this device.';
    case 'wasm-unavailable': return 'The local WASM runtime could not initialize in this extension.';
    case 'model-download-failed': return 'The model files could not be downloaded or read from the cache.';
    case 'model-artifact-incompatible': return 'The downloaded model files are incomplete or incompatible with this runtime.';
    case 'out-of-memory': return 'The local model ran out of memory while starting.';
    case 'worker-initialization-failed': return 'The local model worker could not start.';
    case 'extension-asset-error': return 'A required local runtime asset could not be loaded by the extension.';
    default: return 'The local model could not start.';
  }
}

export function localDiagnosticCode(diagnostic: LocalModelDiagnostic): string {
  return diagnostic.fallbackCategory
    ? `${diagnostic.category}+${diagnostic.fallbackCategory}`
    : diagnostic.category;
}
