import type { ModelProvider } from '../providers/provider.interface';
import type { EnhancementRequest } from './types';
import { validateRequest, validateResult, ValidationError } from './validation';

export class ProviderError extends Error {
  constructor(message = 'The selected provider could not enhance this prompt.', options?: ErrorOptions) {
    super(message, options);
    this.name = 'ProviderError';
  }
}

export async function enhancePrompt(
  request: EnhancementRequest,
  provider: ModelProvider,
  signal?: AbortSignal,
): Promise<string> {
  const validatedRequest = validateRequest(request);
  let result: unknown;
  try {
    result = await provider.enhance(validatedRequest, signal);
  } catch (error) {
    if (signal?.aborted || (error instanceof DOMException && error.name === 'AbortError')) throw error;
    if (error instanceof ProviderError) throw error;
    throw new ProviderError(undefined, { cause: error });
  }
  return validateResult(result);
}

export { ValidationError };
