import { modes, type EnhancementRequest } from './types';

export const MAX_PROMPT_LENGTH = 20_000;
export const LOCAL_MAX_PROMPT_LENGTH = 300;
export const MAX_RESULT_LENGTH = 30_000;

export type ValidationErrorCode = 'empty_input' | 'input_too_long' | 'empty_output' | 'output_too_long' | 'invalid_mode';

export class ValidationError extends Error {
  constructor(readonly code: ValidationErrorCode, message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

export function validateLocalRequest(request: EnhancementRequest): EnhancementRequest {
  if (request.mode !== 'typo') {
    throw new ValidationError('invalid_mode', 'Local model only supports Typo & Grammar Fix mode. Switch to Online BYOK for other modes.');
  }
  const validated = validateRequest(request);
  if (validated.prompt.length > LOCAL_MAX_PROMPT_LENGTH) {
    throw new ValidationError(
      'input_too_long',
      `Local prompt correction is provisionally limited to ${LOCAL_MAX_PROMPT_LENGTH} characters (currently ${validated.prompt.length}). Shorten your text or switch to Online BYOK.`,
    );
  }
  return validated;
}

export function validateRequest(request: EnhancementRequest): EnhancementRequest {
  if (!request || typeof request.prompt !== 'string') {
    throw new ValidationError('empty_input', 'Enter a prompt to enhance.');
  }

  const prompt = request.prompt.trim();
  if (!prompt) throw new ValidationError('empty_input', 'Enter a prompt to enhance.');
  if (prompt.length > MAX_PROMPT_LENGTH) {
    throw new ValidationError('input_too_long', `Prompts must be ${MAX_PROMPT_LENGTH.toLocaleString()} characters or fewer.`);
  }
  if (!modes.includes(request.mode)) {
    throw new ValidationError('invalid_mode', 'Choose a supported enhancement mode.');
  }
  return { prompt, mode: request.mode };
}

export function validateResult(result: unknown): string {
  if (typeof result !== 'string') {
    throw new ValidationError('empty_output', 'The provider returned an invalid result. Your original prompt is unchanged.');
  }
  const normalized = result.trim();
  if (!normalized) {
    throw new ValidationError('empty_output', 'The provider returned an empty result. Your original prompt is unchanged.');
  }
  if (normalized.length > MAX_RESULT_LENGTH) {
    throw new ValidationError('output_too_long', 'The result was too long to display safely. Your original prompt is unchanged.');
  }
  return normalized;
}
