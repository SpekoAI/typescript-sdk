export class SpekoApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly traceId: string | null;

  constructor(
    message: string,
    status: number,
    code: string,
    traceId: string | null = null,
  ) {
    super(message);
    this.name = 'SpekoApiError';
    this.status = status;
    this.code = code;
    this.traceId = traceId;
  }
}

export class SpekoAuthError extends SpekoApiError {
  constructor(message = 'Invalid or missing API key', traceId: string | null = null) {
    super(message, 401, 'AUTH_ERROR', traceId);
    this.name = 'SpekoAuthError';
  }
}

export class SpekoRateLimitError extends SpekoApiError {
  readonly retryAfter: number | null;

  constructor(
    message = 'Rate limit exceeded',
    retryAfter: number | null = null,
    traceId: string | null = null,
  ) {
    super(message, 429, 'RATE_LIMITED', traceId);
    this.name = 'SpekoRateLimitError';
    this.retryAfter = retryAfter;
  }
}
