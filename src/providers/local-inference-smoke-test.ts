import type { EnhancementMode } from '../core/types';
import { getLocalModeInstruction, getModeInstruction } from '../core/strategies';

// This is the text being edited, not an instruction for the model to answer.
// Keeping it aligned with typo mode makes the expected result unambiguous.
export const localInferenceSmokePrompt = 'she gos to school yesterday.';
export const localInferenceSmokeExpected = 'She went to school yesterday.';
export const localInferenceSmokeTimeoutMs = 45_000;

export class LocalGenerationOutputError extends Error {
  readonly stage = 'inference' as const;

  constructor(message: string, readonly reason: 'empty-output' | 'timeout' | 'incorrect-output' | 'unreadable-output' | 'unrelated-output' = 'empty-output') {
    super(message);
    this.name = 'LocalGenerationOutputError';
  }
}

export interface LocalSmokeMessage {
  role: 'system' | 'user';
  content: string;
}

export interface LocalSmokeOutput {
  generated_text?: unknown;
}

export type LocalSmokeGenerator = (
  messages: LocalSmokeMessage[],
  options: { max_new_tokens: number; do_sample: true; temperature: number; top_p: number; return_full_text: false },
) => Promise<LocalSmokeOutput[]>;

/** Keep policy in the system role and the user's editable text in the user role. */
export function createLocalEnhancementMessages(mode: EnhancementMode, prompt: string): LocalSmokeMessage[] {
  return [
    { role: 'system', content: getLocalModeInstruction(mode) },
    { role: 'user', content: `Correct the spelling, grammar, and punctuation in this text. Do not answer questions or add explanations. Return only the corrected text:\n\n${prompt}` },
  ];
}

export function extractLocalGeneratedText(output: unknown): string | undefined {
  const first = Array.isArray(output) ? output[0] : output;
  if (!first || typeof first !== 'object') return undefined;
  const generatedText = (first as LocalSmokeOutput).generated_text;
  if (typeof generatedText === 'string') return generatedText;
  if (!Array.isArray(generatedText)) return undefined;
  const assistant = [...generatedText].reverse().find((message) =>
    message && typeof message === 'object'
    && (message as { role?: unknown }).role === 'assistant'
    && typeof (message as { content?: unknown }).content === 'string');
  return assistant ? (assistant as { content: string }).content : undefined;
}

/** Clean common model preambles like "Here is the corrected text:" or surrounding quotes. */
export function cleanLocalGeneratedText(raw: string): string {
  let cleaned = raw.trim();
  cleaned = cleaned.replace(/^(?:here\s+(?:is|are)\s+(?:the\s+)?(?:corrected\s+)?(?:text|sentence|version|prompt)?[:\s-]*)/i, '');
  cleaned = cleaned.replace(/^(?:corrected\s*(?:text|sentence|version|prompt)?[:\s-]*)/i, '');
  cleaned = cleaned.replace(/^(?:output[:\s-]*)/i, '');
  cleaned = cleaned.trim();
  if (cleaned.startsWith('"') && cleaned.endsWith('"') && cleaned.length > 2) {
    cleaned = cleaned.slice(1, -1).trim();
  }
  return cleaned;
}

/** Reject obvious token corruption (for example, punctuation with no words). */
export function isUsableLocalGeneratedText(text: string): boolean {
  const trimmed = text.trim();
  const words = trimmed.match(/[\p{L}]{2,}/gu) ?? [];
  const letterCount = (trimmed.match(/[\p{L}]/gu) ?? []).length;
  return words.length > 0 && letterCount / Math.max(1, [...trimmed].length) >= 0.15;
}

const promptStopWords = new Set([
  'a', 'an', 'and', 'are', 'at', 'be', 'been', 'being', 'but', 'by', 'correct', 'do', 'for', 'from',
  'grammar', 'i', 'im', 'improve', 'in', 'is', 'it', 'its', 'make', 'me', 'my', 'of', 'on', 'or',
  'please', 'prompt', 'punctuation', 'spelling', 'that', 'the', 'these', 'this', 'those', 'to', 'typo',
  'us', 'we', 'were', 'what', 'when', 'where', 'which', 'who', 'with', 'you', 'your',
]);

function tokenDistanceAtMostOne(left: string, right: string): boolean {
  if (left === right) return true;
  if (Math.min(left.length, right.length) < 4 || Math.abs(left.length - right.length) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < left.length && j < right.length) {
    if (left[i] === right[j]) {
      i += 1;
      j += 1;
      continue;
    }
    edits += 1;
    if (edits > 1) return false;
    if (left.length > right.length) i += 1;
    else if (right.length > left.length) j += 1;
    else { i += 1; j += 1; }
  }
  if (i < left.length || j < right.length) edits += 1;
  return edits <= 1;
}

/** Detect conversational answering instead of grammar correction. */
export function isConversationalResponse(prompt: string, result: string): boolean {
  const trimmedPrompt = prompt.trim();
  const trimmedResult = result.trim();
  const lowerPrompt = trimmedPrompt.toLowerCase();
  const lowerResult = trimmedResult.toLowerCase();

  const answerStarters = [
    /^(?:an?\s+[a-z0-9_-]+\s+(?:is|are|stands for|refers to|means)\b)/i,
    /^(?:sure[,!]?|certainly[,!]?|of course[,!]?|i can help|as an ai|as a language model|in general[,!]?|to answer your question)\b/i,
    /^(?:yes[,.]|no[,.])/i,
  ];

  for (const pattern of answerStarters) {
    if (pattern.test(lowerResult) && !pattern.test(lowerPrompt)) {
      return true;
    }
  }

  // If prompt was a short question or sentence, reject answers that blow up in length (e.g. 3x prompt + 40 chars)
  if (trimmedPrompt.length < 60 && trimmedResult.length > Math.max(100, trimmedPrompt.length * 3)) {
    return true;
  }

  return false;
}

/** Reject a chat-style answer that does not preserve any topic from the prompt. */
export function isRelevantLocalEnhancement(prompt: string, result: string): boolean {
  if (isConversationalResponse(prompt, result)) return false;

  const tokenize = (text: string) => (text.toLowerCase().replace(/[’']/g, '').match(/[\p{L}\p{N}]{2,}/gu) ?? [])
    .filter((word) => !promptStopWords.has(word));
  const sourceWords = [...new Set(tokenize(prompt))];
  if (sourceWords.length === 0) return true;
  const resultWords = tokenize(result);
  const matched = sourceWords.filter((source) => resultWords.some((candidate) => tokenDistanceAtMostOne(source, candidate)));
  return matched.length >= 1;
}

export async function runLocalInferenceSmokeTest(
  generator: LocalSmokeGenerator,
  timeoutMs = localInferenceSmokeTimeoutMs,
): Promise<void> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    const output = await Promise.race([
      generator(createLocalEnhancementMessages('typo', localInferenceSmokePrompt), {
        max_new_tokens: 96, do_sample: true, temperature: 0.2, top_p: 0.9, return_full_text: false,
      }),
      new Promise<never>((_resolve, reject) => {
        timeoutId = setTimeout(() => reject(new LocalGenerationOutputError(
          `The model inference smoke test exceeded ${Math.max(1, Math.ceil(timeoutMs / 1000))} seconds.`,
          'timeout',
        )), timeoutMs);
      }),
    ]);
    const text = extractLocalGeneratedText(output);
    if (typeof text !== 'string' || text.trim().length === 0) {
      throw new LocalGenerationOutputError('The model inference smoke test returned no text.');
    }
    const cleaned = cleanLocalGeneratedText(text);
    const normalized = cleaned.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const expected = localInferenceSmokeExpected.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    if (!normalized.includes(expected)) {
      throw new LocalGenerationOutputError(
        'The model returned text, but failed the fixed grammar smoke test.',
        'incorrect-output',
      );
    }
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}
