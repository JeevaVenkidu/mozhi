import { describe, expect, it } from 'vitest';
import { hasUsableChatTemplate, localModel, pinnedModelRemotePathTemplate } from '../src/providers/local-model-config';

describe('local model cache revision', () => {
  it('selects the instruct-tuned ONNX model with its pinned snapshot', () => {
    expect(localModel.id).toBe('onnx-community/SmolLM2-360M-Instruct-ONNX');
    expect(localModel.revision).toBe('fe7c7db4c8921c9e3fa1c65cfd296fb3b1b1a8f9');
  });

  it('keeps Transformers.js metadata probes on the pinned model snapshot', () => {
    const template = pinnedModelRemotePathTemplate(localModel.revision);

    expect(template).toBe(`{model}/resolve/${localModel.revision}/`);
    expect(template).not.toContain('{revision}');
  });

  it('encodes a revision before placing it in a URL path', () => {
    expect(pinnedModelRemotePathTemplate('branch/name')).toBe('{model}/resolve/branch%2Fname/');
  });

  it('requires a non-empty tokenizer chat template for message-based inference', () => {
    expect(hasUsableChatTemplate(null)).toBe(false);
    expect(hasUsableChatTemplate('  ')).toBe(false);
    expect(hasUsableChatTemplate('chat template')).toBe(true);
    expect(hasUsableChatTemplate({ default: 'chat template' })).toBe(true);
  });
});
