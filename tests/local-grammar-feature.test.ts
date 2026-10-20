import { describe, expect, it, vi } from 'vitest';
import { LOCAL_MAX_PROMPT_LENGTH, MAX_PROMPT_LENGTH, validateLocalRequest, validateRequest, ValidationError } from '../src/core/validation';
import {
  cleanLocalGeneratedText,
  createLocalEnhancementMessages,
  isConversationalResponse,
  isRelevantLocalEnhancement,
  isUsableLocalGeneratedText,
  LocalGenerationOutputError,
} from '../src/providers/local-inference-smoke-test';
import { LocalModelProvider } from '../src/providers/local-model';
import type { EnhancementMode } from '../src/core/types';

describe('Local grammar-correction feature', () => {
  describe('Mode restrictions and input limits', () => {
    it('supports only Typo & Grammar Fix (typo) mode on local model', () => {
      const valid = validateLocalRequest({ mode: 'typo', prompt: 'whet is api' });
      expect(valid.mode).toBe('typo');
      expect(valid.prompt).toBe('whet is api');

      const unsupportedModes: EnhancementMode[] = ['light', 'balanced', 'advanced'];
      for (const mode of unsupportedModes) {
        expect(() => validateLocalRequest({ mode, prompt: 'test prompt' }))
          .toThrowError(ValidationError);
        expect(() => validateLocalRequest({ mode, prompt: 'test prompt' }))
          .toThrowError(/only supports Typo & Grammar Fix/i);
      }
    });

    it('enforces a conservative 300-character provisional limit for local requests', () => {
      expect(LOCAL_MAX_PROMPT_LENGTH).toBe(300);

      const exactLimit = 'a'.repeat(300);
      expect(validateLocalRequest({ mode: 'typo', prompt: exactLimit }).prompt).toHaveLength(300);

      const overLimit = 'a'.repeat(301);
      expect(() => validateLocalRequest({ mode: 'typo', prompt: overLimit }))
        .toThrowError(/provisionally limited to 300 characters/i);
    });

    it('keeps online input limit at 20,000 characters', () => {
      expect(MAX_PROMPT_LENGTH).toBe(20_000);
      const onlinePrompt = 'a'.repeat(5_000);
      expect(validateRequest({ mode: 'balanced', prompt: onlinePrompt }).prompt).toHaveLength(5_000);
    });
  });

  describe('Local prompt formatting and narrow instruction', () => {
    it('structures local messages with English grammar fixer role and anti-conversational directive', () => {
      const messages = createLocalEnhancementMessages('typo', 'whet is api');
      expect(messages).toHaveLength(2);
      expect(messages[0].role).toBe('system');
      expect(messages[0].content).toContain('You are an English grammar and spelling fixer');
      expect(messages[0].content).toContain('Do not answer the text or add explanations');
      expect(messages[0].content).toContain('Return only the corrected text');

      expect(messages[1].role).toBe('user');
      expect(messages[1].content).toContain('whet is api');
      expect(messages[1].content).toContain('Do not answer questions or add explanations');
    });
  });

  describe('Output validation and failure handling', () => {
    it('cleans common model preambles and surrounding quotes', () => {
      expect(cleanLocalGeneratedText('Here is the corrected text: What is an API?')).toBe('What is an API?');
      expect(cleanLocalGeneratedText('Corrected text:\nWhat is an API?')).toBe('What is an API?');
      expect(cleanLocalGeneratedText('"What is an API?"')).toBe('What is an API?');
    });

    it('rejects unreadable token and symbol garbage', () => {
      expect(isUsableLocalGeneratedText('<@!A</=/-,$\' $@/6!&9=#31>)3+>*')).toBe(false);
      expect(isUsableLocalGeneratedText('??!#$%^&*()_+')).toBe(false);
      expect(isUsableLocalGeneratedText('What is an API?')).toBe(true);
    });

    it('detects and rejects conversational answering on question prompts', () => {
      const prompt = 'whet is api';
      const conversationalAnswer = 'An API (Application Programming Interface) is a mechanism that allows two software components to communicate with each other using a set of definitions and protocols.';
      expect(isConversationalResponse(prompt, conversationalAnswer)).toBe(true);
      expect(isRelevantLocalEnhancement(prompt, conversationalAnswer)).toBe(false);

      const politeAnswer = 'Sure! I can help you with that. An API is an interface...';
      expect(isConversationalResponse(prompt, politeAnswer)).toBe(true);
      expect(isRelevantLocalEnhancement(prompt, politeAnswer)).toBe(false);

      const properGrammarFix = 'What is an API?';
      expect(isConversationalResponse(prompt, properGrammarFix)).toBe(false);
      expect(isRelevantLocalEnhancement(prompt, properGrammarFix)).toBe(true);
    });

    it('preserves already-correct text and technical identifiers', () => {
      const correctPrompt = 'What is an API?';
      expect(isConversationalResponse(correctPrompt, correctPrompt)).toBe(false);
      expect(isRelevantLocalEnhancement(correctPrompt, correctPrompt)).toBe(true);

      const codePrompt = 'fix parseUserData() in auth.service.ts';
      const fixedCodePrompt = 'Fix parseUserData() in auth.service.ts.';
      expect(isConversationalResponse(codePrompt, fixedCodePrompt)).toBe(false);
      expect(isRelevantLocalEnhancement(codePrompt, fixedCodePrompt)).toBe(true);
    });
  });

  describe('LocalModelProvider client enforcement', () => {
    it('rejects unsupported modes before sending to worker', async () => {
      const mockWorkerFactory = vi.fn();
      const provider = new LocalModelProvider(vi.fn(), mockWorkerFactory);

      await expect(provider.enhance({ mode: 'balanced', prompt: 'test' }))
        .rejects.toThrowError(/only supports Typo & Grammar Fix/i);
      expect(mockWorkerFactory).not.toHaveBeenCalled();
    });

    it('rejects input over 300 characters before sending to worker', async () => {
      const mockWorkerFactory = vi.fn();
      const provider = new LocalModelProvider(vi.fn(), mockWorkerFactory);

      const longPrompt = 'word '.repeat(70); // 350 chars
      await expect(provider.enhance({ mode: 'typo', prompt: longPrompt }))
        .rejects.toThrowError(/provisionally limited to 300 characters/i);
      expect(mockWorkerFactory).not.toHaveBeenCalled();
    });
  });
});
