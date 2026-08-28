import { afterEach, describe, expect, it, vi } from 'vitest';
import { HttpClient } from '../http.js';
import type { RealtimeFrame } from '../types/index.js';
import { Realtime } from './realtime.js';

type Listener = (event: unknown) => void;

class FakeWebSocket {
  static readonly OPEN = 1;
  static instances: FakeWebSocket[] = [];

  readonly url: string;
  readonly protocols: string[];
  readonly sent: string[] = [];
  readyState: number = FakeWebSocket.OPEN;
  private readonly listeners = new Map<string, Listener[]>();

  constructor(url: string | URL, protocols?: string | string[]) {
    this.url = String(url);
    this.protocols = typeof protocols === 'string' ? [protocols] : (protocols ?? []);
    FakeWebSocket.instances.push(this);
  }

  addEventListener(type: string, listener: Listener): void {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  send(value: string): void {
    this.sent.push(value);
  }

  close(code = 1000, reason = ''): void {
    this.readyState = 3;
    this.emit('close', { code, reason });
  }

  emit(type: string, event: unknown): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

class FakeRTCDataChannel {
  readonly sent: string[] = [];
  readyState: RTCDataChannelState = 'open';
  private readonly listeners = new Map<string, Listener[]>();

  addEventListener(type: string, listener: Listener): void {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  send(value: string): void {
    this.sent.push(value);
  }

  close(): void {
    this.readyState = 'closed';
  }

  emit(type: string, event: unknown): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

class FakeRTCPeerConnection {
  static instances: FakeRTCPeerConnection[] = [];
  readonly channel = new FakeRTCDataChannel();
  connectionState: RTCPeerConnectionState = 'new';
  localDescription: RTCSessionDescriptionInit | null = null;
  remoteDescription: RTCSessionDescriptionInit | null = null;
  private readonly listeners = new Map<string, Listener[]>();

  constructor() {
    FakeRTCPeerConnection.instances.push(this);
  }

  addTrack(): void {}

  createDataChannel(): RTCDataChannel {
    return this.channel as unknown as RTCDataChannel;
  }

  async createOffer(): Promise<RTCSessionDescriptionInit> {
    return { type: 'offer', sdp: 'offer-sdp' };
  }

  async setLocalDescription(description: RTCSessionDescriptionInit): Promise<void> {
    this.localDescription = description;
  }

  async setRemoteDescription(description: RTCSessionDescriptionInit): Promise<void> {
    this.remoteDescription = description;
  }

  addEventListener(type: string, listener: Listener): void {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  close(): void {
    this.connectionState = 'closed';
  }
}

class FakeAudioContext {
  readonly sampleRate: number;
  readonly currentTime = 0;
  readonly destination = {} as AudioDestinationNode;
  scheduledSources = 0;

  constructor(options?: AudioContextOptions) {
    this.sampleRate = options?.sampleRate ?? 48_000;
  }

  createMediaStreamDestination(): MediaStreamAudioDestinationNode {
    return {
      stream: { getAudioTracks: () => [{ kind: 'audio' }] },
    } as unknown as MediaStreamAudioDestinationNode;
  }

  createBuffer(_channels: number, length: number, sampleRate: number): AudioBuffer {
    const samples = new Float32Array(length);
    return {
      duration: length / sampleRate,
      getChannelData: () => samples,
    } as unknown as AudioBuffer;
  }

  createBufferSource(): AudioBufferSourceNode {
    return {
      buffer: null,
      connect: () => undefined,
      disconnect: () => undefined,
      start: () => {
        this.scheduledSources += 1;
      },
      addEventListener: () => undefined,
    } as unknown as AudioBufferSourceNode;
  }

  async resume(): Promise<void> {}
  async close(): Promise<void> {}
}

function bootstrapResponse() {
  return {
    mode: 's2s',
    transport: 'provider_direct',
    sessionId: 'session-1',
    planId: 'plan-1',
    attemptId: 'attempt-1',
    provider: 'openai',
    model: 'gpt-realtime',
    adapter: 'openai.realtime.v1',
    providerTransport: 'webrtc',
    endpoint: 'https://api.openai.com/v1/realtime/calls',
    credential: { kind: 'bearer', value: 'ek-short-lived', expiresAt: '2100-01-01T00:05:00Z' },
    telemetry: {
      endpoint: 'https://control.speko.test/v1/runtime-events',
      token: 'telemetry-token',
      flushIntervalMs: 5000,
    },
    reservation: {
      id: 'reservation-1',
      authorizedDurationSeconds: 1800,
      leaseExpiresAt: '2100-01-01T00:05:00Z',
      billing: {
        mode: 'direct_entitlement',
        state: 'estimated',
        maximumAmountMicros: '180000',
        currency: 'USD',
      },
    },
    sidebandUrl: 'https://control.speko.test/v1/sessions/session-1/sidebands/openai',
    session: {
      voice: 'marin',
      instructions: 'Keep the answer short.',
      tools: [{ name: 'lookup', description: 'Look up a record.', parameters: { type: 'object' } }],
    },
    inputSampleRate: 24000,
    outputSampleRate: 24000,
    expiresAt: '2100-01-01T00:05:00Z',
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  FakeWebSocket.instances = [];
  FakeRTCPeerConnection.instances = [];
});

describe('Realtime provider-direct transport', () => {
  it('connects OpenAI over WebRTC only after its provider-authenticated sideband binds', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(bootstrapResponse(), { status: 201 }))
      .mockResolvedValueOnce(
        new Response('answer-sdp', {
          status: 201,
          headers: { Location: '/v1/realtime/calls/call_12345678' },
        }),
      )
      .mockResolvedValueOnce(Response.json({ status: 'bound' }, { status: 201 }))
      .mockResolvedValueOnce(Response.json({ accepted: 2, deduplicated: 0 }, { status: 202 }));
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('RTCPeerConnection', FakeRTCPeerConnection);
    vi.stubGlobal('AudioContext', FakeAudioContext);
    const realtime = new Realtime(
      new HttpClient({ baseUrl: 'https://api.speko.test', apiKey: 'sk-customer', timeout: 5000 }),
    );

    const handle = await realtime.connect({
      provider: 'openai',
      model: 'gpt-realtime',
      idempotencyKey: 'sdk-test-key',
    });
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({
      'Idempotency-Key': 'sdk-test-key',
    });
    const peer = FakeRTCPeerConnection.instances[0];
    if (!peer) throw new Error('provider peer was not created');
    const providerCall = fetchMock.mock.calls[1];
    expect(providerCall?.[0]).toBe('https://api.openai.com/v1/realtime/calls');
    expect(providerCall?.[1]).toMatchObject({
      method: 'POST',
      headers: {
        Authorization: 'Bearer ek-short-lived',
        'Content-Type': 'application/sdp',
      },
      body: 'offer-sdp',
    });
    const sidebandCall = fetchMock.mock.calls[2];
    expect(sidebandCall?.[0]).toBe(
      'https://control.speko.test/v1/sessions/session-1/sidebands/openai',
    );
    expect(JSON.parse(String(sidebandCall?.[1]?.body))).toEqual({
      attempt_id: 'attempt-1',
      provider_session_id: 'call_12345678',
    });
    expect(peer.remoteDescription).toEqual({ type: 'answer', sdp: 'answer-sdp' });

    peer.channel.emit('open', {});
    expect(JSON.parse(peer.channel.sent[0] ?? '{}')).toMatchObject({
      type: 'session.update',
      session: {
        instructions: 'Keep the answer short.',
        audio: { input: { turn_detection: null }, output: { voice: 'marin' } },
        tools: [{ type: 'function', name: 'lookup' }],
      },
    });

    handle.sendAudio(new Uint8Array([1, 2, 3]));
    handle.commit();
    handle.sendToolResult('call-1', '{"ok":true}');
    expect(peer.channel.sent.map((item) => JSON.parse(item)['type'])).toEqual([
      'session.update',
      'input_audio_buffer.commit',
      'response.create',
      'conversation.item.create',
      'response.create',
    ]);

    const frames: RealtimeFrame[] = [];
    handle.on((frame) => frames.push(frame));
    peer.channel.emit('message', { data: JSON.stringify({ type: 'session.updated' }) });
    peer.channel.emit('message', {
      data: JSON.stringify({ type: 'response.output_audio.delta', delta: 'BAUG' }),
    });
    peer.channel.emit('message', {
      data: JSON.stringify({
        type: 'response.done',
        response: {
          usage: {
            input_token_details: { audio_tokens: 12 },
            output_token_details: { audio_tokens: 7 },
          },
        },
      }),
    });
    expect(frames).toEqual([
      { type: 'ready', inputSampleRate: 24000, outputSampleRate: 24000 },
      { type: 'audio', pcm: new Uint8Array([4, 5, 6]), sampleRate: 24000 },
      { type: 'usage', inputAudioTokens: 12, outputAudioTokens: 7 },
    ]);

    handle.close();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    const telemetryCall = fetchMock.mock.calls[3];
    if (!telemetryCall) throw new Error('telemetry was not posted');
    expect(telemetryCall[0]).toBe('https://control.speko.test/v1/runtime-events');
    expect((telemetryCall[1]?.headers as Record<string, string>).Authorization).toBe(
      'Bearer telemetry-token',
    );
  });

  it('connects directly to xAI with its short-lived client-secret subprotocol', async () => {
    const response = {
      ...bootstrapResponse(),
      provider: 'xai',
      model: 'grok-voice-latest',
      adapter: 'xai.realtime.v1',
      providerTransport: 'websocket',
      endpoint: 'wss://api.x.ai/v1/realtime',
    };
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(Response.json(response)));
    vi.stubGlobal('WebSocket', FakeWebSocket);
    const realtime = new Realtime(
      new HttpClient({ baseUrl: 'https://api.speko.test', apiKey: 'sk-customer', timeout: 5000 }),
    );

    const handle = await realtime.connect({ provider: 'xai', model: 'grok-voice-latest' });
    const socket = FakeWebSocket.instances[0];
    if (!socket) throw new Error('provider socket was not created');
    expect(socket.url).toBe('wss://api.x.ai/v1/realtime?model=grok-voice-latest');
    expect(socket.protocols).toEqual(['xai-client-secret.ek-short-lived']);
    expect(socket.url).not.toContain('ek-short-lived');

    socket.emit('open', {});
    expect(JSON.parse(socket.sent[0] ?? '{}')).toMatchObject({
      type: 'session.update',
      session: {
        model: 'grok-voice-latest',
        instructions: 'Keep the answer short.',
        voice: 'marin',
        turn_detection: { type: 'server_vad' },
        audio: { input: { transcription: { model: 'grok-transcribe' } } },
      },
    });

    const frames: RealtimeFrame[] = [];
    handle.on((frame) => frames.push(frame));
    socket.emit('message', {
      data: JSON.stringify({
        type: 'conversation.item.input_audio_transcription.updated',
        item_id: 'item-1',
        transcript: 'hello from xAI',
      }),
    });
    expect(frames).toContainEqual({
      type: 'transcript',
      role: 'user',
      text: 'hello from xAI',
      final: false,
    });
  });

  it('connects directly to Gemini Live with a constrained ephemeral token', async () => {
    const response = {
      ...bootstrapResponse(),
      provider: 'google',
      model: 'gemini-3.1-flash-live-preview',
      adapter: 'google.live.v1',
      providerTransport: 'websocket',
      endpoint:
        'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained',
      inputSampleRate: 16000,
      outputSampleRate: 24000,
      session: {
        ...bootstrapResponse().session,
        voice: 'Puck',
        temperature: 0.7,
      },
    };
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(Response.json(response)));
    vi.stubGlobal('WebSocket', FakeWebSocket);
    const realtime = new Realtime(
      new HttpClient({ baseUrl: 'https://api.speko.test', apiKey: 'sk-customer', timeout: 5000 }),
    );

    const handle = await realtime.connect({
      provider: 'google',
      model: 'gemini-3.1-flash-live-preview',
    });
    const socket = FakeWebSocket.instances[0];
    if (!socket) throw new Error('provider socket was not created');
    expect(socket.url).toBe(
      'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained?access_token=ek-short-lived',
    );
    expect(socket.protocols).toEqual([]);

    socket.emit('open', {});
    expect(JSON.parse(socket.sent[0] ?? '{}')).toMatchObject({
      setup: {
        model: 'models/gemini-3.1-flash-live-preview',
        generationConfig: {
          responseModalities: ['AUDIO'],
          temperature: 0.7,
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Puck' } } },
        },
        systemInstruction: { parts: [{ text: 'Keep the answer short.' }] },
        tools: [{ functionDeclarations: [{ name: 'lookup' }] }],
      },
    });
    handle.sendAudio(new Uint8Array([1, 2, 3]));
    handle.commit();
    expect(socket.sent).toHaveLength(1);

    const frames: RealtimeFrame[] = [];
    handle.on((frame) => frames.push(frame));
    socket.emit('message', { data: JSON.stringify({ setupComplete: {} }) });
    expect(JSON.parse(socket.sent[1] ?? '{}')).toEqual({
      realtimeInput: { audio: { mimeType: 'audio/pcm;rate=16000', data: 'AQID' } },
    });
    expect(JSON.parse(socket.sent[2] ?? '{}')).toEqual({
      realtimeInput: { audioStreamEnd: true },
    });

    socket.emit('message', {
      data: JSON.stringify({
        serverContent: {
          modelTurn: {
            parts: [{ inlineData: { data: 'BAUG', mimeType: 'audio/pcm;rate=24000' } }],
          },
          outputTranscription: { text: 'hello' },
          turnComplete: true,
        },
        usageMetadata: { promptTokenCount: 4, responseTokenCount: 6 },
      }),
    });
    socket.emit('message', {
      data: JSON.stringify({
        toolCall: { functionCalls: [{ id: 'google-call-1', name: 'lookup', args: { id: 7 } }] },
      }),
    });
    expect(frames).toEqual([
      { type: 'ready', inputSampleRate: 16000, outputSampleRate: 24000 },
      { type: 'transcript', role: 'assistant', text: 'hello', final: true },
      { type: 'audio', pcm: new Uint8Array([4, 5, 6]), sampleRate: 24000 },
      { type: 'usage', inputAudioTokens: 4, outputAudioTokens: 6 },
      {
        type: 'tool_call',
        callId: 'google-call-1',
        name: 'lookup',
        arguments: '{"id":7}',
      },
    ]);
    handle.sendToolResult('google-call-1', '{"ok":true}');
    expect(JSON.parse(socket.sent[3] ?? '{}')).toEqual({
      toolResponse: {
        functionResponses: [{ id: 'google-call-1', name: 'lookup', response: { ok: true } }],
      },
    });
  });

  it('renews Gemini in prepaid five-minute slices and resumes on a fresh direct socket', async () => {
    vi.useFakeTimers();
    const now = new Date('2026-08-28T12:00:00.000Z');
    vi.setSystemTime(now);
    const initialExpiry = new Date(now.getTime() + 20_000).toISOString();
    const renewedExpiry = new Date(now.getTime() + 320_000).toISOString();
    const renewableUntil = new Date(now.getTime() + 620_000).toISOString();
    const response = {
      ...bootstrapResponse(),
      provider: 'google' as const,
      model: 'gemini-3.1-flash-live-preview',
      adapter: 'google.live.v1' as const,
      providerTransport: 'websocket' as const,
      endpoint:
        'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained',
      inputSampleRate: 16000 as const,
      credential: {
        kind: 'bearer' as const,
        value: 'google-initial-token',
        expiresAt: initialExpiry,
      },
      telemetry: {
        ...bootstrapResponse().telemetry,
        flushIntervalMs: 60_000,
      },
      reservation: {
        ...bootstrapResponse().reservation,
        authorizedDurationSeconds: 20,
        leaseExpiresAt: initialExpiry,
        billing: {
          ...bootstrapResponse().reservation.billing,
          renewalUrl: 'https://control.speko.test/v1/sessions/session-1/entitlements/renew',
          renewableUntil,
        },
      },
    };
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ accepted: 2, deduplicated: 0 }, { status: 202 }))
      .mockResolvedValueOnce(Response.json(response, { status: 201 }))
      .mockResolvedValueOnce(
        Response.json({
          entitlement_id: 'entitlement-2',
          sequence: 2,
          lease_expires_at: renewedExpiry,
          authorized_units: 300,
          maximum_amount_micros: 30_000,
          currency: 'USD',
          credential: {
            kind: 'bearer',
            value: 'google-renewed-token',
            expires_at: renewedExpiry,
          },
        }),
      );
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('WebSocket', FakeWebSocket);
    const realtime = new Realtime(
      new HttpClient({ baseUrl: 'https://api.speko.test', apiKey: 'sk-customer', timeout: 5000 }),
    );

    const handle = await realtime.connect({
      provider: 'google',
      model: 'gemini-3.1-flash-live-preview',
    });
    const firstSocket = FakeWebSocket.instances[0];
    if (!firstSocket) throw new Error('initial Gemini socket was not created');
    firstSocket.emit('open', {});
    firstSocket.emit('message', {
      data: JSON.stringify({
        setupComplete: {},
        sessionResumptionUpdate: { newHandle: 'resume-handle-1' },
      }),
    });

    await vi.advanceTimersByTimeAsync(16_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const renewalCall = fetchMock.mock.calls[1];
    expect(renewalCall?.[0]).toBe(
      'https://control.speko.test/v1/sessions/session-1/entitlements/renew',
    );
    expect(renewalCall?.[1]).toMatchObject({
      method: 'POST',
      headers: {
        Authorization: 'Bearer telemetry-token',
        'Content-Type': 'application/json',
        'Idempotency-Key': `renew:attempt-1:${initialExpiry}`,
      },
      body: JSON.stringify({ previous_expires_at: initialExpiry }),
    });
    expect(firstSocket.readyState).toBe(3);
    const secondSocket = FakeWebSocket.instances[1];
    if (!secondSocket) throw new Error('renewed Gemini socket was not created');
    expect(secondSocket.url).toContain('access_token=google-renewed-token');
    secondSocket.emit('open', {});
    expect(JSON.parse(secondSocket.sent[0] ?? '{}')).toMatchObject({
      setup: { sessionResumption: { handle: 'resume-handle-1' } },
    });
    handle.close();
  });

  it('rejects a routed or attacker-controlled endpoint before using the credential', async () => {
    const response = bootstrapResponse();
    response.endpoint = 'https://router.speko.dev/v1/realtime/calls';
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(Response.json(response)));
    vi.stubGlobal('RTCPeerConnection', FakeRTCPeerConnection);
    vi.stubGlobal('AudioContext', FakeAudioContext);
    const realtime = new Realtime(
      new HttpClient({ baseUrl: 'https://api.speko.test', apiKey: 'sk-customer', timeout: 5000 }),
    );
    await expect(realtime.connect({ provider: 'openai', model: 'gpt-realtime' })).rejects.toThrow(
      'Invalid openai realtime endpoint',
    );
    expect(FakeWebSocket.instances).toHaveLength(0);
  });
});
