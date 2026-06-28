import { SpekoApiError, SpekoAuthError, SpekoRateLimitError } from './errors.js';

export interface HttpClientOptions {
  baseUrl: string;
  apiKey: string;
  timeout: number;
}

const USER_AGENT = '@spekoai/sdk/0.4.1';

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

  async request<T>(
    method: string,
    path: string,
    body?: unknown,
    externalSignal?: AbortSignal,
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const { signal, cleanup } = this.buildSignal(externalSignal);

    try {
      const response = await fetch(url, {
        method,
        headers: this.jsonHeaders,
        body: body ? JSON.stringify(body) : undefined,
        signal,
      });

      if (!response.ok) {
        await this.handleError(response);
      }

      return (await response.json()) as T;
    } finally {
      cleanup();
    }
  }

  async get<T>(path: string, externalSignal?: AbortSignal): Promise<T> {
    return this.request<T>('GET', path, undefined, externalSignal);
  }

  async post<T>(path: string, body: unknown, externalSignal?: AbortSignal): Promise<T> {
    return this.request<T>('POST', path, body, externalSignal);
  }

  async put<T>(path: string, body: unknown, externalSignal?: AbortSignal): Promise<T> {
    return this.request<T>('PUT', path, body, externalSignal);
  }

  async delete<T>(path: string, externalSignal?: AbortSignal): Promise<T> {
    return this.request<T>('DELETE', path, undefined, externalSignal);
  }

  async patch<T>(path: string, body: unknown, externalSignal?: AbortSignal): Promise<T> {
    return this.request<T>('PATCH', path, body, externalSignal);
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
    externalSignal?: AbortSignal,
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const { signal, cleanup } = this.buildSignal(externalSignal);

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
        signal,
      });

      if (!response.ok) {
        await this.handleError(response);
      }

      return (await response.json()) as T;
    } finally {
      cleanup();
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
    externalSignal?: AbortSignal,
  ): Promise<{ bytes: Uint8Array; headers: Record<string, string> }> {
    const url = `${this.baseUrl}${path}`;
    const { signal, cleanup } = this.buildSignal(externalSignal);

    try {
      const response = await fetch(url, {
        method,
        headers: this.jsonHeaders,
        body: body ? JSON.stringify(body) : undefined,
        signal,
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
      cleanup();
    }
  }

  async *requestSse(
    method: string,
    path: string,
    body: unknown,
    externalSignal?: AbortSignal,
    extraHeaders?: Record<string, string>,
  ): AsyncIterableIterator<{ event: string; data: unknown }> {
    const url = `${this.baseUrl}${path}`;
    const { signal, cleanup } = this.buildSignal(externalSignal);
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;

    try {
      const response = await fetch(url, {
        method,
        headers: { ...this.jsonHeaders, ...extraHeaders },
        body: body ? JSON.stringify(body) : undefined,
        signal,
      });

      if (!response.ok) {
        await this.handleError(response);
      }

      if (!response.body) {
        throw new SpekoApiError('Response body is empty', response.status, 'EMPTY_BODY');
      }

      reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = drainSseEvents(buffer);
        buffer = events.remainder;
        for (const event of events.items) {
          yield event;
        }
      }

      buffer += decoder.decode();
      const events = drainSseEvents(buffer + '\n\n');
      for (const event of events.items) {
        yield event;
      }
    } finally {
      reader?.releaseLock();
      cleanup();
    }
  }

  async requestRawSse(
    method: string,
    path: string,
    bodyBytes: Uint8Array,
    extraHeaders: Record<string, string>,
    externalSignal?: AbortSignal,
  ): Promise<AsyncIterableIterator<{ event: string; data: unknown }>> {
    const url = `${this.baseUrl}${path}`;
    const { signal, cleanup } = this.buildSignal(externalSignal);

    const response = await fetch(url, {
      method,
      headers: {
        Authorization: this.authHeader,
        'User-Agent': USER_AGENT,
        ...extraHeaders,
      },
      body: bodyBytes,
      signal,
    });

    if (!response.ok) {
      cleanup();
      await this.handleError(response);
    }

    if (!response.body) {
      cleanup();
      throw new SpekoApiError('Response body is empty', response.status, 'EMPTY_BODY');
    }

    return this.readSseBody(response.body, cleanup);
  }

  async requestBinaryStream(
    method: string,
    path: string,
    body: unknown,
    externalSignal?: AbortSignal,
    extraHeaders?: Record<string, string>,
  ): Promise<{ chunks: AsyncIterableIterator<Uint8Array>; headers: Record<string, string> }> {
    const url = `${this.baseUrl}${path}`;
    const { signal, cleanup } = this.buildSignal(externalSignal);

    const response = await fetch(url, {
      method,
      headers: { ...this.jsonHeaders, ...extraHeaders },
      body: body ? JSON.stringify(body) : undefined,
      signal,
    });

    if (!response.ok) {
      cleanup();
      await this.handleError(response);
    }

    if (!response.body) {
      cleanup();
      throw new SpekoApiError('Response body is empty', response.status, 'EMPTY_BODY');
    }

    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      headers[key] = value;
    });

    return {
      headers,
      chunks: this.readBinaryBody(response.body, cleanup),
    };
  }

  private async *readSseBody(
    body: ReadableStream<Uint8Array>,
    cleanup: () => void,
  ): AsyncIterableIterator<{ event: string; data: unknown }> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = drainSseEvents(buffer);
        buffer = events.remainder;
        for (const event of events.items) {
          yield event;
        }
      }

      buffer += decoder.decode();
      const events = drainSseEvents(buffer + '\n\n');
      for (const event of events.items) {
        yield event;
      }
    } finally {
      reader.releaseLock();
      cleanup();
    }
  }

  private async *readBinaryBody(
    body: ReadableStream<Uint8Array>,
    cleanup: () => void,
  ): AsyncIterableIterator<Uint8Array> {
    const reader = body.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        yield value;
      }
    } finally {
      reader.releaseLock();
      cleanup();
    }
  }

  /**
   * Compose the internal timeout signal with an optional external signal so
   * that callers can cancel in-flight requests (e.g. LiveKit Agents tearing
   * down a session) while still enforcing the client's configured timeout.
   */
  private buildSignal(externalSignal?: AbortSignal): {
    signal: AbortSignal;
    cleanup: () => void;
  } {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);

    if (externalSignal) {
      if (externalSignal.aborted) {
        controller.abort(externalSignal.reason);
      } else {
        const onAbort = () => controller.abort(externalSignal.reason);
        externalSignal.addEventListener('abort', onAbort, { once: true });
        return {
          signal: controller.signal,
          cleanup: () => {
            clearTimeout(timer);
            externalSignal.removeEventListener('abort', onAbort);
          },
        };
      }
    }

    return {
      signal: controller.signal,
      cleanup: () => clearTimeout(timer),
    };
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
      throw new SpekoRateLimitError(message, retryAfter ? parseInt(retryAfter, 10) : null);
    }

    throw new SpekoApiError(message, response.status, code);
  }
}

function drainSseEvents(buffer: string): {
  items: Array<{ event: string; data: unknown }>;
  remainder: string;
} {
  const items: Array<{ event: string; data: unknown }> = [];
  let cursor = 0;

  while (true) {
    const next = buffer.indexOf('\n\n', cursor);
    if (next === -1) break;
    const block = buffer.slice(cursor, next);
    cursor = next + 2;
    if (!block.trim()) continue;

    let event = 'message';
    const dataLines: string[] = [];
    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith('event:')) {
        event = line.slice('event:'.length).trim();
      } else if (line.startsWith('data:')) {
        dataLines.push(line.slice('data:'.length).trimStart());
      }
    }
    const rawData = dataLines.join('\n');
    let data: unknown = rawData;
    try {
      data = JSON.parse(rawData);
    } catch {
      // Keep non-JSON SSE payloads as strings.
    }
    items.push({ event, data });
  }

  return { items, remainder: buffer.slice(cursor) };
}
