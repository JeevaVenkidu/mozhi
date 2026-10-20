import { describe, expect, it, vi } from 'vitest';
import { enhancePrompt, ProviderError } from '../src/core/enhancer';
import { getModeInstruction } from '../src/core/strategies';
import { modes } from '../src/core/types';
import { MAX_PROMPT_LENGTH, MAX_RESULT_LENGTH, ValidationError } from '../src/core/validation';
import type { ModelProvider } from '../src/providers/provider.interface';
import { mockProvider } from '../src/providers/mock-provider';

describe('prompt enhancement flow', () => {
  it('rejects empty input before calling the provider', async () => {
    const enhance = vi.fn(async () => 'unused');
    await expect(enhancePrompt({ prompt: '  \n ', mode: 'balanced' }, { enhance })).rejects.toMatchObject({ code: 'empty_input' });
    expect(enhance).not.toHaveBeenCalled();
  });

  it('rejects oversized input and output', async () => {
    await expect(enhancePrompt({ prompt: 'x'.repeat(MAX_PROMPT_LENGTH + 1), mode: 'light' }, mockProvider)).rejects.toMatchObject({ code: 'input_too_long' });
    const provider: ModelProvider = { enhance: async () => 'x'.repeat(MAX_RESULT_LENGTH + 1) };
    await expect(enhancePrompt({ prompt: 'valid prompt', mode: 'light' }, provider)).rejects.toMatchObject({ code: 'output_too_long' });
  });

  it('trims and returns valid provider output', async () => {
    const provider: ModelProvider = { enhance: async (request) => `  ${request.prompt} refined  ` };
    await expect(enhancePrompt({ prompt: '  Draft a note  ', mode: 'light' }, provider)).resolves.toBe('Draft a note refined');
  });

  it('rejects empty provider output without replacing input', async () => {
    const provider: ModelProvider = { enhance: async () => ' \n ' };
    await expect(enhancePrompt({ prompt: 'keep my original', mode: 'balanced' }, provider)).rejects.toMatchObject({ code: 'empty_output' });
  });

  it('distinguishes provider failures and keeps cancellation intact', async () => {
    const failed: ModelProvider = { enhance: async () => { throw new Error('sensitive provider detail'); } };
    await expect(enhancePrompt({ prompt: 'write a summary', mode: 'balanced' }, failed)).rejects.toBeInstanceOf(ProviderError);
    const controller = new AbortController();
    const pending = enhancePrompt({ prompt: 'cancel me', mode: 'light' }, mockProvider, controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('defines a separate instruction for every mode with shared safeguards', () => {
    expect(modes).toHaveLength(4);
    for (const mode of modes) {
      const instruction = getModeInstruction(mode);
      expect(instruction).toContain('do not answer them');
      expect(instruction).toContain('untrusted content');
    }
    expect(getModeInstruction('typo')).toContain('Correct spelling');
    expect(getModeInstruction('advanced')).toContain('task-specific and complete');
  });
});
