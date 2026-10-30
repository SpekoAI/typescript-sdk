import { SpekoApiError, SpekoAuthError, SpekoRateLimitError } from './errors.js';

export interface HttpClientOptions {
  baseUrl: string;
  apiKey: string;
  timeout: number;
}

interface RequestSignal {
  signal: AbortSignal;
  /** Restart the timeout window. */
  arm: () => void;
  /** Stop the timer until the next `arm()`. */
  disarm: () => void;
  /** Stop the timer and detach from the external signal. */
  cleanup: () => void;
}

export const USER_AGENT = '@spekoai/sdk/0.5.6';

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
    extraHeaders?: Record<string, string>,
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const { signal, cleanup } = this.buildSignal(externalSignal);

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

      if (response.status === 204) return undefined as T;
      return (await response.json()) as T;
    } finally {
      cleanup();
    }
  }

  async get<T>(path: string, externalSignal?: AbortSignal): Promise<T> {
    return this.request<T>('GET', path, undefined, externalSignal);
  }

  async post<T>(
    path: string,
    body: unknown,
    externalSignal?: AbortSignal,
    extraHeaders?: Record<string, string>,
  ): Promise<T> {
    return this.request<T>('POST', path, body, externalSignal, extraHeaders);
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
        body: bodyBytes as unknown as string,
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
    /**
     * Per-request override of the client timeout. Session observation can go
     * quiet for longer than the default 30 s between events.
     */
    timeoutMs?: number,
  ): AsyncIterableIterator<{ event: string; id?: string; data: unknown }> {
    const url = `${this.baseUrl}${path}`;
    const { signal, arm, disarm, cleanup } = this.buildSignal(externalSignal, timeoutMs);
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
        arm();
        const { done, value } = await reader.read();
        disarm();
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
  ): Promise<AsyncIterableIterator<{ event: string; id?: string; data: unknown }>> {
    const url = `${this.baseUrl}${path}`;
    const idle = this.buildSignal(externalSignal);
    const { signal, cleanup } = idle;

    const response = await fetch(url, {
      method,
      headers: {
        Authorization: this.authHeader,
        'User-Agent': USER_AGENT,
        ...extraHeaders,
      },
      body: bodyBytes as unknown as string,
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

    return this.readSseBody(response.body, idle);
  }

  async requestBinaryStream(
    method: string,
    path: string,
    body: unknown,
    externalSignal?: AbortSignal,
    extraHeaders?: Record<string, string>,
  ): Promise<{ chunks: AsyncIterableIterator<Uint8Array>; headers: Record<string, string> }> {
    const url = `${this.baseUrl}${path}`;
    const idle = this.buildSignal(externalSignal);
    const { signal, cleanup } = idle;

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
      chunks: this.readBinaryBody(response.body, idle),
    };
  }

  private async *readSseBody(
    body: ReadableStream<Uint8Array>,
    { arm, disarm, cleanup }: RequestSignal,
  ): AsyncIterableIterator<{ event: string; id?: string; data: unknown }> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        arm();
        const { done, value } = await reader.read();
        disarm();
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
    { arm, disarm, cleanup }: RequestSignal,
  ): AsyncIterableIterator<Uint8Array> {
    const reader = body.getReader();
    try {
      while (true) {
        arm();
        const { done, value } = await reader.read();
        disarm();
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
   *
   * The timer starts armed and covers the wait for response headers. Buffered
   * calls keep it running through the body read. Streaming readers re-arm it
   * before each body read and disarm it while the consumer holds a chunk, so
   * the timeout bounds the gap between chunks, not the stream length. This
   * matches the per-read timeout of the Python SDK (httpx).
   */
  private buildSignal(externalSignal?: AbortSignal, timeoutMs?: number): RequestSignal {
    const controller = new AbortController();
    const effectiveTimeout = timeoutMs ?? this.timeout;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const disarm = () => {
      if (timer) clearTimeout(timer);
      timer = null;
    };
    const arm = () => {
      disarm();
      if (effectiveTimeout > 0 && !controller.signal.aborted) {
        timer = setTimeout(() => controller.abort(), effectiveTimeout);
      }
    };
    arm();

    if (externalSignal) {
      if (externalSignal.aborted) {
        controller.abort(externalSignal.reason);
      } else {
        const onAbort = () => controller.abort(externalSignal.reason);
        externalSignal.addEventListener('abort', onAbort, { once: true });
        return {
          signal: controller.signal,
          arm,
          disarm,
          cleanup: () => {
            disarm();
            externalSignal.removeEventListener('abort', onAbort);
          },
        };
      }
    }

    return { signal: controller.signal, arm, disarm, cleanup: disarm };
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
      throw new SpekoRateLimitError(message, parseRetryAfter(response.headers.get('Retry-After')));
    }

    throw new SpekoApiError(message, response.status, code);
  }
}

/**
 * `Retry-After` as seconds to wait. RFC 9110 allows delay-seconds or an
 * HTTP-date; anything else is treated as absent rather than becoming NaN.
 */
function parseRetryAfter(value: string | null): number | null {
  if (value === null) return null;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed);
  const date = Date.parse(trimmed);
  if (!Number.isFinite(date)) return null;
  return Math.max(0, Math.ceil((date - Date.now()) / 1000));
}

function drainSseEvents(buffer: string): {
  items: Array<{ event: string; id?: string; data: unknown }>;
  remainder: string;
} {
  const items: Array<{ event: string; id?: string; data: unknown }> = [];
  let cursor = 0;

  while (true) {
    const next = buffer.indexOf('\n\n', cursor);
    if (next === -1) break;
    const block = buffer.slice(cursor, next);
    cursor = next + 2;
    if (!block.trim()) continue;

    let event = 'message';
    let id: string | undefined;
    const dataLines: string[] = [];
    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith('event:')) {
        event = line.slice('event:'.length).trim();
      } else if (line.startsWith('id:')) {
        id = line.slice('id:'.length).trim();
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
    items.push({ event, ...(id ? { id } : {}), data });
  }

  return { items, remainder: buffer.slice(cursor) };
}
