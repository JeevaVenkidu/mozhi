import { sanitizeErrorMessage, sanitizeUrl } from './sanitizer';
import { appendApiErrorLog } from './storage';
import type {
  ApiErrorLogEntry,
  ApiErrorSeverity,
  ApiFailureCategory,
  ApiFailureStage,
} from './types';

export interface RecordApiErrorParams {
  correlationId?: string;
  provider?: string;
  model?: string;
  operation: 'enhance' | 'testConnection' | string;
  error: unknown;
  stage?: ApiFailureStage;
  category?: ApiFailureCategory;
  severity?: ApiErrorSeverity;
  httpStatus?: number | null;
  httpStatusText?: string | null;
  endpointUrl?: string;
  durationMs?: number;
  retryCount?: number;
}

// In-memory set to prevent recursive logging and duplicate recording within the same runtime session
const recordedCorrelationIds = new Set<string>();

/**
 * Classifies an error into stage, category, and severity based on status code and error properties.
 */
export function classifyApiError(
  error: unknown,
  httpStatus?: number | null,
): { stage: ApiFailureStage; category: ApiFailureCategory; severity: ApiErrorSeverity } {
  if (httpStatus) {
    if (httpStatus === 401) return { stage: 'http', category: 'authentication', severity: 'error' };
    if (httpStatus === 403) return { stage: 'http', category: 'authorization', severity: 'error' };
    if (httpStatus === 404) return { stage: 'http', category: 'not_found', severity: 'error' };
    if (httpStatus === 429) return { stage: 'http', category: 'rate_limit', severity: 'warning' };
    if (httpStatus >= 500) return { stage: 'http', category: 'server_error', severity: 'error' };
    if (httpStatus >= 400) return { stage: 'http', category: 'client_error', severity: 'error' };
  }

  if (error instanceof DOMException && error.name === 'AbortError') {
    return { stage: 'transport', category: 'aborted', severity: 'warning' };
  }

  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();

  if (message.includes('stream') || message.includes('chunk') || message.includes('eventstream') || message.includes('sse')) {
    return { stage: 'streaming', category: 'network', severity: 'error' };
  }
  if (message.includes('timeout') || message.includes('timed out')) {
    return { stage: 'transport', category: 'timeout', severity: 'warning' };
  }
  if (message.includes('abort') || message.includes('cancelled')) {
    return { stage: 'transport', category: 'aborted', severity: 'warning' };
  }
  if (message.includes('network') || message.includes('failed to fetch') || message.includes('could not reach')) {
    return { stage: 'transport', category: 'network', severity: 'error' };
  }
  if (message.includes('unreadable') || message.includes('syntaxerror') || message.includes('json') || message.includes('malformed')) {
    return { stage: 'parsing', category: 'malformed_response', severity: 'error' };
  }
  if (message.includes('no prompt text') || message.includes('empty') || message.includes('unusable') || message.includes('too long')) {
    return { stage: 'output_validation', category: 'empty_output', severity: 'error' };
  }
  if (message.includes('permission') || message.includes('allow access') || message.includes('allow endpoint access')) {
    return { stage: 'preparation', category: 'permission_denied', severity: 'warning' };
  }

  return { stage: 'unknown', category: 'unknown', severity: 'error' };
}

/**
 * Safely records an API error to diagnostic storage.
 * This function NEVER throws or disrupts the primary API execution flow.
 */
export async function recordApiError(params: RecordApiErrorParams): Promise<void> {
  try {
    const correlationId = params.correlationId || `corr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    // Memory deduplication check
    const dedupKey = `${correlationId}:${params.operation}`;
    if (recordedCorrelationIds.has(dedupKey)) {
      return;
    }
    recordedCorrelationIds.add(dedupKey);
    // Keep in-memory deduplication set bounded
    if (recordedCorrelationIds.size > 200) {
      const oldest = recordedCorrelationIds.values().next().value;
      if (oldest) recordedCorrelationIds.delete(oldest);
    }

    const classification = classifyApiError(params.error, params.httpStatus);
    const stage = params.stage ?? classification.stage;
    const category = params.category ?? classification.category;
    const severity = params.severity ?? classification.severity;

    const errorName = params.error instanceof Error ? params.error.name : 'UnknownError';
    const rawMessage = params.error instanceof Error ? params.error.message : String(params.error);
    const sanitizedMsg = sanitizeErrorMessage(rawMessage);

    const urlParts = params.endpointUrl ? sanitizeUrl(params.endpointUrl) : {};

    const entry: ApiErrorLogEntry = {
      id: `err_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      correlationId,
      timestamp: Date.now(),
      provider: params.provider ?? 'OpenAI-Compatible',
      model: params.model ?? 'unknown-model',
      operation: params.operation,
      stage,
      category,
      severity,
      httpStatus: params.httpStatus ?? null,
      httpStatusText: params.httpStatusText ?? null,
      errorName,
      errorMessage: sanitizedMsg,
      endpointOrigin: urlParts.origin,
      endpointPath: urlParts.path,
      durationMs: Math.max(0, params.durationMs ?? 0),
      retryCount: params.retryCount ?? 0,
    };

    await appendApiErrorLog(entry);
  } catch {
    // Failure isolation: Logging errors must never leak or interfere with API logic
  }
}
