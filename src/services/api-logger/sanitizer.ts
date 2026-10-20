import type { ApiErrorLogEntry } from './types';

const SECRET_PATTERNS = [
  /Bearer\s+[A-Za-z0-9_\-\.]+/gi,
  /sk-[A-Za-z0-9_\-]{8,}/gi,
  /AIza[0-9A-Za-z\-_]{20,}/gi,
  /(?:api[_-]?key|token|secret|password|access_token)=([^&\s]+)/gi,
  /Authorization:\s*[^;\r\n]+/gi,
];

/**
 * Strips secrets, API keys, tokens, and overly long text from messages.
 */
export function sanitizeErrorMessage(raw: unknown, maxLength = 600): string {
  if (raw === null || raw === undefined) return 'Unknown error occurred';
  let message = typeof raw === 'string' ? raw : raw instanceof Error ? raw.message : String(raw);

  // Redact known secret patterns
  for (const pattern of SECRET_PATTERNS) {
    message = message.replace(pattern, (match) => {
      if (match.toLowerCase().startsWith('bearer ')) return 'Bearer [REDACTED]';
      if (match.toLowerCase().startsWith('authorization:')) return 'Authorization: [REDACTED]';
      if (match.includes('=')) {
        const [prefix] = match.split('=');
        return `${prefix}=[REDACTED]`;
      }
      return '[REDACTED_API_KEY]';
    });
  }

  // Strip potential URL credentials like https://user:pass@host
  message = message.replace(/https?:\/\/[^/:]+:[^/@]+@/gi, 'https://[REDACTED_USER_INFO]@');

  // Strip query parameters from any URLs found inside error messages
  message = message.replace(/(https?:\/\/[^\s?#]+)\?[^\s#]*/gi, '$1?[REDACTED_QUERY]');

  // Limit character length to prevent buffer bloat or prompt echo leaks
  if (message.length > maxLength) {
    message = `${message.slice(0, maxLength)}… [truncated]`;
  }

  return message.trim();
}

/**
 * Extracts only origin and pathname from a URL, stripping query params, hash, and user credentials.
 */
export function sanitizeUrl(urlStr: string): { origin?: string; path?: string } {
  try {
    const url = new URL(urlStr);
    return {
      origin: url.origin,
      path: url.pathname,
    };
  } catch {
    return {
      origin: undefined,
      path: undefined,
    };
  }
}

/**
 * Performs a secondary defense-in-depth sanitization pass before exporting JSON.
 */
export function sanitizeLogForExport(entry: ApiErrorLogEntry): ApiErrorLogEntry {
  return {
    ...entry,
    errorMessage: sanitizeErrorMessage(entry.errorMessage),
    errorName: sanitizeErrorMessage(entry.errorName, 100),
    errorCode: entry.errorCode ? sanitizeErrorMessage(entry.errorCode, 50) : undefined,
    endpointOrigin: entry.endpointOrigin ? sanitizeErrorMessage(entry.endpointOrigin, 200) : undefined,
    endpointPath: entry.endpointPath ? sanitizeErrorMessage(entry.endpointPath, 200) : undefined,
  };
}

/**
 * Formats diagnostic log entries into a clean, sanitized Markdown report for clipboard copy.
 */
export function formatDiagnosticReportText(entries: ApiErrorLogEntry[]): string {
  if (!entries.length) return 'No API error logs recorded.';

  const header = `# Mozhi API Diagnostic Report\nGenerated: ${new Date().toISOString()}\nTotal Entries: ${entries.length}\n\n`;

  const items = entries.map((entry, index) => {
    const safe = sanitizeLogForExport(entry);
    const date = new Date(safe.timestamp).toISOString();
    return `### [${index + 1}] ${safe.operation} (${safe.severity.toUpperCase()})
- **Timestamp:** ${date}
- **Correlation ID:** \`${safe.correlationId}\`
- **Provider / Model:** ${safe.provider} (${safe.model})
- **Stage:** ${safe.stage} | **Category:** ${safe.category}
- **HTTP Status:** ${safe.httpStatus ?? 'N/A'} ${safe.httpStatusText ? `(${safe.httpStatusText})` : ''}
- **Duration:** ${safe.durationMs}ms | **Retries:** ${safe.retryCount}
- **Endpoint:** ${safe.endpointOrigin ?? ''}${safe.endpointPath ?? 'N/A'}
- **Error:** ${safe.errorName}: ${safe.errorMessage}
`;
  }).join('\n---\n\n');

  return header + items;
}
