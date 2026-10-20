import type { EnhancementRequest } from '../core/types';
import { getModeInstruction } from '../core/strategies';
import { ProviderError } from '../core/enhancer';
import type { ModelProvider } from './provider.interface';
import { validateOnlineProviderConfig, type OnlineProviderConfig } from './online-config';
import { recordApiError } from '../services/api-logger';

export class OnlineProviderError extends ProviderError {
  constructor(message: string) {
    super(message);
    this.name = 'OnlineProviderError';
  }
}

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: unknown } }>;
  error?: { message?: unknown };
}

export class OpenAICompatibleProvider implements ModelProvider {
  private readonly config;

  constructor(config: OnlineProviderConfig, private readonly apiKey: string) {
    try {
      this.config = validateOnlineProviderConfig(config);
    } catch (error) {
      void recordApiError({
        provider: 'OpenAI-Compatible',
        model: config?.model ?? 'unknown-model',
        operation: 'preparation',
        error,
        stage: 'preparation',
        category: 'client_error',
        endpointUrl: config?.baseUrl,
      });
      throw error;
    }
    if (!apiKey.trim()) {
      const error = new OnlineProviderError('Add an API key in settings before using Online mode.');
      void recordApiError({
        provider: 'OpenAI-Compatible',
        model: this.config.model,
        operation: 'preparation',
        error,
        stage: 'preparation',
        category: 'authentication',
        endpointUrl: this.config.endpointUrl,
      });
      throw error;
    }
  }

  async enhance(request: EnhancementRequest, signal?: AbortSignal): Promise<string> {
    return this.complete([
      { role: 'system', content: getModeInstruction(request.mode) },
      { role: 'user', content: request.prompt },
    ], signal, 45_000, 'enhance');
  }

  async testConnection(signal?: AbortSignal): Promise<void> {
    await this.complete([
      { role: 'user', content: 'Reply with the single word OK.' },
    ], signal, 15_000, 'testConnection');
  }

  private async complete(
    messages: Array<{ role: 'system' | 'user'; content: string }>,
    signal: AbortSignal | undefined,
    timeoutMs: number,
    operation: 'enhance' | 'testConnection' = 'enhance',
  ): Promise<string> {
    const startTime = Date.now();
    const correlationId = `corr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    let httpStatus: number | null = null;
    let httpStatusText: string | null = null;

    if (signal?.aborted) {
      const abortError = new DOMException('Request cancelled', 'AbortError');
      void recordApiError({
        correlationId,
        provider: 'OpenAI-Compatible',
        model: this.config.model,
        operation,
        error: abortError,
        stage: 'transport',
        category: 'aborted',
        severity: 'warning',
        endpointUrl: this.config.endpointUrl,
        durationMs: 0,
      });
      throw abortError;
    }

    const controller = new AbortController();
    let timedOut = false;
    const timeout = globalThis.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    const relayAbort = () => controller.abort();
    signal?.addEventListener('abort', relayAbort, { once: true });

    try {
      const response = await fetch(this.config.endpointUrl, {
        method: 'POST',
        redirect: 'error',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({ model: this.config.model, messages }),
        signal: controller.signal,
      });

      httpStatus = response.status;
      httpStatusText = response.statusText;

      if (!response.ok) {
        let detail = '';
        try {
          const errorBody = await response.json() as ChatCompletionResponse | null;
          if (errorBody?.error?.message && typeof errorBody.error.message === 'string') {
            detail = `: ${errorBody.error.message}`;
          }
        } catch {
          // ignore JSON parsing errors
        }

        let err: OnlineProviderError;
        if (response.status === 401 || response.status === 403) {
          err = new OnlineProviderError(detail ? `The endpoint rejected the API key${detail}` : 'The endpoint rejected the API key. Check the key in settings.');
        } else if (response.status === 404) {
          err = new OnlineProviderError(`The model or endpoint was not found (HTTP 404)${detail || '. Check the model name and URL.'}`);
        } else if (response.status === 429) {
          err = new OnlineProviderError('The endpoint is rate limiting requests. Wait a moment and try again.');
        } else if (response.status >= 500) {
          err = new OnlineProviderError(`The endpoint is temporarily unavailable (HTTP ${response.status}).`);
        } else {
          err = new OnlineProviderError(`The endpoint returned HTTP ${response.status}${detail || '. Check the endpoint and model settings.'}`);
        }

        void recordApiError({
          correlationId,
          provider: 'OpenAI-Compatible',
          model: this.config.model,
          operation,
          error: err,
          httpStatus,
          httpStatusText,
          endpointUrl: this.config.endpointUrl,
          durationMs: Date.now() - startTime,
        });

        throw err;
      }

      let payload: ChatCompletionResponse;
      try {
        payload = await response.json() as ChatCompletionResponse;
      } catch {
        const parseErr = new OnlineProviderError('The endpoint returned an unreadable response. Check that it supports chat completions.');
        void recordApiError({
          correlationId,
          provider: 'OpenAI-Compatible',
          model: this.config.model,
          operation,
          error: parseErr,
          stage: 'parsing',
          category: 'malformed_response',
          httpStatus,
          httpStatusText,
          endpointUrl: this.config.endpointUrl,
          durationMs: Date.now() - startTime,
        });
        throw parseErr;
      }

      const content = payload.choices?.[0]?.message?.content;
      if (typeof content !== 'string' || !content.trim()) {
        const emptyErr = new OnlineProviderError('The endpoint returned no prompt text. Check that the selected model supports chat completions.');
        void recordApiError({
          correlationId,
          provider: 'OpenAI-Compatible',
          model: this.config.model,
          operation,
          error: emptyErr,
          stage: 'output_validation',
          category: 'empty_output',
          httpStatus,
          httpStatusText,
          endpointUrl: this.config.endpointUrl,
          durationMs: Date.now() - startTime,
        });
        throw emptyErr;
      }

      return content;
    } catch (error) {
      const durationMs = Date.now() - startTime;
      if (signal?.aborted) {
        const abortErr = new DOMException('Request cancelled', 'AbortError');
        void recordApiError({
          correlationId,
          provider: 'OpenAI-Compatible',
          model: this.config.model,
          operation,
          error: abortErr,
          stage: 'transport',
          category: 'aborted',
          severity: 'warning',
          httpStatus,
          httpStatusText,
          endpointUrl: this.config.endpointUrl,
          durationMs,
        });
        throw abortErr;
      }
      if (timedOut) {
        const timeoutErr = new OnlineProviderError('The request timed out. Try again or check the endpoint.');
        void recordApiError({
          correlationId,
          provider: 'OpenAI-Compatible',
          model: this.config.model,
          operation,
          error: timeoutErr,
          stage: 'transport',
          category: 'timeout',
          severity: 'warning',
          httpStatus,
          httpStatusText,
          endpointUrl: this.config.endpointUrl,
          durationMs,
        });
        throw timeoutErr;
      }
      if (error instanceof OnlineProviderError) {
        throw error;
      }
      const networkErr = new OnlineProviderError('Could not reach the endpoint. Check the HTTPS URL and your connection.');
      void recordApiError({
        correlationId,
        provider: 'OpenAI-Compatible',
        model: this.config.model,
        operation,
        error: networkErr,
        stage: 'transport',
        category: 'network',
        httpStatus,
        httpStatusText,
        endpointUrl: this.config.endpointUrl,
        durationMs,
      });
      throw networkErr;
    } finally {
      globalThis.clearTimeout(timeout);
      signal?.removeEventListener('abort', relayAbort);
    }
  }
}
