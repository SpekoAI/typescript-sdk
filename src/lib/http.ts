import { SpekoApiError, SpekoAuthError, SpekoRateLimitError } from './errors.js';

export interface HttpClientOptions {
  baseUrl: string;
  apiKey: string;
  timeout: number;
}

const USER_AGENT = '@spekoai/sdk/0.0.1';

interface ParsedErrorBody {
  message: string;
  code: string;
  traceId: string | null;
}

interface StreamOptions<TEvent, TResult> {
  body?: unknown;
  headers?: Record<string, string>;
  externalSignal?: AbortSignal;
  onEvent?: (event: TEvent) => void;
  resultFromEvent?: (event: TEvent) => TResult | null;
}

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
  ): Promise<T> {
    return this.request<T>('POST', path, body, externalSignal);
  }

  async delete<T>(path: string, externalSignal?: AbortSignal): Promise<T> {
    return this.request<T>('DELETE', path, undefined, externalSignal);
  }

  async patch<T>(
    path: string,
    body: unknown,
    externalSignal?: AbortSignal,
  ): Promise<T> {
    return this.request<T>('PATCH', path, body, externalSignal);
  }

  async postStream<TEvent, TResult>(
    path: string,
    options: StreamOptions<TEvent, TResult>,
  ): Promise<{ events: TEvent[]; result: TResult | null }> {
    return this.requestStream<TEvent, TResult>('POST', path, options);
  }

  async getStream<TEvent, TResult>(
    path: string,
    options: Omit<StreamOptions<TEvent, TResult>, 'body'> = {},
  ): Promise<{ events: TEvent[]; result: TResult | null; streamed: boolean }> {
    return this.requestStream<TEvent, TResult>('GET', path, options);
  }

  private async requestStream<TEvent, TResult>(
    method: string,
    path: string,
    options: StreamOptions<TEvent, TResult>,
  ): Promise<{ events: TEvent[]; result: TResult | null; streamed: boolean }> {
    const url = `${this.baseUrl}${path}`;
    const { signal, cleanup } = this.buildSignal(options.externalSignal);

    try {
      const response = await fetch(url, {
        method,
        headers: {
          ...this.jsonHeaders,
          Accept: 'text/event-stream, application/json',
          ...options.headers,
        },
        body: options.body ? JSON.stringify(options.body) : undefined,
        signal,
      });

      if (!response.ok) {
        await this.handleError(response);
      }

      const contentType = response.headers.get('content-type') ?? '';
      if (!contentType.includes('text/event-stream')) {
        if (response.status === 204) {
          return { events: [], result: null, streamed: false };
        }
        return {
          events: [],
          result: (await response.json()) as TResult,
          streamed: false,
        };
      }

      const events: TEvent[] = [];
      let result: TResult | null = null;
      let eventName = 'message';
      let dataLines: string[] = [];

      const flushEvent = () => {
        if (dataLines.length === 0) return;
        const raw = dataLines.join('\n');
        dataLines = [];

        const parsed = JSON.parse(raw) as TEvent;
        if (
          parsed &&
          typeof parsed === 'object' &&
          !Array.isArray(parsed) &&
          !('_event' in parsed)
        ) {
          (parsed as Record<string, unknown>)['_event'] = eventName;
        }
        events.push(parsed);
        options.onEvent?.(parsed);
        result = options.resultFromEvent?.(parsed) ?? result;
        eventName = 'message';
      };

      const decoder = new TextDecoder();
      let buffer = '';
      if (!response.body) {
        return { events, result, streamed: true };
      }

      for await (const chunk of response.body as AsyncIterable<Uint8Array>) {
        buffer += decoder.decode(chunk, { stream: true });
        let lineEnd = buffer.indexOf('\n');
        while (lineEnd !== -1) {
          const rawLine = buffer.slice(0, lineEnd);
          buffer = buffer.slice(lineEnd + 1);
          const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
          if (line === '') {
            flushEvent();
          } else if (line.startsWith(':')) {
            // SSE comment/heartbeat.
          } else if (line.startsWith('event:')) {
            eventName = line.slice('event:'.length).trim() || 'message';
          } else if (line.startsWith('data:')) {
            dataLines.push(line.slice('data:'.length).trimStart());
          }
          lineEnd = buffer.indexOf('\n');
        }
      }

      buffer += decoder.decode();
      if (buffer.length > 0) {
        for (const rawLine of buffer.split(/\r?\n/)) {
          if (rawLine.startsWith('event:')) {
            eventName = rawLine.slice('event:'.length).trim() || 'message';
          } else if (rawLine.startsWith('data:')) {
            dataLines.push(rawLine.slice('data:'.length).trimStart());
          }
        }
      }
      flushEvent();

      return { events, result, streamed: true };
    } finally {
      cleanup();
    }
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
    const { message, code, traceId } = parseErrorBody(text, response.statusText);

    if (response.status === 401) {
      throw new SpekoAuthError(message, traceId);
    }

    if (response.status === 429) {
      const retryAfter = response.headers.get('Retry-After');
      throw new SpekoRateLimitError(
        message,
        retryAfter ? parseInt(retryAfter, 10) : null,
        traceId,
      );
    }

    throw new SpekoApiError(message, response.status, code, traceId);
  }
}

function parseErrorBody(text: string, fallback: string): ParsedErrorBody {
  try {
    const json = JSON.parse(text) as {
      error?: unknown;
      message?: unknown;
      code?: unknown;
      trace_id?: unknown;
      traceId?: unknown;
    };
    const message =
      typeof json.error === 'string'
        ? json.error
        : typeof json.message === 'string'
          ? json.message
          : text;
    const code = typeof json.code === 'string' ? json.code : 'UNKNOWN';
    const trace =
      typeof json.trace_id === 'string'
        ? json.trace_id
        : typeof json.traceId === 'string'
          ? json.traceId
          : null;
    return { message, code, traceId: trace };
  } catch {
    return { message: text || fallback, code: 'UNKNOWN', traceId: null };
  }
}
