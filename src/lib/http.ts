import { SpekoApiError, SpekoAuthError, SpekoRateLimitError } from './errors.js';

export interface HttpClientOptions {
  baseUrl: string;
  apiKey: string;
  timeout: number;
}

const USER_AGENT = '@speko/sdk/0.0.1';

export class HttpClient {
  private readonly baseUrl: string;
  private readonly authHeader: string;
  private readonly jsonHeaders: Record<string, string>;
  private readonly timeout: number;

  constructor(options: HttpClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.authHeader = `Bearer ${options.apiKey}`;
    this.jsonHeaders = {
      Authorization: this.authHeader,
      'Content-Type': 'application/json',
      'User-Agent': USER_AGENT,
    };
    this.timeout = options.timeout;
  }

  async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(url, {
        method,
        headers: this.jsonHeaders,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      if (!response.ok) {
        await this.handleError(response);
      }

      return (await response.json()) as T;
    } finally {
      clearTimeout(timer);
    }
  }

  async get<T>(path: string): Promise<T> {
    return this.request<T>('GET', path);
  }

  async post<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>('POST', path, body);
  }

  async delete<T>(path: string): Promise<T> {
    return this.request<T>('DELETE', path);
  }

  /**
   * Send raw bytes as the request body and parse a JSON response.
   * Used by `speko.transcribe()` to upload audio and receive a transcript.
   */
  async requestRaw<T>(
    method: string,
    path: string,
    bodyBytes: Uint8Array,
    extraHeaders: Record<string, string>,
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);

    try {
      const headers: Record<string, string> = {
        Authorization: this.authHeader,
        'User-Agent': USER_AGENT,
        ...extraHeaders,
      };

      const response = await fetch(url, {
        method,
        headers,
        body: bodyBytes,
        signal: controller.signal,
      });

      if (!response.ok) {
        await this.handleError(response);
      }

      return (await response.json()) as T;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Send JSON and receive a binary response (e.g. synthesized audio).
   * Returns the raw bytes plus the response headers so callers can read
   * `Content-Type`, `X-Speko-Provider`, etc.
   */
  async requestBinary(
    method: string,
    path: string,
    body: unknown,
  ): Promise<{ bytes: Uint8Array; headers: Record<string, string> }> {
    const url = `${this.baseUrl}${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(url, {
        method,
        headers: this.jsonHeaders,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      if (!response.ok) {
        await this.handleError(response);
      }

      const buffer = await response.arrayBuffer();
      const headers: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        headers[key] = value;
      });

      return { bytes: new Uint8Array(buffer), headers };
    } finally {
      clearTimeout(timer);
    }
  }

  private async handleError(response: Response): Promise<never> {
    const text = await response.text();
    let message: string;
    let code: string;

    try {
      const json = JSON.parse(text) as { error?: string; code?: string };
      message = json.error ?? text;
      code = json.code ?? 'UNKNOWN';
    } catch {
      message = text || response.statusText;
      code = 'UNKNOWN';
    }

    if (response.status === 401) {
      throw new SpekoAuthError(message);
    }

    if (response.status === 429) {
      const retryAfter = response.headers.get('Retry-After');
      throw new SpekoRateLimitError(
        message,
        retryAfter ? parseInt(retryAfter, 10) : null,
      );
    }

    throw new SpekoApiError(message, response.status, code);
  }
}
