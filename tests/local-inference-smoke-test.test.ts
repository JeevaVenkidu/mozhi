import { describe, expect, it, vi } from 'vitest';
import {
  cleanLocalGeneratedText,
  createLocalEnhancementMessages,
  extractLocalGeneratedText,
  isConversationalResponse,
  isRelevantLocalEnhancement,
  isUsableLocalGeneratedText,
  LocalGenerationOutputError,
  localInferenceSmokePrompt,
  runLocalInferenceSmokeTest,
} from '../src/providers/local-inference-smoke-test';

describe('local inference smoke test', () => {
  it('extracts generated content from supported pipeline output shapes', () => {
    expect(extractLocalGeneratedText([{ generated_text: [{ role: 'assistant', content: 'She went.' }] }])).toBe('She went.');
    expect(extractLocalGeneratedText({ generated_text: 'She went.' })).toBe('She went.');
    expect(extractLocalGeneratedText([{ generated_text: [{ role: 'assistant', content: '' }] }])).toBe('');
    expect(isUsableLocalGeneratedText('<@!A</=/-,$\' $@/6!&9=#31>)3+>*')).toBe(false);
    expect(isUsableLocalGeneratedText('Correct the grammar: She went to school yesterday.')).toBe(true);
    expect(isRelevantLocalEnhancement('hell im jeeva', "I'm ready to assist. What's your question or prompt?")).toBe(false);
    expect(isRelevantLocalEnhancement('hell im jeeva', "Hello, I'm Jeeva.")).toBe(true);
  });

  it('cleans conversational preambles and outer quotes from generated text', () => {
    expect(cleanLocalGeneratedText('Here is the corrected text: What is an API?')).toBe('What is an API?');
    expect(cleanLocalGeneratedText('Corrected sentence: She went to school yesterday.')).toBe('She went to school yesterday.');
    expect(cleanLocalGeneratedText('"What is an API?"')).toBe('What is an API?');
    expect(cleanLocalGeneratedText('Already clean text.')).toBe('Already clean text.');
  });

  it('detects conversational responses that answer questions instead of correcting text', () => {
    expect(isConversationalResponse('whet is api', 'An API (Application Programming Interface) is a computing interface that defines interactions between multiple software intermediaries.')).toBe(true);
    expect(isConversationalResponse('whet is api', 'Sure! I can help you with that. An API is...')).toBe(true);
    expect(isConversationalResponse('whet is api', 'What is an API?')).toBe(false);
    expect(isConversationalResponse('What is an API?', 'What is an API?')).toBe(false);
    expect(isConversationalResponse('fix getUserData() functoin', 'fix getUserData() function')).toBe(false);
  });

  it('puts narrow grammar rules in the system role and uses explicit non-conversational task prompt', async () => {
    const generator = vi.fn(async () => [{ generated_text: [{ role: 'assistant', content: 'She went to school yesterday.' }] }]);

    await expect(runLocalInferenceSmokeTest(generator)).resolves.toBeUndefined();
    const messages = createLocalEnhancementMessages('typo', localInferenceSmokePrompt);
    expect(messages).toEqual([
      { role: 'system', content: expect.stringContaining('You are an English grammar and spelling fixer.') },
      { role: 'user', content: `Correct the spelling, grammar, and punctuation in this text. Do not answer questions or add explanations. Return only the corrected text:\n\n${localInferenceSmokePrompt}` },
    ]);
    expect(generator).toHaveBeenCalledWith(messages, {
      max_new_tokens: 96,
      do_sample: true,
      temperature: 0.2,
      top_p: 0.9,
      return_full_text: false,
    });
  });

  it('rejects an empty model response', async () => {
    await expect(runLocalInferenceSmokeTest(async () => [{ generated_text: '  ' }]))
      .rejects.toMatchObject({ name: 'LocalGenerationOutputError', stage: 'inference', reason: 'empty-output' } satisfies Partial<LocalGenerationOutputError>);
  });

  it('does not count arbitrary non-empty text as a passing smoke test', async () => {
    await expect(runLocalInferenceSmokeTest(async () => [{ generated_text: 'She go to school yesterday.' }]))
      .rejects.toMatchObject({ reason: 'incorrect-output' } satisfies Partial<LocalGenerationOutputError>);
  });

  it('rejects an inference response that exceeds the timeout', async () => {
    await expect(runLocalInferenceSmokeTest(() => new Promise(() => {}), 5))
      .rejects.toThrow('exceeded 1 seconds');
  });
});
