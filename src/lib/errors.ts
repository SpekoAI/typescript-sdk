export class SpekoApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, status: number, code: string) {
    super(message);
    this.name = 'SpekoApiError';
    this.status = status;
    this.code = code;
  }
}

export class SpekoAuthError extends SpekoApiError {
  constructor(message = 'Invalid or missing API key') {
    super(message, 401, 'AUTH_ERROR');
    this.name = 'SpekoAuthError';
  }
}

export class SpekoRateLimitError extends SpekoApiError {
  readonly retryAfter: number | null;

  constructor(message = 'Rate limit exceeded', retryAfter: number | null = null) {
    super(message, 429, 'RATE_LIMITED');
    this.name = 'SpekoRateLimitError';
    this.retryAfter = retryAfter;
  }
}
