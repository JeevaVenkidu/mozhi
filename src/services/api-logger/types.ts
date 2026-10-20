export type ApiFailureStage =
  | 'preparation'
  | 'transport'
  | 'http'
  | 'parsing'
  | 'output_validation'
  | 'streaming'
  | 'unknown';

export type ApiFailureCategory =
  | 'network'
  | 'timeout'
  | 'aborted'
  | 'authentication'
  | 'authorization'
  | 'rate_limit'
  | 'not_found'
  | 'server_error'
  | 'client_error'
  | 'malformed_response'
  | 'empty_output'
  | 'permission_denied'
  | 'unknown';

export type ApiErrorSeverity = 'warning' | 'error' | 'critical';

export interface ApiErrorLogEntry {
  id: string;
  correlationId: string;
  timestamp: number;
  provider: string;
  model: string;
  operation: 'enhance' | 'testConnection' | string;
  stage: ApiFailureStage;
  category: ApiFailureCategory;
  severity: ApiErrorSeverity;
  httpStatus: number | null;
  httpStatusText: string | null;
  errorName: string;
  errorMessage: string;
  errorCode?: string;
  endpointOrigin?: string;
  endpointPath?: string;
  durationMs: number;
  retryCount: number;
}

export interface ApiErrorLogFilter {
  severity?: ApiErrorSeverity | 'all';
  operation?: string | 'all';
  search?: string;
}
