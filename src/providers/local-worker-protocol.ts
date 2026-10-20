import type { EnhancementRequest } from '../core/types';
import type { LocalInferenceProgress } from './local-model-config';
import type { DiagnosticProgress, LocalDiagnosticReport, LocalModelDiagnostic } from './local-diagnostics';

export type LocalWorkerRequest =
  | { id: number; type: 'enhance'; request: EnhancementRequest; preferredBackend?: 'webgpu' | 'wasm' }
  | { id: number; type: 'model-status' }
  | { id: number; type: 'run-diagnostics' }
  | { id: number; type: 'verify-model'; backend?: 'webgpu' | 'wasm' }
  | { id: number; type: 'download-model'; backend?: 'webgpu' | 'wasm' }
  | { id: number; type: 'delete-model' };

export type LocalWorkerResponse =
  | { id: number; type: 'progress'; progress: LocalInferenceProgress }
  | { id: number; type: 'result'; result: string }
  | { id: number; type: 'model-status'; downloaded: boolean; backend?: 'webgpu' | 'wasm'; backends: Array<'webgpu' | 'wasm'> }
  | { id: number; type: 'diagnostic-progress'; progress: DiagnosticProgress }
  | { id: number; type: 'diagnostics-complete'; report: LocalDiagnosticReport }
  | { id: number; type: 'model-downloaded'; backend: 'webgpu' | 'wasm' }
  | { id: number; type: 'model-verified'; backend: 'webgpu' | 'wasm' }
  | { id: number; type: 'model-deleted'; deleted: boolean }
  | { id: number; type: 'error'; message: string; diagnostic?: LocalModelDiagnostic };
