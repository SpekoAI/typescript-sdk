import type { HttpClient } from '../http.js';
import type {
  RealtimeConnectParams,
  RealtimeEventHandler,
  RealtimeFrame,
  RealtimeSessionHandle,
  RealtimeToolSpec,
} from '../types/index.js';

interface SessionCreateResponse {
  mode: 's2s';
  transport: 'provider_direct';
  sessionId: string;
  planId: string;
  attemptId: string;
  provider: 'openai' | 'xai' | 'google';
  model: string;
  adapter: 'openai.realtime.v1' | 'xai.realtime.v1' | 'google.live.v1';
  providerTransport: 'websocket' | 'webrtc';
  endpoint: string;
  credential: { kind: 'bearer'; value: string; expiresAt: string };
  telemetry: { endpoint: string; token: string; flushIntervalMs: number };
  reservation: {
    id: string;
    authorizedDurationSeconds: number;
    leaseExpiresAt: string;
    billing: {
      mode: 'direct_entitlement';
      state: 'estimated';
      maximumAmountMicros: string;
      currency: string;
      renewalUrl?: string;
      renewableUntil?: string;
    };
  };
  sidebandUrl?: string;
  session: {
    voice?: string;
    instructions?: string;
    temperature?: number;
    tools?: RealtimeToolSpec[];
  };
  inputSampleRate: 16000 | 24000;
  outputSampleRate: 24000;
  expiresAt: string;
}

export class Realtime {
  constructor(private readonly http: HttpClient) {}

  /**
   * Mint a scoped provider credential, then connect the browser directly to
   * the selected provider. Speko remains on setup and metering paths only;
   * realtime audio never traverses a Speko WebSocket or media proxy.
   */
  async connect(params: RealtimeConnectParams): Promise<RealtimeSessionHandle> {
    const idempotencyKey = params.idempotencyKey?.trim() || globalThis.crypto.randomUUID();
    const response = await this.http.post<SessionCreateResponse>(
      '/v1/sessions',
      {
        mode: 's2s',
        agentId: params.agentId,
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
        webhookTags: params.webhookTags,
        metadata: params.metadata,
        ttlSeconds: params.ttlSeconds,
      },
      undefined,
      { 'Idempotency-Key': idempotencyKey },
    );
    return ProviderDirectRealtimeHandle.create(response);
  }
}

interface EntitlementRenewalResponse {
  entitlement_id: string;
  sequence: number;
  lease_expires_at: string;
  authorized_units: number;
  maximum_amount_micros: number;
  currency: string;
  credential: { kind: 'bearer'; value: string; expires_at: string };
}

/**
 * Browser media primitives are described structurally so importing the SDK
 * remains type-safe in Node-only projects whose TypeScript libs omit `dom`.
 * The constructors are still resolved from the real browser global at runtime.
 */
interface BrowserMediaStreamTrack {
  readonly kind?: string;
}

interface BrowserMediaStream {
  getAudioTracks(): BrowserMediaStreamTrack[];
}

interface BrowserAudioBuffer {
  readonly duration: number;
  getChannelData(channel: number): Float32Array;
}

interface BrowserAudioBufferSource {
  buffer: BrowserAudioBuffer | null;
  connect(destination: unknown): void;
  disconnect(): void;
  start(when?: number): void;
  addEventListener(
    type: 'ended',
    listener: () => void,
    options?: { readonly once?: boolean },
  ): void;
}

interface BrowserAudioSource {
  connect(destination: unknown): void;
  disconnect(): void;
}

interface BrowserAudioProcessor {
  onaudioprocess:
    | ((event: { readonly inputBuffer: { getChannelData(channel: number): Float32Array } }) => void)
    | null;
  connect(destination: unknown): void;
  disconnect(): void;
}

interface BrowserAudioDestination {
  readonly stream: BrowserMediaStream;
}

interface BrowserAudioContext {
  readonly currentTime: number;
  readonly destination: unknown;
  readonly sampleRate: number;
  createBuffer(channels: number, length: number, sampleRate: number): BrowserAudioBuffer;
  createBufferSource(): BrowserAudioBufferSource;
  createMediaStreamDestination(): BrowserAudioDestination;
  createMediaStreamSource(stream: unknown): BrowserAudioSource;
  createScriptProcessor(
    bufferSize: number,
    inputChannels: number,
    outputChannels: number,
  ): BrowserAudioProcessor;
  close(): Promise<void>;
  resume(): Promise<void>;
}

interface BrowserDataChannel {
  readonly readyState: string;
  addEventListener(type: string, listener: (event: { readonly data?: unknown }) => void): void;
  close(): void;
  send(data: string): void;
}

interface BrowserPeerConnection {
  readonly connectionState: string;
  readonly localDescription: { readonly sdp?: string } | null;
  addEventListener(
    type: string,
    listener: (event: { readonly track?: BrowserMediaStreamTrack }) => void,
  ): void;
  addTrack(track: BrowserMediaStreamTrack, stream: BrowserMediaStream): void;
  close(): void;
  createDataChannel(label: string): BrowserDataChannel;
  createOffer(): Promise<unknown>;
  setLocalDescription(description: unknown): Promise<void>;
  setRemoteDescription(description: {
    readonly type: 'answer';
    readonly sdp: string;
  }): Promise<void>;
}

interface BrowserRealtimeGlobals {
  readonly AudioContext?: new (options?: { readonly sampleRate?: number }) => BrowserAudioContext;
  readonly MediaStream?: new (tracks?: readonly BrowserMediaStreamTrack[]) => unknown;
  readonly RTCPeerConnection?: new () => BrowserPeerConnection;
}

function browserRealtimeGlobals(): BrowserRealtimeGlobals {
  return globalThis as unknown as BrowserRealtimeGlobals;
}

class ProviderDirectRealtimeHandle implements RealtimeSessionHandle {
  readonly sessionId: string;
  readonly expiresAt: string;
  readonly inputSampleRate: 16000 | 24000;
  readonly outputSampleRate: 24000;

  private ws: WebSocket | null = null;
  private peer: BrowserPeerConnection | null = null;
  private dataChannel: BrowserDataChannel | null = null;
  private inputAudioContext: BrowserAudioContext | null = null;
  private inputDestination: BrowserAudioDestination | null = null;
  private inputScheduledAt = 0;
  private outputAudioContext: BrowserAudioContext | null = null;
  private outputSource: BrowserAudioSource | null = null;
  private outputProcessor: BrowserAudioProcessor | null = null;
  private readonly handlers = new Set<RealtimeEventHandler>();
  private readonly response: SessionCreateResponse;
  private readonly provider: SessionCreateResponse['provider'];
  private readonly attemptId: string;
  private readonly telemetry: SessionCreateResponse['telemetry'];
  private authorizedDurationMs: number;
  private leaseExpiresAt: string;
  private openedAtMs: number | null = null;
  private closed = false;
  private telemetryFinished = false;
  private telemetryTimer: ReturnType<typeof setInterval> | null = null;
  private telemetrySequence = 0;
  private readonly googleToolNames = new Map<string, string>();
  private googleResumptionHandle: string | null = null;
  private googleSocketGeneration = 0;
  private googleReady = false;
  private googleReadyEmitted = false;
  private renewalTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingGoogleMessages: string[] = [];

  static async create(response: SessionCreateResponse): Promise<ProviderDirectRealtimeHandle> {
    const handle = new ProviderDirectRealtimeHandle(response);
    await handle.initialize();
    return handle;
  }

  private constructor(response: SessionCreateResponse) {
    const expectedAdapter = adapterForProvider(response.provider);
    if (response.transport !== 'provider_direct' || response.adapter !== expectedAdapter) {
      throw new Error('Unsupported realtime provider-direct session plan');
    }
    this.sessionId = response.sessionId;
    this.expiresAt = response.expiresAt;
    this.inputSampleRate = response.inputSampleRate;
    this.outputSampleRate = response.outputSampleRate;
    this.response = response;
    this.provider = response.provider;
    this.attemptId = response.attemptId;
    this.telemetry = response.telemetry;
    this.authorizedDurationMs = response.reservation.authorizedDurationSeconds * 1_000;
    this.leaseExpiresAt = response.reservation.leaseExpiresAt;

    const expectedInputRate = response.provider === 'google' ? 16000 : 24000;
    if (this.inputSampleRate !== expectedInputRate || this.outputSampleRate !== 24000) {
      throw new Error(
        `${response.provider} realtime requires ${expectedInputRate / 1000} kHz input and 24 kHz output mono PCM audio`,
      );
    }
    if (
      (response.provider === 'openai' && response.providerTransport !== 'webrtc') ||
      (response.provider !== 'openai' && response.providerTransport !== 'websocket')
    ) {
      throw new Error(`Invalid ${response.provider} realtime transport`);
    }
  }

  private async initialize(): Promise<void> {
    if (this.provider === 'openai') {
      await this.connectOpenAI();
      return;
    }
    this.connectWebSocket(this.response.credential.value);
  }

  private connectWebSocket(credential: string, resumptionHandle?: string): void {
    const generation = ++this.googleSocketGeneration;
    const url = providerRealtimeURL(
      this.response.endpoint,
      this.provider,
      this.response.model,
      credential,
    );
    // Browser WebSockets cannot set Authorization. Each provider's browser
    // channel carries only the delegated credential as a subprotocol.
    const socket =
      this.provider === 'google'
        ? new WebSocket(url)
        : new WebSocket(url, [`xai-client-secret.${credential}`]);
    this.ws = socket;
    socket.addEventListener('open', () => {
      if (this.closed || this.ws !== socket) return;
      this.openedAtMs ??= Date.now();
      this.startTelemetry();
      socket.send(JSON.stringify(providerSessionUpdate(this.response, resumptionHandle)));
    });
    socket.addEventListener('message', (event) => {
      if (this.ws === socket) this.dispatchIncoming(event.data);
    });
    socket.addEventListener('close', (event) => {
      if (this.provider === 'google' && generation !== this.googleSocketGeneration) return;
      if (this.ws !== socket || this.closed) return;
      this.closed = true;
      this.finishTelemetry();
      this.emit({ type: 'close', code: event.code, reason: event.reason });
    });
    socket.addEventListener('error', () => {
      if (this.ws !== socket) return;
      this.emit({ type: 'error', code: 'WS_ERROR', message: 'Provider WebSocket transport error' });
    });
  }

  private async connectOpenAI(): Promise<void> {
    const endpoint = validatedOpenAIWebRTCEndpoint(this.response.endpoint);
    const sidebandUrl = validatedSidebandURL(
      this.response.sidebandUrl,
      this.telemetry.endpoint,
      this.sessionId,
    );
    const browser = browserRealtimeGlobals();
    const PeerConnection = browser.RTCPeerConnection;
    const AudioContext = browser.AudioContext;
    if (!PeerConnection || !AudioContext) {
      throw new Error('OpenAI realtime WebRTC requires browser WebRTC and Web Audio support');
    }

    const peer = new PeerConnection();
    this.peer = peer;
    const inputContext = new AudioContext({ sampleRate: this.inputSampleRate });
    const destination = inputContext.createMediaStreamDestination();
    this.inputAudioContext = inputContext;
    this.inputDestination = destination;
    const inputTrack = destination.stream.getAudioTracks()[0];
    if (!inputTrack) throw new Error('Unable to create the OpenAI realtime audio track');
    peer.addTrack(inputTrack, destination.stream);

    const channel = peer.createDataChannel('oai-events');
    this.dataChannel = channel;
    channel.addEventListener('open', () => {
      if (this.closed || this.dataChannel !== channel) return;
      this.openedAtMs = Date.now();
      this.startTelemetry();
      this.sendJson(providerSessionUpdate(this.response));
    });
    channel.addEventListener('message', (event) => this.dispatchIncoming(event.data));
    channel.addEventListener('error', () => {
      this.emit({
        type: 'error',
        code: 'WEBRTC_DATA_ERROR',
        message: 'OpenAI control channel error',
      });
    });
    peer.addEventListener('track', (event) => {
      if (event.track) this.attachOpenAIOutput(event.track);
    });
    peer.addEventListener('connectionstatechange', () => {
      if (this.closed || (peer.connectionState !== 'failed' && peer.connectionState !== 'closed')) {
        return;
      }
      this.close(1011, `webrtc_${peer.connectionState}`);
    });

    try {
      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      const offerSdp = peer.localDescription?.sdp;
      if (!offerSdp) throw new Error('OpenAI WebRTC offer has no SDP');
      const answer = await fetch(endpoint, {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(10_000),
        headers: {
          Authorization: `Bearer ${this.response.credential.value}`,
          'Content-Type': 'application/sdp',
        },
        body: offerSdp,
      });
      if (!answer.ok) {
        throw new Error(`OpenAI WebRTC setup failed with HTTP ${answer.status}`);
      }
      const callId = openAICallID(answer.headers.get('Location'));
      const answerSdp = await answer.text();
      if (!answerSdp || answerSdp.length > 128 << 10) {
        throw new Error('OpenAI WebRTC answer is invalid');
      }

      // Do not install the remote description (and therefore do not enable
      // media) until Speko has attached a provider-authenticated sideband.
      const bound = await fetch(sidebandUrl, {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(10_000),
        headers: {
          Authorization: `Bearer ${this.telemetry.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ attempt_id: this.attemptId, provider_session_id: callId }),
      });
      if (!bound.ok) {
        throw new Error(`OpenAI billing sideband failed with HTTP ${bound.status}`);
      }
      await peer.setRemoteDescription({ type: 'answer', sdp: answerSdp });
    } catch (error) {
      this.disposeTransports();
      throw error;
    }
  }

  private attachOpenAIOutput(track: BrowserMediaStreamTrack): void {
    const browser = browserRealtimeGlobals();
    const AudioContext = browser.AudioContext;
    const MediaStream = browser.MediaStream;
    if (this.closed || !AudioContext || !MediaStream) return;
    const context = new AudioContext({ sampleRate: this.outputSampleRate });
    const source = context.createMediaStreamSource(new MediaStream([track]));
    const processor = context.createScriptProcessor(2048, 1, 1);
    processor.onaudioprocess = (event) => {
      const samples = event.inputBuffer.getChannelData(0);
      const pcm = floatPCMTo16Bit(samples, context.sampleRate, this.outputSampleRate);
      if (pcm.byteLength > 0) {
        this.emit({ type: 'audio', pcm, sampleRate: this.outputSampleRate });
      }
    };
    source.connect(processor);
    processor.connect(context.destination);
    this.outputAudioContext = context;
    this.outputSource = source;
    this.outputProcessor = processor;
    void context.resume().catch(() => undefined);
  }

  sendAudio(pcm: Uint8Array): void {
    if (this.provider === 'openai') {
      this.sendOpenAIAudio(pcm);
      return;
    }
    if (this.isGoogle()) {
      this.sendJson({
        realtimeInput: {
          audio: { mimeType: 'audio/pcm;rate=16000', data: encodeBase64(pcm) },
        },
      });
      return;
    }
    this.sendJson({ type: 'input_audio_buffer.append', audio: encodeBase64(pcm) });
  }

  commit(): void {
    if (this.isGoogle()) {
      this.sendJson({ realtimeInput: { audioStreamEnd: true } });
      return;
    }
    this.sendJson({ type: 'input_audio_buffer.commit' });
    this.sendJson({ type: 'response.create' });
  }

  interrupt(): void {
    if (this.isGoogle()) {
      this.emit({ type: 'interruption', at: 'assistant' });
      return;
    }
    this.sendJson({ type: 'response.cancel' });
  }

  sendToolResult(callId: string, output: string): void {
    if (this.isGoogle()) {
      const name = this.googleToolNames.get(callId);
      this.googleToolNames.delete(callId);
      let response: unknown = { result: output };
      try {
        response = JSON.parse(output) as unknown;
      } catch {
        // Non-JSON tool results remain a string result.
      }
      this.sendJson({
        toolResponse: {
          functionResponses: [{ id: callId, ...(name ? { name } : {}), response }],
        },
      });
      return;
    }
    this.sendJson({
      type: 'conversation.item.create',
      item: { type: 'function_call_output', call_id: callId, output },
    });
    this.sendJson({ type: 'response.create' });
  }

  on(handler: RealtimeEventHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  close(code = 1000, reason = 'client_closed'): void {
    if (this.closed) return;
    this.closed = true;
    this.finishTelemetry();
    this.disposeTransports(code, reason);
  }

  private sendJson(payload: unknown): void {
    if (this.closed) return;
    const encoded = JSON.stringify(payload);
    if (this.provider === 'openai') {
      if (this.dataChannel?.readyState !== 'open') return;
      try {
        this.dataChannel.send(encoded);
      } catch {
        // A data-channel/peer state event is the authoritative signal.
      }
      return;
    }
    if (this.provider === 'google' && (!this.googleReady || this.ws?.readyState !== 1)) {
      // Keep rotation gaps media-lossless but bounded. At typical 20 ms chunks,
      // 128 messages is under three seconds of audio.
      if (this.pendingGoogleMessages.length < 128) this.pendingGoogleMessages.push(encoded);
      return;
    }
    if (this.ws?.readyState !== 1) return;
    try {
      this.ws.send(encoded);
    } catch {
      // A close/error event is the authoritative transport signal.
    }
  }

  private sendOpenAIAudio(pcm: Uint8Array): void {
    const context = this.inputAudioContext;
    const destination = this.inputDestination;
    if (this.closed || !context || !destination || pcm.byteLength < 2) return;
    const sampleCount = Math.floor(pcm.byteLength / 2);
    const buffer = context.createBuffer(1, sampleCount, this.inputSampleRate);
    const samples = buffer.getChannelData(0);
    const view = new DataView(pcm.buffer, pcm.byteOffset, sampleCount * 2);
    for (let index = 0; index < sampleCount; index += 1) {
      samples[index] = view.getInt16(index * 2, true) / 32768;
    }
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(destination);
    const startAt = Math.max(context.currentTime + 0.005, this.inputScheduledAt);
    source.start(startAt);
    this.inputScheduledAt = startAt + buffer.duration;
    source.addEventListener('ended', () => source.disconnect(), { once: true });
    void context.resume().catch(() => undefined);
  }

  private startTelemetry(): void {
    if (this.telemetryTimer !== null || this.telemetryFinished) return;
    this.telemetryTimer = setInterval(
      () => this.sendTelemetry(false),
      this.telemetry.flushIntervalMs,
    );
  }

  private disposeTransports(code = 1000, reason = 'client_closed'): void {
    if (this.renewalTimer !== null) clearTimeout(this.renewalTimer);
    this.renewalTimer = null;
    try {
      this.ws?.close(code, reason);
    } catch {
      // ignore
    }
    try {
      this.dataChannel?.close();
      this.peer?.close();
      this.outputSource?.disconnect();
      this.outputProcessor?.disconnect();
    } catch {
      // ignore
    }
    void this.inputAudioContext?.close().catch(() => undefined);
    void this.outputAudioContext?.close().catch(() => undefined);
    this.ws = null;
    this.dataChannel = null;
    this.peer = null;
  }

  private dispatchIncoming(data: unknown): void {
    if (typeof data !== 'string') return;
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(data) as Record<string, unknown>;
    } catch {
      return;
    }

    if (this.isGoogle()) {
      this.dispatchGoogle(event);
      return;
    }

    switch (event['type']) {
      case 'session.updated':
        this.emit({
          type: 'ready',
          inputSampleRate: this.inputSampleRate,
          outputSampleRate: this.outputSampleRate,
        });
        break;
      case 'response.output_audio.delta': {
        const delta = event['delta'];
        if (typeof delta === 'string' && delta) {
          this.emit({ type: 'audio', pcm: decodeBase64(delta), sampleRate: this.outputSampleRate });
        }
        break;
      }
      case 'conversation.item.input_audio_transcription.delta':
        this.emitTranscript('user', event['delta'], false);
        break;
      case 'conversation.item.input_audio_transcription.updated':
        // xAI publishes cumulative corrections rather than deltas.
        this.emitTranscript('user', event['transcript'], false);
        break;
      case 'conversation.item.input_audio_transcription.completed':
        this.emitTranscript('user', event['transcript'], true);
        break;
      case 'response.output_audio_transcript.delta':
        this.emitTranscript('assistant', event['delta'], false);
        break;
      case 'response.output_audio_transcript.done':
        this.emitTranscript('assistant', event['transcript'], true);
        break;
      case 'response.function_call_arguments.done':
        this.emit({
          type: 'tool_call',
          callId: String(event['call_id'] ?? ''),
          name: String(event['name'] ?? ''),
          arguments: String(event['arguments'] ?? ''),
        });
        break;
      case 'input_audio_buffer.speech_started':
        this.emit({ type: 'interruption', at: 'user' });
        break;
      case 'response.done': {
        const usage = asRecord(asRecord(event['response'])['usage']);
        const inputDetails = asRecord(usage['input_token_details']);
        const outputDetails = asRecord(usage['output_token_details']);
        this.emit({
          type: 'usage',
          inputAudioTokens: finiteNumber(inputDetails['audio_tokens']),
          outputAudioTokens: finiteNumber(outputDetails['audio_tokens']),
        });
        break;
      }
      case 'error': {
        const error = asRecord(event['error']);
        this.emit({
          type: 'error',
          code: String(error['code'] ?? 'PROVIDER_ERROR'),
          message: String(error['message'] ?? 'Provider realtime error'),
        });
        break;
      }
      default:
        break;
    }
  }

  private dispatchGoogle(event: Record<string, unknown>): void {
    if (event['setupComplete'] !== undefined) {
      this.googleReady = true;
      if (!this.googleReadyEmitted) {
        this.googleReadyEmitted = true;
        this.emit({
          type: 'ready',
          inputSampleRate: this.inputSampleRate,
          outputSampleRate: this.outputSampleRate,
        });
      }
      const socket = this.ws;
      if (socket?.readyState === 1) {
        for (const message of this.pendingGoogleMessages.splice(0)) socket.send(message);
      }
      this.scheduleGoogleRenewal();
    }
    const resumption = asRecord(event['sessionResumptionUpdate']);
    const newHandle = resumption['newHandle'];
    if (typeof newHandle === 'string' && newHandle) this.googleResumptionHandle = newHandle;
    const content = asRecord(event['serverContent']);
    const inputTranscription = asRecord(content['inputTranscription']);
    this.emitTranscript('user', inputTranscription['text'], Boolean(content['turnComplete']));
    const outputTranscription = asRecord(content['outputTranscription']);
    this.emitTranscript('assistant', outputTranscription['text'], Boolean(content['turnComplete']));
    const modelTurn = asRecord(content['modelTurn']);
    const parts = Array.isArray(modelTurn['parts']) ? modelTurn['parts'] : [];
    for (const value of parts) {
      const part = asRecord(value);
      const inlineData = asRecord(part['inlineData']);
      const audio = inlineData['data'];
      if (typeof audio === 'string' && audio) {
        this.emit({ type: 'audio', pcm: decodeBase64(audio), sampleRate: this.outputSampleRate });
      }
    }
    if (content['interrupted'] === true) {
      this.emit({ type: 'interruption', at: 'user' });
    }
    const toolCall = asRecord(event['toolCall']);
    const functionCalls = Array.isArray(toolCall['functionCalls']) ? toolCall['functionCalls'] : [];
    for (const value of functionCalls) {
      const call = asRecord(value);
      const callId = String(call['id'] ?? '');
      const name = String(call['name'] ?? '');
      if (callId && name) this.googleToolNames.set(callId, name);
      this.emit({
        type: 'tool_call',
        callId,
        name,
        arguments:
          typeof call['args'] === 'string' ? call['args'] : JSON.stringify(call['args'] ?? {}),
      });
    }
    const usage = asRecord(event['usageMetadata']);
    if (Object.keys(usage).length > 0) {
      this.emit({
        type: 'usage',
        inputAudioTokens: finiteNumber(usage['promptTokenCount']),
        outputAudioTokens: finiteNumber(usage['responseTokenCount']),
      });
    }
    const error = asRecord(event['error']);
    if (Object.keys(error).length > 0) {
      this.emit({
        type: 'error',
        code: String(error['status'] ?? error['code'] ?? 'PROVIDER_ERROR'),
        message: String(error['message'] ?? 'Gemini Live error'),
      });
    }
  }

  private emitTranscript(role: 'user' | 'assistant', value: unknown, final: boolean): void {
    if (typeof value === 'string' && value) {
      this.emit({ type: 'transcript', role, text: value, final });
    }
  }

  private emit(frame: RealtimeFrame): void {
    for (const handler of this.handlers) {
      try {
        handler(frame);
      } catch {
        // A consumer callback cannot break the provider event pump.
      }
    }
  }

  private isGoogle(): boolean {
    return this.provider === 'google';
  }

  private scheduleGoogleRenewal(): void {
    if (this.provider !== 'google' || this.closed) return;
    const renewalUrl = this.response.reservation.billing.renewalUrl;
    const renewableUntil = this.response.reservation.billing.renewableUntil;
    if (!renewalUrl || !renewableUntil) return;
    if (Date.parse(this.leaseExpiresAt) >= Date.parse(renewableUntil)) return;
    if (this.renewalTimer !== null) clearTimeout(this.renewalTimer);
    const remainingMs = Math.max(0, Date.parse(this.leaseExpiresAt) - Date.now());
    const leadMs = Math.min(15_000, Math.max(2_000, Math.floor(remainingMs / 5)));
    this.renewalTimer = setTimeout(
      () => void this.renewGoogleEntitlement(0),
      Math.max(0, remainingMs - leadMs),
    );
  }

  private async renewGoogleEntitlement(attempt: number): Promise<void> {
    if (this.closed || this.provider !== 'google') return;
    const previousExpiresAt = this.leaseExpiresAt;
    try {
      if (!this.googleResumptionHandle) {
        throw new Error('Gemini Live did not provide a session-resumption handle');
      }
      const renewalUrl = validatedRenewalURL(
        this.response.reservation.billing.renewalUrl,
        this.telemetry.endpoint,
        this.sessionId,
      );
      const response = await fetch(renewalUrl, {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(10_000),
        headers: {
          Authorization: `Bearer ${this.telemetry.token}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': `renew:${this.attemptId}:${previousExpiresAt}`,
        },
        body: JSON.stringify({ previous_expires_at: previousExpiresAt }),
      });
      if (!response.ok) throw new Error(`entitlement renewal failed with HTTP ${response.status}`);
      const renewal = (await response.json()) as EntitlementRenewalResponse;
      assertRenewalResponse(
        renewal,
        previousExpiresAt,
        this.response.reservation.billing.renewableUntil,
      );
      const oldSocket = this.ws;
      this.googleReady = false;
      this.googleSocketGeneration += 1;
      this.ws = null;
      try {
        oldSocket?.close(1000, 'entitlement_rotation');
      } catch {
        // The generation guard already suppresses a stale close event.
      }
      this.authorizedDurationMs += renewal.authorized_units * 1_000;
      this.leaseExpiresAt = renewal.lease_expires_at;
      this.connectWebSocket(renewal.credential.value, this.googleResumptionHandle);
    } catch (error) {
      const remainingMs = Date.parse(previousExpiresAt) - Date.now();
      if (attempt < 2 && remainingMs > 3_000) {
        this.renewalTimer = setTimeout(
          () => void this.renewGoogleEntitlement(attempt + 1),
          Math.min(2_000, Math.max(250, remainingMs - 2_000)),
        );
        return;
      }
      this.emit({
        type: 'error',
        code: 'ENTITLEMENT_RENEWAL_FAILED',
        message: error instanceof Error ? error.message : 'Gemini Live entitlement renewal failed',
      });
      this.renewalTimer = setTimeout(
        () => this.close(4003, 'entitlement_expired'),
        Math.max(0, remainingMs),
      );
    }
  }

  private finishTelemetry(): void {
    if (this.telemetryFinished) return;
    this.telemetryFinished = true;
    if (this.telemetryTimer !== null) {
      clearInterval(this.telemetryTimer);
      this.telemetryTimer = null;
    }
    this.sendTelemetry(true);
  }

  private sendTelemetry(terminal: boolean): void {
    if (this.telemetryFinished && !terminal) return;
    const createdAtMs = Date.now();
    const elapsed = this.openedAtMs === null ? 0 : Math.max(0, createdAtMs - this.openedAtMs);
    const quantityMillis = Math.min(this.authorizedDurationMs, elapsed);
    this.telemetrySequence += 1;
    const common = {
      session_id: this.sessionId,
      attempt_id: this.attemptId,
      created_at_ms: createdAtMs,
    };
    const events = [
      {
        ...common,
        type: 'usage.reported',
        event_id: `${this.attemptId}:usage.reported:${this.telemetrySequence}`,
        data: { unit: 'duration_seconds', quantity_millis: quantityMillis },
      },
      ...(terminal
        ? [
            {
              ...common,
              type: 'session.closed',
              event_id: `${this.attemptId}:session.closed`,
            },
          ]
        : []),
    ];
    void fetch(this.telemetry.endpoint, {
      method: 'POST',
      keepalive: true,
      headers: {
        Authorization: `Bearer ${this.telemetry.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ events }),
    }).catch(() => undefined);
  }
}

function providerSessionUpdate(
  response: SessionCreateResponse,
  resumptionHandle?: string,
): Record<string, unknown> {
  if (response.provider === 'google') return googleSessionSetup(response, resumptionHandle);
  if (response.provider === 'xai') return xAISessionUpdate(response);
  const session: Record<string, unknown> = {
    type: 'realtime',
    output_modalities: ['audio'],
    audio: {
      input: {
        format: { type: 'audio/pcm', rate: 24000 },
        transcription: { model: 'gpt-4o-mini-transcribe' },
        // RealtimeSessionHandle.commit() is the explicit turn boundary.
        turn_detection: null,
      },
      output: {
        format: { type: 'audio/pcm', rate: 24000 },
        ...(response.session.voice ? { voice: response.session.voice } : {}),
      },
    },
  };
  if (response.session.instructions !== undefined) {
    session['instructions'] = response.session.instructions;
  }
  if (response.session.tools) {
    session['tools'] = response.session.tools.map((tool) => ({ type: 'function', ...tool }));
    session['tool_choice'] = 'auto';
  }
  return { type: 'session.update', session };
}

function googleSessionSetup(
  response: SessionCreateResponse,
  resumptionHandle?: string,
): Record<string, unknown> {
  const generationConfig: Record<string, unknown> = { responseModalities: ['AUDIO'] };
  if (response.session.voice) {
    generationConfig['speechConfig'] = {
      voiceConfig: { prebuiltVoiceConfig: { voiceName: response.session.voice } },
    };
  }
  if (response.session.temperature !== undefined) {
    generationConfig['temperature'] = response.session.temperature;
  }
  const setup: Record<string, unknown> = {
    model: `models/${response.model.replace(/^models\//, '')}`,
    generationConfig,
    inputAudioTranscription: {},
    outputAudioTranscription: {},
    sessionResumption: resumptionHandle ? { handle: resumptionHandle } : {},
  };
  if (response.session.instructions !== undefined) {
    setup['systemInstruction'] = { parts: [{ text: response.session.instructions }] };
  }
  if (response.session.tools?.length) {
    setup['tools'] = [
      {
        functionDeclarations: response.session.tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
        })),
      },
    ];
  }
  return { setup };
}

function xAISessionUpdate(response: SessionCreateResponse): Record<string, unknown> {
  const session: Record<string, unknown> = {
    type: 'realtime',
    model: response.model,
    output_modalities: ['audio'],
    turn_detection: { type: 'server_vad' },
    audio: {
      input: {
        format: { type: 'audio/pcm', rate: 24000 },
        transcription: { model: 'grok-transcribe' },
      },
      output: { format: { type: 'audio/pcm', rate: 24000 } },
    },
  };
  if (response.session.voice !== undefined) session['voice'] = response.session.voice;
  if (response.session.instructions !== undefined) {
    session['instructions'] = response.session.instructions;
  }
  if (response.session.tools) {
    session['tools'] = response.session.tools.map((tool) => ({ type: 'function', ...tool }));
    session['tool_choice'] = 'auto';
  }
  return { type: 'session.update', session };
}

function providerRealtimeURL(
  endpoint: string,
  provider: SessionCreateResponse['provider'],
  model: string,
  credential: string,
): string {
  if (provider === 'openai') throw new Error('OpenAI realtime requires WebRTC');
  const url = new URL(endpoint);
  const expectedHost = provider === 'xai' ? 'api.x.ai' : 'generativelanguage.googleapis.com';
  const expectedPath =
    provider === 'google'
      ? '/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained'
      : '/v1/realtime';
  if (
    url.protocol !== 'wss:' ||
    url.hostname !== expectedHost ||
    (url.port && url.port !== '443') ||
    url.pathname !== expectedPath ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error(`Invalid ${provider} realtime endpoint`);
  }
  if (provider === 'google') {
    url.searchParams.set('access_token', credential);
  } else {
    url.searchParams.set('model', model);
  }
  return url.toString();
}

function validatedOpenAIWebRTCEndpoint(raw: string): string {
  const url = new URL(raw);
  if (
    url.protocol !== 'https:' ||
    url.hostname !== 'api.openai.com' ||
    (url.port && url.port !== '443') ||
    url.pathname !== '/v1/realtime/calls' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error('Invalid openai realtime endpoint');
  }
  return url.toString();
}

function validatedSidebandURL(
  raw: string | undefined,
  telemetryEndpoint: string,
  sessionId: string,
): string {
  if (!raw) throw new Error('OpenAI billing sideband URL is missing');
  const url = new URL(raw);
  const telemetry = new URL(telemetryEndpoint);
  if (
    url.protocol !== 'https:' ||
    url.origin !== telemetry.origin ||
    url.pathname !== `/v1/sessions/${encodeURIComponent(sessionId)}/sidebands/openai` ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error('Invalid OpenAI billing sideband URL');
  }
  return url.toString();
}

function validatedRenewalURL(
  raw: string | undefined,
  telemetryEndpoint: string,
  sessionId: string,
): string {
  if (!raw) throw new Error('Gemini Live entitlement renewal URL is missing');
  const url = new URL(raw);
  const telemetry = new URL(telemetryEndpoint);
  if (
    url.protocol !== 'https:' ||
    url.origin !== telemetry.origin ||
    url.pathname !== `/v1/sessions/${encodeURIComponent(sessionId)}/entitlements/renew` ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error('Invalid Gemini Live entitlement renewal URL');
  }
  return url.toString();
}

function openAICallID(location: string | null): string {
  if (!location) throw new Error('OpenAI WebRTC response did not include a call ID');
  const url = new URL(location, 'https://api.openai.com');
  if (url.origin !== 'https://api.openai.com' || url.search || url.hash) {
    throw new Error('OpenAI WebRTC call location is invalid');
  }
  const match = /^\/v1\/realtime\/calls\/([^/]+)$/.exec(url.pathname);
  const callId = match?.[1] ? decodeURIComponent(match[1]) : '';
  if (!/^[A-Za-z0-9_-]{8,256}$/.test(callId)) {
    throw new Error('OpenAI WebRTC call ID is invalid');
  }
  return callId;
}

function assertRenewalResponse(
  renewal: EntitlementRenewalResponse,
  previousExpiresAt: string,
  renewableUntil: string | undefined,
): void {
  const previousExpiryMs = Date.parse(previousExpiresAt);
  const leaseExpiryMs = Date.parse(renewal?.lease_expires_at);
  const credentialExpiryMs = Date.parse(renewal?.credential?.expires_at);
  const renewableUntilMs = Date.parse(renewableUntil ?? '');
  if (
    !renewal ||
    typeof renewal.entitlement_id !== 'string' ||
    !renewal.entitlement_id ||
    !Number.isInteger(renewal.sequence) ||
    renewal.sequence <= 0 ||
    !Number.isInteger(renewal.authorized_units) ||
    renewal.authorized_units <= 0 ||
    renewal.authorized_units > 300 ||
    !Number.isSafeInteger(renewal.maximum_amount_micros) ||
    renewal.maximum_amount_micros <= 0 ||
    renewal.currency !== 'USD' ||
    renewal.credential?.kind !== 'bearer' ||
    !renewal.credential.value ||
    !Number.isFinite(previousExpiryMs) ||
    !Number.isFinite(leaseExpiryMs) ||
    !Number.isFinite(credentialExpiryMs) ||
    !Number.isFinite(renewableUntilMs) ||
    leaseExpiryMs <= previousExpiryMs ||
    leaseExpiryMs > renewableUntilMs ||
    credentialExpiryMs < leaseExpiryMs
  ) {
    throw new Error('Gemini Live entitlement renewal response is invalid');
  }
}

function floatPCMTo16Bit(
  samples: Float32Array,
  inputSampleRate: number,
  outputSampleRate: number,
): Uint8Array {
  const ratio = inputSampleRate / outputSampleRate;
  const outputLength = Math.max(0, Math.floor(samples.length / Math.max(1, ratio)));
  const bytes = new Uint8Array(outputLength * 2);
  const view = new DataView(bytes.buffer);
  for (let outputIndex = 0; outputIndex < outputLength; outputIndex += 1) {
    const start = Math.floor(outputIndex * ratio);
    const end = Math.max(
      start + 1,
      Math.min(samples.length, Math.floor((outputIndex + 1) * ratio)),
    );
    let total = 0;
    for (let inputIndex = start; inputIndex < end; inputIndex += 1) {
      total += samples[inputIndex] ?? 0;
    }
    const sample = Math.max(-1, Math.min(1, total / (end - start)));
    view.setInt16(outputIndex * 2, sample < 0 ? sample * 32768 : sample * 32767, true);
  }
  return bytes;
}

function adapterForProvider(
  provider: SessionCreateResponse['provider'],
): SessionCreateResponse['adapter'] {
  if (provider === 'openai') return 'openai.realtime.v1';
  if (provider === 'xai') return 'xai.realtime.v1';
  return 'google.live.v1';
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.byteLength; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function finiteNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}
