import type { ModelProvider } from './provider.interface';
import type { EnhancementRequest } from '../core/types';

const additions: Record<Exclude<EnhancementRequest['mode'], 'typo'>, string> = {
  light: 'Keep the answer concise and practical.',
  balanced: 'Include useful context, a clear structure, and actionable next steps.',
  advanced: 'State assumptions, organize the response clearly, and include relevant edge cases.',
};

export const mockProvider: ModelProvider = {
  async enhance(request, signal) {
    await new Promise<void>((resolve, reject) => {
      if (signal?.aborted) {
        reject(new DOMException('Enhancement cancelled', 'AbortError'));
        return;
      }
      const timeout = globalThis.setTimeout(resolve, 420);
      signal?.addEventListener('abort', () => {
        globalThis.clearTimeout(timeout);
        reject(new DOMException('Enhancement cancelled', 'AbortError'));
      }, { once: true });
    });

    const prompt = request.prompt.replace(/\s+/g, ' ');
    const polished = `${prompt.charAt(0).toUpperCase()}${prompt.slice(1)}`;
    if (request.mode === 'typo') return polished;
    return `${polished}\n\n${additions[request.mode]}`;
  },
};
