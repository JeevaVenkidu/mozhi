import type { EnhancementRequest } from '../core/types';

/** A provider transforms a prompt without taking over the user's workflow. */
export interface ModelProvider {
  enhance(request: EnhancementRequest, signal?: AbortSignal): Promise<string>;
}
