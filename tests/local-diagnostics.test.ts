import { describe, expect, it, vi } from 'vitest';
import {
  canFallbackToWasm,
  diagnoseLocalBackendFallback,
  diagnoseLocalModelFailure,
  diagnosticRecommendation,
  formatDiagnosticReport,
  localDiagnosticMessage,
  runLocalCapabilityDiagnostics,
  safeDiagnosticDetail,
  selectDiagnosticBackend,
  type LocalDiagnosticProbes,
  type LocalDiagnosticReport,
} from '../src/providers/local-diagnostics';
import { LocalGenerationOutputError } from '../src/providers/local-inference-smoke-test';

function makeProbes(overrides: Partial<LocalDiagnosticProbes> = {}): LocalDiagnosticProbes {
  return {
    browser: 'Chrome/Chromium 140.0 (inference worker user agent)',
    webGpuApiAvailable: true,
    requestGpuAdapter: vi.fn(async () => ({ adapter: true })),
    createGpuDevice: vi.fn(async () => ({ device: true })),
    runGpuCompute: vi.fn(async () => {}),
    webAssemblyAvailable: true,
    runWasmSmoke: vi.fn(async () => {}),
    checkExtensionAssets: vi.fn(async () => 'Worker and runtime assets loaded from the extension package.'),
    inspectModelArtifacts: vi.fn(async () => ({
      webgpu: { cached: true, compatible: true, detail: 'WebGPU artifacts match the model configuration.' },
      wasm: { cached: true, compatible: true, detail: 'WASM artifacts match the model configuration.' },
    })),
    ...overrides,
  };
}

async function run(probes: LocalDiagnosticProbes) {
  return runLocalCapabilityDiagnostics(probes, 'example/model', 'pinned-revision');
}

describe('local model diagnostics', () => {
  it('allows the WASM fallback only for an actual WebGPU failure', () => {
    expect(canFallbackToWasm(new Error('Failed to get GPU adapter.'))).toBe(true);
    expect(canFallbackToWasm(new LocalGenerationOutputError('The model inference smoke test returned no text.'))).toBe(true);
    expect(canFallbackToWasm(new Error('local_files_only model file was not found'))).toBe(false);
  });

  it('distinguishes a loaded model with empty generation from a startup failure', () => {
    const message = localDiagnosticMessage({ category: 'inference-failed', stage: 'inference' });
    expect(message).toContain('model loaded');
    expect(message).toContain('did not return usable text');
    expect(message).not.toContain('could not start');
  });

  it('reports which backend initialized when inference and fallback fail at different stages', () => {
    const diagnostic = diagnoseLocalBackendFallback(
      new LocalGenerationOutputError('The WebGPU model returned no generated text.'),
      new Error('WASM model files are incomplete.'),
    );

    expect(diagnostic.stage).toBe('inference');
    expect(diagnostic.fallbackStage).toBeUndefined();
    expect(localDiagnosticMessage(diagnostic)).toContain('WebGPU initialized');
    expect(localDiagnosticMessage(diagnostic)).toContain('WASM fallback also failed');
  });

  it('explains when both backends run but the model fails the grammar check', () => {
    const diagnostic = diagnoseLocalBackendFallback(
      new LocalGenerationOutputError('The model returned text, but failed the fixed grammar smoke test.', 'incorrect-output'),
      new LocalGenerationOutputError('The model returned text, but failed the fixed grammar smoke test.', 'incorrect-output'),
    );

    expect(localDiagnosticMessage(diagnostic)).toContain('failed the grammar check on both');
    expect(localDiagnosticMessage(diagnostic)).toContain('not reliable for local prompt enhancement');
    expect(localDiagnosticMessage(diagnostic)).not.toContain('returned no usable text');
  });

  it('classifies model artifact and memory failures without returning raw error text', () => {
    expect(diagnoseLocalModelFailure(new Error('model_q4.onnx is missing'))).toMatchObject({ category: 'model-artifact-incompatible' });
    expect(localDiagnosticMessage(diagnoseLocalModelFailure(new Error('allocation failed: out of memory'))))
      .toBe('The local model ran out of memory while starting.');
  });

  it('classifies a blocked blob module import as an extension asset failure', () => {
    expect(diagnoseLocalModelFailure(new Error(
      'no available backend found. ERR: [webgpu] TypeError: Failed to fetch dynamically imported module: blob:chrome-extension://extension-id/runtime.mjs',
    ), 'wasm')).toMatchObject({ category: 'extension-asset-error', backend: 'wasm' });
  });

  it('runs browser checks sequentially in the inference worker and leaves inference untested', async () => {
    const order: string[] = [];
    const probes = makeProbes({
      requestGpuAdapter: vi.fn(async () => { order.push('adapter'); return {}; }),
      createGpuDevice: vi.fn(async () => { order.push('device'); return {}; }),
      runGpuCompute: vi.fn(async () => { order.push('compute'); }),
      runWasmSmoke: vi.fn(async () => { order.push('wasm'); }),
      checkExtensionAssets: vi.fn(async () => { order.push('assets'); return 'Assets loaded.'; }),
      inspectModelArtifacts: vi.fn(async () => { order.push('model'); return {
        webgpu: { cached: true, compatible: true, detail: 'GPU model artifacts are complete.' },
        wasm: { cached: true, compatible: true, detail: 'WASM model artifacts are complete.' },
      }; }),
    });
    const progress: number[] = [];

    const report = await runLocalCapabilityDiagnostics(probes, 'example/model', 'pinned-revision', (item) => progress.push(item.completed));

    expect(order).toEqual(['adapter', 'device', 'compute', 'wasm', 'assets', 'model']);
    expect(progress).toEqual(Array.from({ length: report.checks.length }, (_, index) => index + 1));
    expect(report.browser).toContain('Chrome/Chromium 140');
    expect(report.checks.find((check) => check.id === 'webgpu-device')?.status).toBe('PASS');
    expect(report.checks.find((check) => check.id === 'webgpu-compute')?.status).toBe('PASS');
    expect(report.checks.find((check) => check.id === 'wasm-execute')?.status).toBe('PASS');
    expect(report.checks.find((check) => check.id === 'model-inference')?.status).toBe('NOT TESTED');
  });

  it('marks missing WebGPU unavailable and skips dependent checks without skipping WASM', async () => {
    const requestGpuAdapter = vi.fn();
    const report = await run(makeProbes({ webGpuApiAvailable: false, requestGpuAdapter }));

    expect(report.checks.find((check) => check.id === 'webgpu-api')?.status).toBe('UNAVAILABLE');
    expect(report.checks.find((check) => check.id === 'webgpu-adapter')?.status).toBe('NOT TESTED');
    expect(report.checks.find((check) => check.id === 'webgpu-compute')?.status).toBe('NOT TESTED');
    expect(report.checks.find((check) => check.id === 'wasm-execute')?.status).toBe('PASS');
    expect(requestGpuAdapter).not.toHaveBeenCalled();
  });

  it('does not report unidentified browser details as a passing check', async () => {
    const report = await run(makeProbes({ browser: 'Unknown browser (version unavailable in inference worker)' }));

    expect(report.checks.find((check) => check.id === 'browser')).toMatchObject({ status: 'NOT TESTED' });
  });

  it('records adapter and GPU compute failures distinctly', async () => {
    const adapterFailure = await run(makeProbes({ requestGpuAdapter: vi.fn(async () => null) }));
    expect(adapterFailure.checks.find((check) => check.id === 'webgpu-adapter')?.status).toBe('FAIL');
    expect(adapterFailure.checks.find((check) => check.id === 'webgpu-device')?.status).toBe('NOT TESTED');

    const computeFailure = await run(makeProbes({ runGpuCompute: vi.fn(async () => { throw new Error('GPU compute pipeline validation failed'); }) }));
    expect(computeFailure.checks.find((check) => check.id === 'webgpu-device')?.status).toBe('PASS');
    expect(computeFailure.checks.find((check) => check.id === 'webgpu-compute')).toMatchObject({ status: 'FAIL', backend: 'webgpu' });
  });

  it('checks WASM compilation and execution independently', async () => {
    const report = await run(makeProbes({ runWasmSmoke: vi.fn(async () => { throw new Error('WebAssembly.compile blocked by policy'); }) }));
    expect(report.checks.find((check) => check.id === 'wasm-api')?.status).toBe('PASS');
    expect(report.checks.find((check) => check.id === 'wasm-execute')).toMatchObject({ status: 'FAIL', backend: 'wasm' });
  });

  it('reports artifact inspection configuration errors once per backend', async () => {
    const report = await run(makeProbes({
      inspectModelArtifacts: vi.fn(async () => { throw new Error('both local and remote models are disabled'); }),
    }));

    expect(report.checks.map(({ id }) => id)).toEqual(expect.arrayContaining([
      'webgpu-artifacts', 'webgpu-compatibility', 'wasm-artifacts', 'wasm-compatibility',
    ]));
    expect(report.checks.filter(({ id }) => id === 'webgpu-artifacts')).toHaveLength(1);
    expect(report.checks.filter(({ id }) => id === 'webgpu-compatibility')).toHaveLength(1);
    expect(report.checks.filter(({ id }) => id === 'wasm-artifacts')).toHaveLength(1);
    expect(report.checks.filter(({ id }) => id === 'wasm-compatibility')).toHaveLength(1);
    expect(report.checks.find(({ id }) => id === 'webgpu-artifacts')).toMatchObject({ status: 'FAIL', backend: 'webgpu' });
    expect(report.checks.find(({ id }) => id === 'wasm-artifacts')).toMatchObject({ status: 'FAIL', backend: 'wasm' });
  });

  it('does not call missing model files a failure and keeps compatibility/inference untested', async () => {
    const report = await run(makeProbes({ inspectModelArtifacts: vi.fn(async () => ({
      webgpu: { cached: false, detail: 'WebGPU files are not downloaded.' },
      wasm: { cached: false, detail: 'WASM files are not downloaded.' },
    })) }));

    expect(report.checks.find((check) => check.id === 'webgpu-artifacts')).toMatchObject({ status: 'NOT TESTED', detail: 'WebGPU files are not downloaded.' });
    expect(report.checks.find((check) => check.id === 'wasm-compatibility')?.status).toBe('NOT TESTED');
    expect(report.checks.find((check) => check.id === 'model-inference')?.status).toBe('NOT TESTED');
    expect(diagnosticRecommendation(report)).toContain('download them explicitly');
  });

  it('recommends the backend that actually passed when the other backend is unavailable', async () => {
    const report = await run(makeProbes({
      webGpuApiAvailable: false,
      inspectModelArtifacts: vi.fn(async () => ({
        webgpu: { cached: false, detail: 'WebGPU model files are not downloaded.' },
        wasm: { cached: false, detail: 'WASM model files are not downloaded.' },
      })),
    }));

    expect(diagnosticRecommendation(report)).toContain('WASM browser checks passed');
    expect(diagnosticRecommendation(report)).toContain('download them explicitly');
  });

  it('fails partial artifacts and incompatible model configuration', async () => {
    const report = await run(makeProbes({ inspectModelArtifacts: vi.fn(async () => ({
      webgpu: { cached: false, incomplete: true, detail: '2 of 7 required WebGPU files are cached.' },
      wasm: { cached: true, compatible: false, detail: 'The model configuration reports an unsupported architecture.' },
    })) }));

    expect(report.checks.find((check) => check.id === 'webgpu-artifacts')).toMatchObject({ status: 'FAIL', backend: 'webgpu' });
    expect(report.checks.find((check) => check.id === 'wasm-artifacts')?.status).toBe('PASS');
    expect(report.checks.find((check) => check.id === 'wasm-compatibility')).toMatchObject({ status: 'FAIL', backend: 'wasm' });
  });

  it('selects a backend only when its browser and model checks pass', () => {
    const report: LocalDiagnosticReport = {
      generatedAt: '2026-10-15T00:00:00Z', browser: 'Chrome', modelId: 'model', modelRevision: 'rev', checks: [
        { id: 'webgpu-compute', label: 'GPU compute', status: 'PASS', detail: 'ok' },
        { id: 'webgpu-compatibility', label: 'GPU model', status: 'FAIL', detail: 'wrong config' },
        { id: 'wasm-execute', label: 'WASM', status: 'PASS', detail: 'ok' },
        { id: 'wasm-compatibility', label: 'WASM model', status: 'PASS', detail: 'ok' },
      ],
    };
    expect(selectDiagnosticBackend(report, ['webgpu', 'wasm'])).toBe('wasm');
    expect(diagnosticRecommendation(report)).toContain('model configuration');
  });

  it('reports a failed grammar check instead of asking to rerun inference', () => {
    const report: LocalDiagnosticReport = {
      generatedAt: '2026-10-15T00:00:00Z', browser: 'Chrome', modelId: 'model', modelRevision: 'rev', checks: [
        { id: 'webgpu-compute', label: 'GPU compute', status: 'PASS', detail: 'ok' },
        { id: 'webgpu-artifacts', label: 'GPU files', status: 'PASS', detail: 'ok' },
        { id: 'webgpu-compatibility', label: 'GPU model', status: 'PASS', detail: 'ok' },
        { id: 'model-inference', label: 'Real model inference', status: 'FAIL', backend: 'webgpu', detail: 'WebGPU (inference-failed): The model returned text, but failed the fixed grammar smoke test. | WASM (inference-failed): The model returned text, but failed the fixed grammar smoke test.' },
      ],
    };

    expect(diagnosticRecommendation(report)).toContain('failed the grammar quality check');
    expect(diagnosticRecommendation(report)).toContain('Use Online');
    expect(diagnosticRecommendation(report)).not.toContain('Run the separate local inference test');
  });

  it('reports successful inference as ready instead of requesting another test', () => {
    const report: LocalDiagnosticReport = {
      generatedAt: '2026-10-15T00:00:00Z', browser: 'Chrome', modelId: 'model', modelRevision: 'rev', checks: [
        { id: 'webgpu-compute', label: 'GPU compute', status: 'PASS', detail: 'ok' },
        { id: 'webgpu-artifacts', label: 'GPU files', status: 'PASS', detail: 'ok' },
        { id: 'webgpu-compatibility', label: 'GPU model', status: 'PASS', detail: 'ok' },
        { id: 'model-inference', label: 'Real model inference', status: 'PASS', backend: 'webgpu', detail: 'Grammar check passed.' },
      ],
    };

    expect(diagnosticRecommendation(report)).toContain('passed on webgpu');
    expect(diagnosticRecommendation(report)).not.toContain('Run the separate local inference test');
  });

  it('redacts authorization, key, and remote URL details before report copy', () => {
    const detail = safeDiagnosticDetail(new Error('Authorization: Bearer secret api_key=abc https://host.example/path?token=secret'));
    expect(detail).not.toContain('secret');
    expect(detail).not.toContain('abc');
    expect(detail).not.toContain('https://');
    const report = {
      generatedAt: '2026-10-15T00:00:00Z', browser: 'Chrome', modelId: 'model', modelRevision: 'rev',
      checks: [{ id: 'asset', label: 'Assets', status: 'FAIL' as const, detail }],
    };
    expect(formatDiagnosticReport(report)).toContain('FAIL  Assets');
    expect(formatDiagnosticReport(report)).not.toContain('secret');
  });

  it('preserves both backend failures and redacts prompt text from the surfaced message', () => {
    const diagnostic = diagnoseLocalBackendFallback(
      new Error('WebGPU adapter initialization failed near she go to school'),
      new Error('WASM runtime failed to load module'),
      ['she go to school'],
    );
    const message = localDiagnosticMessage(diagnostic);

    expect(message).toContain('WebGPU (webgpu-unavailable): WebGPU adapter initialization failed near [prompt redacted]');
    expect(message).toContain('WASM (wasm-unavailable): WASM runtime failed to load module');
    expect(message).not.toContain('she go to school');
    expect(diagnostic.detail).toContain('WebGPU (webgpu-unavailable)');
    expect(diagnostic.detail).toContain('WASM (wasm-unavailable)');
  });
});
