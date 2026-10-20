export const localModel = {
  id: 'onnx-community/SmolLM2-360M-Instruct-ONNX',
  revision: 'fe7c7db4c8921c9e3fa1c65cfd296fb3b1b1a8f9',
  cacheName: 'mozhi-local-model-cache',
  label: 'SmolLM2 360M Instruct',
  expectedModelType: 'llama',
  expectedArchitecture: 'LlamaForCausalLM',
  approximateDownloadMb: 272,
  approximateWasmDownloadMb: 386,
  license: 'Apache-2.0',
} as const;

/** Pins every Transformers.js lookup (including metadata probes that omit revision) to this model snapshot. */
export function pinnedModelRemotePathTemplate(revision: string): string {
  return `{model}/resolve/${encodeURIComponent(revision)}/`;
}

export function hasUsableChatTemplate(template: unknown): boolean {
  if (typeof template === 'string') return template.trim().length > 0;
  return Boolean(template && typeof template === 'object' && !Array.isArray(template)
    && Object.values(template).some((value) => typeof value === 'string' && value.trim().length > 0));
}

export const localModelOrigins = [
  'https://huggingface.co/*',
  'https://*.huggingface.co/*',
  'https://*.hf.co/*',
];

export interface LocalInferenceProgress {
  stage: 'loading' | 'downloading' | 'generating' | 'fallback';
  progress?: number;
  file?: string;
}
