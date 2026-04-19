import type { HttpClient } from '../http.js';
import type {
  RealtimeConnectParams,
  RealtimeEventHandler,
  RealtimeFrame,
  RealtimeSessionHandle,
} from '../types/index.js';

interface SessionCreateResponse {
  mode: 's2s';
  sessionId: string;
  wsUrl: string;
  wsToken: string;
  expiresAt: string;
}

export class Realtime {
  constructor(private readonly http: HttpClient) {}

  /**
   * Open a speech-to-speech session. Posts `/v1/sessions` with `mode: 's2s'`
   * to mint a short-lived WebSocket token, then opens a direct WS to the
   * server's S2S proxy. The proxy bridges to the underlying provider
   * (OpenAI Realtime, Gemini Live, xAI Grok Voice) so the client sees a
   * single transport regardless of which backend is in use.
   */
  async connect(params: RealtimeConnectParams): Promise<RealtimeSessionHandle> {
    const response = await this.http.post<SessionCreateResponse>(
      '/v1/sessions',
      {
        mode: 's2s',
        s2s: {
          provider: params.provider,
          model: params.model,
          voice: params.voice,
          systemPrompt: params.systemPrompt,
          temperature: params.temperature,
          inputSampleRate: params.inputSampleRate,
          outputSampleRate: params.outputSampleRate,
          tools: params.tools,
        },
        metadata: params.metadata,
        ttlSeconds: params.ttlSeconds,
      },
    );

    return new BrowserRealtimeHandle(
      response.sessionId,
      response.wsUrl,
      response.wsToken,
      response.expiresAt,
    );
  }
}

class BrowserRealtimeHandle implements RealtimeSessionHandle {
  readonly sessionId: string;
  readonly expiresAt: string;

  private readonly ws: WebSocket;
  private readonly handlers = new Set<RealtimeEventHandler>();
  private closed = false;

  constructor(
    sessionId: string,
    wsUrl: string,
    wsToken: string,
    expiresAt: string,
  ) {
    this.sessionId = sessionId;
    this.expiresAt = expiresAt;

    // Pass the token as the first subprotocol — browsers can't set headers
    // on `new WebSocket()`, so subprotocol is the only auth carrier that
    // doesn't leak through URL params.
    this.ws = new WebSocket(wsUrl, [wsToken]);
    this.ws.binaryType = 'arraybuffer';

    this.ws.addEventListener('message', (evt) => {
      this.dispatchIncoming(evt.data);
    });
    this.ws.addEventListener('close', (evt) => {
      this.closed = true;
      this.emit({ type: 'close', code: evt.code, reason: evt.reason });
    });
    this.ws.addEventListener('error', () => {
      this.emit({
        type: 'error',
        code: 'WS_ERROR',
        message: 'WebSocket transport error',
      });
    });
  }

  sendAudio(pcm: Uint8Array): void {
    if (this.closed || this.ws.readyState !== 1) return;
    // Copy to ensure we send a plain ArrayBuffer, not a typed-array view that
    // might alias a SharedArrayBuffer.
    const copy = new Uint8Array(pcm.byteLength);
    copy.set(pcm);
    this.ws.send(copy.buffer);
  }

  commit(): void {
    this.sendControl('commit');
  }

  interrupt(): void {
    this.sendJson({ t: 'interrupt' });
  }

  sendToolResult(callId: string, output: string): void {
    this.sendJson({ t: 'tool_result', callId, output });
  }

  on(handler: RealtimeEventHandler): () => void {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }

  close(code = 1000, reason = 'client_closed'): void {
    if (this.closed) return;
    this.closed = true;
    try {
      this.ws.close(code, reason);
    } catch {
      // ignore
    }
  }

  private sendControl(action: 'commit' | 'clear' | 'end_turn'): void {
    this.sendJson({ t: 'control', action });
  }

  private sendJson(payload: unknown): void {
    if (this.closed || this.ws.readyState !== 1) return;
    try {
      this.ws.send(JSON.stringify(payload));
    } catch {
      // ignore
    }
  }

  private dispatchIncoming(data: unknown): void {
    if (data instanceof ArrayBuffer) {
      this.emit({
        type: 'audio',
        pcm: new Uint8Array(data),
        sampleRate: 24000,
      });
      return;
    }
    if (typeof data !== 'string') return;

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(data);
    } catch {
      return;
    }
    const t = parsed['t'];
    switch (t) {
      case 'transcript':
        this.emit({
          type: 'transcript',
          role: parsed['role'] as 'user' | 'assistant',
          text: String(parsed['text'] ?? ''),
          final: Boolean(parsed['final']),
        });
        break;
      case 'tool_call':
        this.emit({
          type: 'tool_call',
          callId: String(parsed['callId'] ?? ''),
          name: String(parsed['name'] ?? ''),
          arguments: String(parsed['arguments'] ?? ''),
        });
        break;
      case 'usage':
        this.emit({
          type: 'usage',
          inputAudioTokens: Number(parsed['inputAudioTokens'] ?? 0),
          outputAudioTokens: Number(parsed['outputAudioTokens'] ?? 0),
        });
        break;
      case 'error':
        this.emit({
          type: 'error',
          code: String(parsed['code'] ?? 'UNKNOWN'),
          message: String(parsed['message'] ?? ''),
        });
        break;
      default:
        break;
    }
  }

  private emit(frame: RealtimeFrame): void {
    for (const handler of this.handlers) {
      try {
        handler(frame);
      } catch {
        // swallow — a misbehaving handler shouldn't break the pump
      }
    }
  }
}
