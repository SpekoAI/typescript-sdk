import { SpekoApiError, SpekoAuthError, SpekoRateLimitError } from './errors.js';

export interface HttpClientOptions {
  baseUrl: string;
  apiKey: string;
  timeout: number;
}

export class HttpClient {
  private readonly baseUrl: string;
  private readonly headers: Record<string, string>;
  private readonly timeout: number;

  constructor(options: HttpClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.headers = {
      Authorization: `Bearer ${options.apiKey}`,
      'Content-Type': 'application/json',
      'User-Agent': '@spekoai/sdk-typescript/0.0.1',
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
        headers: this.headers,
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
