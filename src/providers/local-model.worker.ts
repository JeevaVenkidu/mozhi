import { AutoConfig, AutoTokenizer, env, ModelRegistry, pipeline, type ProgressInfo } from '@huggingface/transformers';
import wasmRuntimeModuleUrl from '../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.mjs?url';
import wasmRuntimeAssetUrl from '../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.wasm?url';
import { runMinimalWasmProbe } from './local-browser-capabilities';
import { cleanLocalGeneratedText, createLocalEnhancementMessages, extractLocalGeneratedText, isRelevantLocalEnhancement, isUsableLocalGeneratedText, LocalGenerationOutputError, runLocalInferenceSmokeTest } from './local-inference-smoke-test';
import { LocalBackendFallbackError, createLocalGenerator, runWithLocalFallback, type LocalBackend } from './local-backend';
import { hasUsableChatTemplate, localModel, pinnedModelRemotePathTemplate, type LocalInferenceProgress } from './local-model-config';
import { canFallbackToWasm, diagnoseLocalBackendFallback, diagnoseLocalModelFailure, localDiagnosticMessage, runLocalCapabilityDiagnostics, safeDiagnosticDetail, type LocalModelDiagnostic } from './local-diagnostics';
import type { LocalWorkerRequest, LocalWorkerResponse } from './local-worker-protocol';

type TextGenerator = Awaited<ReturnType<typeof pipeline<'text-generation'>>>;

let generatorPromise: Promise<TextGenerator> | null = null;
let activeBackend: LocalBackend | null = null;

env.cacheKey = localModel.cacheName;
// Transformers.js 4.3.x probes tokenizer_config.json without forwarding the
// model revision. Keep those lookups on the same immutable snapshot as the
// model files, or an offline pipeline can be created with a null tokenizer.
env.remotePathTemplate = pinnedModelRemotePathTemplate(localModel.revision);
env.useBrowserCache = true;
// Model weights may only be read from the user-approved local cache during
// diagnostics and inference. Remote model reads are enabled only for an
// explicit Settings-page download action.
env.allowLocalModels = true;
// Inference and cache inspection must never turn into an implicit model download.
env.allowRemoteModels = false;
// ONNX Runtime's default Transformers.js path points to a CDN-hosted .mjs
// loader. In MV3 that loader can be fetched and turned into a blob URL, but
// extension-page CSP correctly blocks importing executable blob: modules.
// Package both ONNX assets and import the same-origin extension URLs directly.
env.useWasmCache = false;
const onnxWasmConfig = env.backends.onnx.wasm as NonNullable<typeof env.backends.onnx.wasm>;
onnxWasmConfig.wasmPaths = { mjs: wasmRuntimeModuleUrl, wasm: wasmRuntimeAssetUrl };

function send(message: LocalWorkerResponse) {
  self.postMessage(message);
}

async function supportsWebGpu(): Promise<boolean> {
  const browserWithGpu = navigator as Navigator & { gpu?: { requestAdapter: () => Promise<unknown> } };
  try {
    return Boolean(await browserWithGpu.gpu?.requestAdapter());
  } catch {
    return false;
  }
}

interface GpuDeviceLike {
  queue: { submit(commands: unknown[]): void };
  createShaderModule(descriptor: { code: string }): unknown;
  createComputePipelineAsync(descriptor: { layout: string; compute: { module: unknown; entryPoint: string } }): Promise<unknown>;
  createBuffer(descriptor: { size: number; usage: number }): { mapAsync(mode: number): Promise<void>; getMappedRange(): ArrayBuffer; unmap(): void; destroy(): void };
  createBindGroup(descriptor: { layout: unknown; entries: Array<{ binding: number; resource: { buffer: unknown } }> }): unknown;
  createCommandEncoder(): { beginComputePass(): { setPipeline(pipeline: unknown): void; setBindGroup(index: number, group: unknown): void; dispatchWorkgroups(count: number): void; end(): void }; copyBufferToBuffer(source: unknown, sourceOffset: number, target: unknown, targetOffset: number, size: number): void; finish(): unknown };
  destroy(): void;
}

function browserLabel(): string {
  const agent = navigator.userAgent;
  const match = agent.match(/Edg\/([\d.]+)/) ?? agent.match(/(?:Chrome|Chromium)\/([\d.]+)/) ?? agent.match(/Firefox\/([\d.]+)/);
  const name = /Edg\//.test(agent) ? 'Microsoft Edge' : /Chrome|Chromium\//.test(agent) ? 'Chrome/Chromium' : /Firefox\//.test(agent) ? 'Firefox' : 'Unknown browser';
  return match ? `${name} ${match[1]} (inference worker user agent)` : `${name} (version unavailable in inference worker)`;
}

function requestGpuAdapter(): Promise<unknown | null> {
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown | null> } }).gpu;
  return gpu ? gpu.requestAdapter() : Promise.resolve(null);
}

async function runGpuCompute(deviceValue: unknown): Promise<void> {
  const device = deviceValue as GpuDeviceLike;
  let storage: ReturnType<GpuDeviceLike['createBuffer']> | undefined;
  let readback: ReturnType<GpuDeviceLike['createBuffer']> | undefined;
  try {
    const shader = device.createShaderModule({ code: '@group(0) @binding(0) var<storage, read_write> output: array<u32>; @compute @workgroup_size(1) fn main() { output[0] = 19u + 23u; }' });
    const pipeline = await device.createComputePipelineAsync({ layout: 'auto', compute: { module: shader, entryPoint: 'main' } });
    storage = device.createBuffer({ size: 4, usage: 0x80 | 0x04 });
    readback = device.createBuffer({ size: 4, usage: 0x01 | 0x08 });
    const bindGroup = device.createBindGroup({ layout: (pipeline as { getBindGroupLayout(index: number): unknown }).getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: storage } }] });
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(1);
    pass.end();
    encoder.copyBufferToBuffer(storage, 0, readback, 0, 4);
    device.queue.submit([encoder.finish()]);
    await readback.mapAsync(1);
    const value = new Uint32Array(readback.getMappedRange())[0];
    readback.unmap();
    if (value !== 42) throw new Error('The GPU compute operation returned an unexpected value.');
  } finally {
    storage?.destroy();
    readback?.destroy();
    device.destroy();
  }
}

async function checkExtensionAssets(): Promise<string> {
  const workerUrl = new URL(import.meta.url);
  if (workerUrl.protocol !== 'chrome-extension:') throw new Error('The inference worker is not running from a packaged Chrome extension URL.');
  for (const [label, assetUrl] of [
    ['ONNX WASM module', new URL(wasmRuntimeModuleUrl, workerUrl)],
    ['ONNX WASM binary', new URL(wasmRuntimeAssetUrl, workerUrl)],
  ] as const) {
    if (assetUrl.protocol !== 'chrome-extension:') {
      throw new Error(`The packaged ${label} does not resolve to the extension package.`);
    }
    const response = await fetch(assetUrl);
    if (!response.ok) throw new Error(`The packaged ${label} returned HTTP ${response.status}.`);
    if (!response.body) throw new Error(`The packaged ${label} returned an empty response.`);
    await response.body.cancel();
  }
  return 'The inference worker and ONNX WASM module/binary resolve to assets packaged with the extension.';
}

async function inspectModelArtifacts() {
  env.allowLocalModels = true;
  env.allowRemoteModels = false;
  const backends: LocalBackend[] = ['webgpu', 'wasm'];
  const cached: Partial<Record<LocalBackend, boolean>> = {};
  const artifactDetails: Partial<Record<LocalBackend, { incomplete: boolean; detail: string }>> = {};
  for (const backend of backends) {
    const result = await ModelRegistry.is_pipeline_cached_files('text-generation', localModel.id, {
      revision: localModel.revision,
      device: backend,
      dtype: backend === 'webgpu' ? 'q4f16' : 'q4',
    });
    cached[backend] = result.allCached;
    const present = result.files.filter((file) => file.cached).length;
    artifactDetails[backend] = {
      incomplete: present > 0 && !result.allCached,
      detail: result.allCached
        ? `All ${result.files.length} required files for ${backend} are in the local cache.`
        : present > 0
          ? `${present} of ${result.files.length} required ${backend} files are cached; this artifact set is incomplete.`
          : `The ${backend} artifact set is not downloaded; no remote request was made.`,
    };
  }
  if (!cached.webgpu && !cached.wasm) {
    return {
      webgpu: { cached: false, incomplete: artifactDetails.webgpu?.incomplete, detail: artifactDetails.webgpu?.detail ?? 'WebGPU model artifacts are not available.' },
      wasm: { cached: false, incomplete: artifactDetails.wasm?.incomplete, detail: artifactDetails.wasm?.detail ?? 'WASM model artifacts are not available.' },
    };
  }

  try {
    const config = await AutoConfig.from_pretrained(localModel.id, { revision: localModel.revision, local_files_only: true });
    const architecture = (config as typeof config & { architectures?: string[] }).architectures ?? [];
    const configCompatible = config.model_type === localModel.expectedModelType && architecture.includes(localModel.expectedArchitecture);
    const tokenizer = await AutoTokenizer.from_pretrained(localModel.id, { revision: localModel.revision, local_files_only: true });
    const chatTemplate = (tokenizer as typeof tokenizer & { chat_template?: unknown }).chat_template;
    const hasChatTemplate = hasUsableChatTemplate(chatTemplate);
    const compatible = configCompatible && hasChatTemplate;
    const detail = `${configCompatible
      ? `Cached config matches ${localModel.expectedModelType}/${localModel.expectedArchitecture}.`
      : `Cached model config reports ${config.model_type ?? 'unknown'} / ${architecture.join(', ') || 'no architecture'}; expected ${localModel.expectedModelType} / ${localModel.expectedArchitecture}.`} ${hasChatTemplate
      ? 'Tokenizer chat template is available.'
      : 'Tokenizer chat template is missing; this instruction model cannot accept the enhancement chat messages.'} Full backend initialization is not tested here.`;
    return {
      webgpu: { cached: cached.webgpu ?? false, incomplete: artifactDetails.webgpu?.incomplete, compatible: cached.webgpu ? compatible : undefined, detail: cached.webgpu ? `${artifactDetails.webgpu?.detail} ${detail}` : artifactDetails.webgpu?.detail ?? 'WebGPU artifacts are unavailable.' },
      wasm: { cached: cached.wasm ?? false, incomplete: artifactDetails.wasm?.incomplete, compatible: cached.wasm ? compatible : undefined, detail: cached.wasm ? `${artifactDetails.wasm?.detail} ${detail}` : artifactDetails.wasm?.detail ?? 'WASM artifacts are unavailable.' },
    };
  } catch (error) {
    const detail = safeDiagnosticDetail(error) || 'The cached model configuration could not be parsed.';
    return {
      webgpu: { cached: cached.webgpu ?? false, incomplete: artifactDetails.webgpu?.incomplete, compatible: cached.webgpu ? false : undefined, detail },
      wasm: { cached: cached.wasm ?? false, incomplete: artifactDetails.wasm?.incomplete, compatible: cached.wasm ? false : undefined, detail },
    };
  }
}

async function runDiagnostics(id: number) {
  env.allowLocalModels = true;
  env.allowRemoteModels = false;
  const report = await runLocalCapabilityDiagnostics({
    browser: browserLabel(),
    runtime: `Transformers.js ${env.version}`,
    webGpuApiAvailable: Boolean((navigator as Navigator & { gpu?: unknown }).gpu),
    requestGpuAdapter,
    createGpuDevice: async (adapter) => (adapter as { requestDevice(): Promise<GpuDeviceLike> }).requestDevice(),
    runGpuCompute,
    webAssemblyAvailable: typeof WebAssembly !== 'undefined',
    runWasmSmoke: runMinimalWasmProbe,
    checkExtensionAssets,
    inspectModelArtifacts,
  }, localModel.id, localModel.revision, (progress) => send({ id, type: 'diagnostic-progress', progress }));
  send({ id, type: 'diagnostics-complete', report });
}

function reportProgress(id: number, info: ProgressInfo) {
  const progress: LocalInferenceProgress = info.status === 'progress'
    ? { stage: 'downloading', progress: info.progress, file: info.file }
    : { stage: info.status === 'download' || info.status === 'initiate' ? 'downloading' : 'loading', file: 'file' in info ? info.file : undefined };
  send({ id, type: 'progress', progress });
}

async function createPipeline(id: number, backend: LocalBackend, allowDownload: boolean): Promise<TextGenerator> {
  // This flag is only enabled after an explicit Settings-page download request.
  env.allowLocalModels = true;
  env.allowRemoteModels = allowDownload;
  try {
    return await pipeline('text-generation', localModel.id, {
      revision: localModel.revision,
      device: backend,
      dtype: backend === 'webgpu' ? 'q4f16' : 'q4',
      local_files_only: !allowDownload,
      progress_callback: (info: ProgressInfo) => reportProgress(id, info),
    });
  } finally {
    env.allowRemoteModels = false;
  }
}

async function cachedBackends(): Promise<LocalBackend[]> {
  env.allowLocalModels = true;
  env.allowRemoteModels = false;
  const options = { revision: localModel.revision };
  const results = await Promise.all([
    ModelRegistry.is_pipeline_cached('text-generation', localModel.id, { ...options, device: 'webgpu', dtype: 'q4f16' })
      .then((cached) => cached ? 'webgpu' as const : null),
    ModelRegistry.is_pipeline_cached('text-generation', localModel.id, { ...options, device: 'wasm', dtype: 'q4' })
      .then((cached) => cached ? 'wasm' as const : null),
  ]);
  return results.filter((backend): backend is LocalBackend => backend !== null);
}

async function checkModel(id: number) {
  env.allowLocalModels = true;
  env.allowRemoteModels = false;
  const available = await cachedBackends();
  const gpuAvailable = await supportsWebGpu();
  const backend = (gpuAvailable ? available.find((item) => item === 'webgpu') : undefined)
    ?? available.find((item) => item === 'wasm')
    ?? available[0];
  send({ id, type: 'model-status', downloaded: available.length > 0, ...(backend ? { backend } : {}), backends: available });
}

async function getGenerator(id: number, backend: LocalBackend, available: LocalBackend[]): Promise<TextGenerator> {
  if (!generatorPromise || activeBackend !== backend) {
    generatorPromise = null;
    activeBackend = null;
    const initialize = async () => {
      send({ id, type: 'progress', progress: { stage: 'loading' } });
      const loaded = await createLocalGenerator(
        backend,
        (selectedBackend) => createPipeline(id, selectedBackend, false),
        () => send({ id, type: 'progress', progress: { stage: 'fallback' } }),
        (error) => canFallbackToWasm(error) && available.includes('wasm'),
      );
      activeBackend = loaded.backend;
      return loaded.generator;
    };
    generatorPromise = initialize().catch((error: unknown) => {
      generatorPromise = null;
      activeBackend = null;
      throw error;
    });
  }
  return generatorPromise;
}

async function disposeGenerator(generator: TextGenerator) {
  const disposable = generator as TextGenerator & { dispose?: () => void | Promise<void> };
  try {
    await disposable.dispose?.();
  } catch {
    // Cleanup failure should not hide the original provider result.
  }
}

async function downloadModel(id: number, requestedBackend?: LocalBackend) {
  const preferredBackend: LocalBackend = requestedBackend ?? (await supportsWebGpu() ? 'webgpu' : 'wasm');
  send({ id, type: 'progress', progress: { stage: 'loading' } });
  // This click authorizes downloading the selected backend only. A failed
  // WebGPU download must not silently start a much larger WASM download.
  const generator = await createPipeline(id, preferredBackend, true);
  try {
    await smokeTest(generator);
    send({ id, type: 'model-downloaded', backend: preferredBackend });
  } finally {
    await disposeGenerator(generator);
  }
}

/** A fixed grammar check verifies the cached model produces the expected readable result. */
async function smokeTest(generator: TextGenerator) {
  await runLocalInferenceSmokeTest(generator);
}

async function verifyModel(id: number, requestedBackend?: LocalBackend) {
  const available = await cachedBackends();
  const gpuAvailable = await supportsWebGpu();
  const backend = requestedBackend
    ?? (gpuAvailable && available.includes('webgpu') ? 'webgpu' : available.includes('wasm') ? 'wasm' : undefined);
  if (!backend || !available.includes(backend)) {
    throw new Error('The local model files are not completely downloaded. Download the selected runtime before verifying it.');
  }
  const tested = await runWithLocalFallback(
    backend,
    async (selectedBackend) => {
      const generator = await createPipeline(id, selectedBackend, false);
      try {
        await smokeTest(generator);
        return generator;
      } catch (error) {
        await disposeGenerator(generator);
        throw error;
      }
    },
    () => send({ id, type: 'progress', progress: { stage: 'fallback' } }),
    (error) => canFallbackToWasm(error) && available.includes('wasm'),
  );
  try {
    send({ id, type: 'model-verified', backend: tested.backend });
  } finally {
    await disposeGenerator(tested.generator);
  }
}

async function enhance(id: number, request: Extract<LocalWorkerRequest, { type: 'enhance' }>['request'], preferredBackend?: LocalBackend) {
  env.allowLocalModels = true;
  env.allowRemoteModels = false;
  if (request.mode !== 'typo') {
    throw new Error('The local on-device model only supports Typo & Grammar Fix mode. Switch to Online BYOK for other modes.');
  }

  const available = await cachedBackends();
  if (available.length === 0) throw new Error('Local model not downloaded. Open Mozhi Settings and download the model before enhancing.');

  const gpuAvailable = await supportsWebGpu();
  if (!gpuAvailable && !available.includes('wasm')) {
    throw new Error('The downloaded model needs WebGPU, which is unavailable. Open Settings to download a compatible WASM model.');
  }

  let backend: LocalBackend = (preferredBackend && available.includes(preferredBackend))
    ? preferredBackend
    : (gpuAvailable && available.includes('webgpu') ? 'webgpu' : 'wasm');

  let generator = await getGenerator(id, backend, available);
  const messages = createLocalEnhancementMessages(request.mode, request.prompt);
  const generationOptions = {
    max_new_tokens: Math.min(256, Math.max(64, Math.ceil(request.prompt.length * 0.75))),
    do_sample: true,
    temperature: 0.1,
    top_p: 0.9,
    return_full_text: false,
  } as const;
  send({ id, type: 'progress', progress: { stage: 'generating' } });

  const run = async (selectedBackend: LocalBackend) => {
    if (!available.includes(selectedBackend)) {
      throw new Error('A compatible WASM model is not downloaded. Open Settings and download the compatibility model before retrying.');
    }
    if (selectedBackend !== activeBackend || !generatorPromise) {
      generator = await getGenerator(id, selectedBackend, available);
    }
    send({ id, type: 'progress', progress: { stage: 'generating' } });
    const output = await generator(messages, generationOptions);
    const rawContent = extractLocalGeneratedText(output);
    if (typeof rawContent !== 'string' || !rawContent.trim()) {
      throw new LocalGenerationOutputError('The local model returned no generated text.');
    }
    if (!isUsableLocalGeneratedText(rawContent)) {
      throw new LocalGenerationOutputError('The local model returned mostly symbols instead of readable text.', 'unreadable-output');
    }
    const content = cleanLocalGeneratedText(rawContent);
    if (!content.trim()) {
      throw new LocalGenerationOutputError('The local model returned empty text after removing conversational formatting.');
    }
    if (!isRelevantLocalEnhancement(request.prompt, content)) {
      throw new LocalGenerationOutputError('The local model answered conversationally instead of improving the supplied prompt.', 'unrelated-output');
    }
    return content;
  };
  const generation = await runWithLocalFallback(
    backend,
    run,
    async () => {
      send({ id, type: 'progress', progress: { stage: 'fallback' } });
      await disposeGenerator(generator);
      generatorPromise = null;
      activeBackend = null;
    },
    (error) => canFallbackToWasm(error) && available.includes('wasm'),
  );
  backend = generation.backend;
  activeBackend = backend;
  send({ id, type: 'result', result: generation.generator });
}

async function handle(message: LocalWorkerRequest) {
  try {
    switch (message.type) {
      case 'model-status':
        await checkModel(message.id);
        break;
      case 'run-diagnostics':
        await runDiagnostics(message.id);
        break;
      case 'verify-model':
        await verifyModel(message.id, message.backend);
        break;
      case 'download-model':
        await downloadModel(message.id, message.backend);
        break;
      case 'delete-model': {
        env.allowRemoteModels = false;
        const deleted = await caches.delete(localModel.cacheName);
        generatorPromise = null;
        activeBackend = null;
        send({ id: message.id, type: 'model-deleted', deleted });
        break;
      }
      case 'enhance':
        await enhance(message.id, message.request, message.preferredBackend);
        break;
    }
  } catch (error) {
    const backendHint = 'backend' in message ? message.backend : undefined;
    const sensitiveValues = message.type === 'enhance' ? [message.request.prompt] : [];
    const diagnostic = diagnosticFor(error, backendHint, sensitiveValues);
    send({ id: message.id, type: 'error', message: localDiagnosticMessage(diagnostic), diagnostic });
  } finally {
    env.allowRemoteModels = false;
  }
}

function diagnosticFor(error: unknown, backendHint?: LocalBackend, sensitiveValues: string[] = []): LocalModelDiagnostic {
  const details = {
    detail: safeDiagnosticDetail(error, sensitiveValues),
    runtime: `Transformers.js ${env.version}`,
    modelId: localModel.id,
    modelRevision: localModel.revision,
  };
  if (error instanceof LocalBackendFallbackError) {
    return {
      ...diagnoseLocalBackendFallback(error.primaryError, error.fallbackError, sensitiveValues),
      runtime: details.runtime,
      modelId: details.modelId,
      modelRevision: details.modelRevision,
    };
  }
  return {
    ...diagnoseLocalModelFailure(error, backendHint),
    ...(error instanceof LocalGenerationOutputError ? { stage: 'inference' as const } : {}),
    ...details,
  };
}

self.addEventListener('message', (event: MessageEvent<LocalWorkerRequest>) => {
  void handle(event.data);
});
