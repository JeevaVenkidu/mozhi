import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  recordApiError,
  classifyApiError,
  loadApiErrorLogs,
  saveApiErrorLogs,
  clearApiErrorLogs,
  appendApiErrorLog,
  API_ERROR_LOGS_STORAGE_KEY,
  MAX_LOG_ENTRIES,
  sanitizeErrorMessage,
  sanitizeUrl,
  sanitizeLogForExport,
  formatDiagnosticReportText,
  type ApiErrorLogEntry,
} from '../src/services/api-logger';
import { OpenAICompatibleProvider, OnlineProviderError } from '../src/providers/openai-compatible';

function stubStorage() {
  const store: Record<string, unknown> = {};
  const local = {
    get: vi.fn(async (key: string | string[]) => {
      if (typeof key === 'string') return { [key]: store[key] };
      const res: Record<string, unknown> = {};
      for (const k of key) res[k] = store[k];
      return res;
    }),
    set: vi.fn(async (items: Record<string, unknown>) => {
      Object.assign(store, items);
    }),
    remove: vi.fn(async (keys: string | string[]) => {
      for (const key of Array.isArray(keys) ? keys : [keys]) delete store[key];
    }),
  };
  vi.stubGlobal('chrome', { storage: { local } });
  return { store, local };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('API Error Classification', () => {
  it('classifies HTTP 401 as authentication failure in http stage', () => {
    const res = classifyApiError(new Error('Unauthorized'), 401);
    expect(res).toEqual({ stage: 'http', category: 'authentication', severity: 'error' });
  });

  it('classifies HTTP 403 as authorization failure in http stage', () => {
    const res = classifyApiError(new Error('Forbidden'), 403);
    expect(res).toEqual({ stage: 'http', category: 'authorization', severity: 'error' });
  });

  it('classifies HTTP 404 as not_found failure in http stage', () => {
    const res = classifyApiError(new Error('Not Found'), 404);
    expect(res).toEqual({ stage: 'http', category: 'not_found', severity: 'error' });
  });

  it('classifies HTTP 429 as rate_limit warning in http stage', () => {
    const res = classifyApiError(new Error('Too Many Requests'), 429);
    expect(res).toEqual({ stage: 'http', category: 'rate_limit', severity: 'warning' });
  });

  it('classifies HTTP 5xx as server_error in http stage', () => {
    const res500 = classifyApiError(new Error('Internal Server Error'), 500);
    expect(res500).toEqual({ stage: 'http', category: 'server_error', severity: 'error' });

    const res503 = classifyApiError(new Error('Service Unavailable'), 503);
    expect(res503).toEqual({ stage: 'http', category: 'server_error', severity: 'error' });
  });

  it('classifies network failures and connection drops', () => {
    const res = classifyApiError(new TypeError('Failed to fetch'));
    expect(res).toEqual({ stage: 'transport', category: 'network', severity: 'error' });
  });

  it('classifies timeouts as transport warning', () => {
    const res = classifyApiError(new Error('The request timed out.'));
    expect(res).toEqual({ stage: 'transport', category: 'timeout', severity: 'warning' });
  });

  it('classifies aborted requests as transport warning', () => {
    const abortDom = new DOMException('Request cancelled', 'AbortError');
    expect(classifyApiError(abortDom)).toEqual({ stage: 'transport', category: 'aborted', severity: 'warning' });

    const abortMsg = new Error('Operation was cancelled by user');
    expect(classifyApiError(abortMsg)).toEqual({ stage: 'transport', category: 'aborted', severity: 'warning' });
  });

  it('classifies JSON syntax and malformed responses as parsing errors', () => {
    const res = classifyApiError(new SyntaxError('Unexpected token < in JSON at position 0'));
    expect(res).toEqual({ stage: 'parsing', category: 'malformed_response', severity: 'error' });
  });

  it('classifies empty or unusable model outputs as output_validation errors', () => {
    const res = classifyApiError(new Error('The endpoint returned no prompt text'));
    expect(res).toEqual({ stage: 'output_validation', category: 'empty_output', severity: 'error' });
  });

  it('classifies streaming interruptions as streaming failures', () => {
    const res = classifyApiError(new Error('SSE stream was interrupted unexpectedly'));
    expect(res).toEqual({ stage: 'streaming', category: 'network', severity: 'error' });
  });

  it('handles unknown error formats gracefully without assuming root cause', () => {
    const res1 = classifyApiError({ weird: 'object' });
    expect(res1).toEqual({ stage: 'unknown', category: 'unknown', severity: 'error' });

    const res2 = classifyApiError('arbitrary string error');
    expect(res2).toEqual({ stage: 'unknown', category: 'unknown', severity: 'error' });
  });
});

describe('Sanitization & Privacy Protection', () => {
  it('strips Bearer tokens from error messages', () => {
    const sanitized = sanitizeErrorMessage('Error calling API: Bearer sk-ant-api03-abcdef123456789');
    expect(sanitized).not.toContain('abcdef123456789');
    expect(sanitized).toContain('Bearer [REDACTED]');
  });

  it('strips OpenAI-style sk- keys', () => {
    const sanitized = sanitizeErrorMessage('Failed key sk-1234567890abcdef1234567890 in request');
    expect(sanitized).not.toContain('1234567890abcdef1234567890');
    expect(sanitized).toContain('[REDACTED_API_KEY]');
  });

  it('strips Google AIza keys', () => {
    const sanitized = sanitizeErrorMessage('API key AIzaSyA1234567890123456789012345678901 rejected');
    expect(sanitized).not.toContain('AIzaSyA1234567890123456789012345678901');
    expect(sanitized).toContain('[REDACTED_API_KEY]');
  });

  it('strips sensitive query parameters from URLs in messages', () => {
    const msg = 'Request failed: https://api.example.com/v1/chat?api_key=secret123&prompt=hello%20world';
    const sanitized = sanitizeErrorMessage(msg);
    expect(sanitized).not.toContain('secret123');
    expect(sanitized).not.toContain('hello%20world');
    expect(sanitized).toContain('?[REDACTED_QUERY]');
  });

  it('strips embedded credentials in URLs', () => {
    const msg = 'Connecting to https://admin:supersecret@api.example.com/v1 failed';
    const sanitized = sanitizeErrorMessage(msg);
    expect(sanitized).not.toContain('supersecret');
    expect(sanitized).toContain('[REDACTED_USER_INFO]');
  });

  it('sanitizes URLs into clean origin and path without query or credentials', () => {
    const parts = sanitizeUrl('https://user:pass@api.openai.com/v1/chat/completions?version=2&debug=1#frag');
    expect(parts.origin).toBe('https://api.openai.com');
    expect(parts.path).toBe('/v1/chat/completions');
  });

  it('truncates excessively long error messages to prevent prompt leak or storage bloat', () => {
    const giant = 'A'.repeat(2000);
    const sanitized = sanitizeErrorMessage(giant, 200);
    expect(sanitized.length).toBeLessThan(250);
    expect(sanitized).toContain('[truncated]');
  });

  it('applies second-pass sanitization before export', () => {
    const entry: ApiErrorLogEntry = {
      id: 'err_1',
      correlationId: 'corr_1',
      timestamp: Date.now(),
      provider: 'OpenAI-Compatible',
      model: 'gpt-4o',
      operation: 'enhance',
      stage: 'http',
      category: 'authentication',
      severity: 'error',
      httpStatus: 401,
      httpStatusText: 'Unauthorized',
      errorName: 'OnlineProviderError',
      errorMessage: 'Key sk-secret99887766 rejected with Authorization: Bearer badtoken',
      endpointOrigin: 'https://api.openai.com',
      endpointPath: '/v1/chat/completions',
      durationMs: 150,
      retryCount: 0,
    };

    const exported = sanitizeLogForExport(entry);
    expect(exported.errorMessage).not.toContain('sk-secret99887766');
    expect(exported.errorMessage).not.toContain('badtoken');
    expect(exported.errorMessage).toContain('[REDACTED_API_KEY]');
  });

  it('generates a clean markdown diagnostic report', () => {
    const entry: ApiErrorLogEntry = {
      id: 'err_1',
      correlationId: 'corr_test_123',
      timestamp: 1700000000000,
      provider: 'OpenAI-Compatible',
      model: 'gpt-4o',
      operation: 'enhance',
      stage: 'http',
      category: 'rate_limit',
      severity: 'warning',
      httpStatus: 429,
      httpStatusText: 'Too Many Requests',
      errorName: 'OnlineProviderError',
      errorMessage: 'The endpoint is rate limiting requests.',
      endpointOrigin: 'https://api.openai.com',
      endpointPath: '/v1/chat/completions',
      durationMs: 350,
      retryCount: 1,
    };

    const report = formatDiagnosticReportText([entry]);
    expect(report).toContain('# Mozhi API Diagnostic Report');
    expect(report).toContain('corr_test_123');
    expect(report).toContain('HTTP Status:** 429 (Too Many Requests)');
    expect(report).toContain('Duration:** 350ms');
  });
});

describe('Storage Management & Retention Limits', () => {
  it('loads empty array when storage is empty or undefined', async () => {
    stubStorage();
    const logs = await loadApiErrorLogs();
    expect(logs).toEqual([]);
  });

  it('stores and retrieves log entries', async () => {
    const { store } = stubStorage();
    const entry: ApiErrorLogEntry = {
      id: 'err_test',
      correlationId: 'corr_test',
      timestamp: Date.now(),
      provider: 'OpenAI-Compatible',
      model: 'test-model',
      operation: 'enhance',
      stage: 'transport',
      category: 'network',
      severity: 'error',
      httpStatus: null,
      httpStatusText: null,
      errorName: 'TypeError',
      errorMessage: 'Failed to fetch',
      durationMs: 50,
      retryCount: 0,
    };

    await appendApiErrorLog(entry);
    const loaded = await loadApiErrorLogs();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].correlationId).toBe('corr_test');
    expect(store[API_ERROR_LOGS_STORAGE_KEY]).toHaveLength(1);
  });

  it('enforces maximum retention limit of 50 entries FIFO', async () => {
    stubStorage();
    const existing: ApiErrorLogEntry[] = Array.from({ length: 50 }, (_, i) => ({
      id: `err_${i}`,
      correlationId: `corr_${i}`,
      timestamp: Date.now() - (50 - i) * 1000,
      provider: 'OpenAI-Compatible',
      model: 'model',
      operation: `enhance_${i}`,
      stage: 'transport',
      category: 'network',
      severity: 'error',
      httpStatus: null,
      httpStatusText: null,
      errorName: 'Error',
      errorMessage: `Error ${i}`,
      durationMs: 10,
      retryCount: 0,
    }));
    await saveApiErrorLogs(existing);

    // Append 51st entry
    const newEntry: ApiErrorLogEntry = {
      id: 'err_new',
      correlationId: 'corr_new',
      timestamp: Date.now(),
      provider: 'OpenAI-Compatible',
      model: 'model',
      operation: 'enhance_new',
      stage: 'transport',
      category: 'network',
      severity: 'error',
      httpStatus: null,
      httpStatusText: null,
      errorName: 'Error',
      errorMessage: 'Newest error',
      durationMs: 10,
      retryCount: 0,
    };
    await appendApiErrorLog(newEntry);

    const loaded = await loadApiErrorLogs();
    expect(loaded).toHaveLength(MAX_LOG_ENTRIES);
    expect(loaded[0].id).toBe('err_new'); // newest first
  });

  it('deduplicates entries with the same correlationId, operation, and stage', async () => {
    stubStorage();
    const entry: ApiErrorLogEntry = {
      id: 'err_dup',
      correlationId: 'corr_dedup_1',
      timestamp: Date.now(),
      provider: 'OpenAI-Compatible',
      model: 'test-model',
      operation: 'enhance',
      stage: 'http',
      category: 'authentication',
      severity: 'error',
      httpStatus: 401,
      httpStatusText: 'Unauthorized',
      errorName: 'OnlineProviderError',
      errorMessage: 'Invalid key',
      durationMs: 100,
      retryCount: 0,
    };

    await appendApiErrorLog(entry);
    await appendApiErrorLog({ ...entry, id: 'err_dup_2' });

    const logs = await loadApiErrorLogs();
    expect(logs).toHaveLength(1);
  });
});

describe('Clear Logs Safety & Storage Isolation', () => {
  it('clearApiErrorLogs deletes ONLY the diagnostic log key and preserves unrelated storage', async () => {
    const { store, local } = stubStorage();
    store['mozhi-settings'] = { provider: 'openai-compatible', onlineModel: 'gpt-4o' };
    store['mozhi-online-api-key'] = 'secret-online-key';
    store['mozhi-prompt-session'] = { prompt: 'my prompt' };
    store['mozhi-local-model-state'] = { status: 'ready' };
    store[API_ERROR_LOGS_STORAGE_KEY] = [{ id: 'err_1' }];

    await clearApiErrorLogs();

    expect(local.remove).toHaveBeenCalledWith([API_ERROR_LOGS_STORAGE_KEY]);
    expect(store[API_ERROR_LOGS_STORAGE_KEY]).toBeUndefined();
    // Critical: Verify unrelated settings, keys, and model state are completely untouched
    expect(store['mozhi-settings']).toEqual({ provider: 'openai-compatible', onlineModel: 'gpt-4o' });
    expect(store['mozhi-online-api-key']).toBe('secret-online-key');
    expect(store['mozhi-prompt-session']).toEqual({ prompt: 'my prompt' });
    expect(store['mozhi-local-model-state']).toEqual({ status: 'ready' });
  });

  it('continues logging new errors normally after clearApiErrorLogs', async () => {
    stubStorage();
    await recordApiError({
      operation: 'first-op',
      error: new Error('First error'),
    });
    expect(await loadApiErrorLogs()).toHaveLength(1);

    await clearApiErrorLogs();
    expect(await loadApiErrorLogs()).toHaveLength(0);

    // Record error after clear
    await recordApiError({
      operation: 'second-op',
      error: new Error('Second error'),
    });
    const after = await loadApiErrorLogs();
    expect(after).toHaveLength(1);
    expect(after[0].operation).toBe('second-op');
  });
});

describe('Failure Isolation & Resilience', () => {
  it('recordApiError handles storage throwing without masking the original exception', async () => {
    const storeFail = {
      get: vi.fn(async () => { throw new Error('Storage quota exceeded'); }),
      set: vi.fn(async () => { throw new Error('Storage write failed'); }),
      remove: vi.fn(async () => { throw new Error('Storage delete failed'); }),
    };
    vi.stubGlobal('chrome', { storage: { local: storeFail } });

    // Must not throw
    await expect(recordApiError({
      operation: 'enhance',
      error: new Error('Test failure'),
    })).resolves.toBeUndefined();
  });

  it('runs safely in environments where chrome.storage is completely unavailable', async () => {
    vi.stubGlobal('chrome', undefined);

    await expect(loadApiErrorLogs()).resolves.toEqual([]);
    await expect(clearApiErrorLogs()).resolves.toBeUndefined();
    await expect(recordApiError({ operation: 'test', error: new Error('No chrome') })).resolves.toBeUndefined();
  });
});

describe('Online Provider Integration & End-to-End Error Logging', () => {
  const config = { baseUrl: 'https://api.openai.com/v1/', model: 'gpt-4o' };

  beforeEach(() => {
    stubStorage();
  });

  it('records HTTP 401 and sanitizes API key from the logged entry', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ error: { message: 'Invalid API key provided: sk-abcdef123456789' } }), {
        status: 401,
        statusText: 'Unauthorized',
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const provider = new OpenAICompatibleProvider(config, 'sk-secret-user-key');

    await expect(provider.enhance({ prompt: 'Enhance this', mode: 'balanced' })).rejects.toThrow(OnlineProviderError);

    const logs = await loadApiErrorLogs();
    expect(logs).toHaveLength(1);
    const entry = logs[0];
    expect(entry.httpStatus).toBe(401);
    expect(entry.category).toBe('authentication');
    expect(entry.stage).toBe('http');
    expect(entry.errorMessage).not.toContain('sk-abcdef123456789');
    expect(entry.errorMessage).not.toContain('sk-secret-user-key');
    expect(entry.errorMessage).toContain('[REDACTED_API_KEY]');
  });

  it('records HTTP 429 rate limits', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ error: { message: 'Rate limit exceeded' } }), {
        status: 429,
        statusText: 'Too Many Requests',
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const provider = new OpenAICompatibleProvider(config, 'valid-key');
    await expect(provider.enhance({ prompt: 'Enhance this', mode: 'light' })).rejects.toThrow(OnlineProviderError);

    const logs = await loadApiErrorLogs();
    expect(logs).toHaveLength(1);
    expect(logs[0].httpStatus).toBe(429);
    expect(logs[0].category).toBe('rate_limit');
    expect(logs[0].severity).toBe('warning');
  });

  it('records network failures when fetch throws', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('Failed to fetch'));
    vi.stubGlobal('fetch', fetchMock);

    const provider = new OpenAICompatibleProvider(config, 'valid-key');
    await expect(provider.enhance({ prompt: 'Enhance this', mode: 'light' })).rejects.toThrow(OnlineProviderError);

    const logs = await loadApiErrorLogs();
    expect(logs).toHaveLength(1);
    expect(logs[0].stage).toBe('transport');
    expect(logs[0].category).toBe('network');
  });

  it('records aborted requests with warning severity', async () => {
    const controller = new AbortController();
    controller.abort();

    const provider = new OpenAICompatibleProvider(config, 'valid-key');
    await expect(provider.enhance({ prompt: 'Enhance this', mode: 'light' }, controller.signal)).rejects.toThrow();

    const logs = await loadApiErrorLogs();
    expect(logs).toHaveLength(1);
    expect(logs[0].category).toBe('aborted');
    expect(logs[0].stage).toBe('transport');
    expect(logs[0].severity).toBe('warning');
  });

  it('records malformed 200 responses as parsing errors', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response('<!DOCTYPE html><html><body>Error</body></html>', {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const provider = new OpenAICompatibleProvider(config, 'valid-key');
    await expect(provider.enhance({ prompt: 'Enhance this', mode: 'light' })).rejects.toThrow(OnlineProviderError);

    const logs = await loadApiErrorLogs();
    expect(logs).toHaveLength(1);
    expect(logs[0].stage).toBe('parsing');
    expect(logs[0].category).toBe('malformed_response');
    expect(logs[0].httpStatus).toBe(200);
  });

  it('records 200 responses with empty or missing prompt content as output_validation errors', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: '   ' } }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const provider = new OpenAICompatibleProvider(config, 'valid-key');
    await expect(provider.enhance({ prompt: 'Enhance this', mode: 'light' })).rejects.toThrow(OnlineProviderError);

    const logs = await loadApiErrorLogs();
    expect(logs).toHaveLength(1);
    expect(logs[0].stage).toBe('output_validation');
    expect(logs[0].category).toBe('empty_output');
    expect(logs[0].httpStatus).toBe(200);
  });
});
