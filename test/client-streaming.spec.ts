import { afterEach, describe, expect, it, vi } from 'vitest';
import { Speko } from '../src/lib/client.js';

const encoder = new TextEncoder();

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Speko streaming endpoints', () => {
  it('aggregates transcribe SSE into the legacy result shape', async () => {
    const fetchMock = mockFetch(
      new Response(
        textStream(
          sse('meta', {
            provider: 'deepgram',
            model: 'nova-3',
            failoverCount: 0,
            scoresRunId: 'run_1',
          }),
          sse('transcript', {
            text: 'hello',
            isFinal: true,
            confidence: 0.91,
          }),
          sse('done', {
            text: 'hello',
            provider: 'deepgram',
            model: 'nova-3',
            confidence: 0.91,
            failoverCount: 0,
            scoresRunId: 'run_1',
          }),
        ),
        {
          headers: { 'Content-Type': 'text/event-stream' },
        },
      ),
    );

    const speko = new Speko({ apiKey: 'sk_test', baseUrl: 'https://api.test' });
    const result = await speko.transcribe(new Uint8Array([1, 2, 3]), {
      language: 'en',
      contentType: 'audio/wav',
    });

    expect(result).toEqual({
      text: 'hello',
      provider: 'deepgram',
      model: 'nova-3',
      confidence: 0.91,
      failoverCount: 0,
      scoresRunId: 'run_1',
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.test/v1/transcribe',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer sk_test',
          'Content-Type': 'audio/wav',
        }),
      }),
    );
  });

  it('exposes transcribe SSE events directly', async () => {
    mockFetch(
      new Response(
        textStream(
          sse('meta', {
            provider: 'deepgram',
            model: 'nova-3',
            failoverCount: 0,
            scoresRunId: null,
          }),
          sse('transcript', {
            text: 'partial',
            isFinal: false,
            confidence: 0.8,
          }),
          sse('done', {
            text: 'partial',
            provider: 'deepgram',
            model: 'nova-3',
            confidence: 0.8,
            failoverCount: 0,
            scoresRunId: null,
          }),
        ),
        {
          headers: { 'Content-Type': 'text/event-stream' },
        },
      ),
    );

    const speko = new Speko({ apiKey: 'sk_test', baseUrl: 'https://api.test' });
    const events = await collect(speko.transcribeStream(new Uint8Array([1]), { language: 'en' }));

    expect(events.map((event) => event.type)).toEqual(['meta', 'transcript', 'done']);
    expect(events[1]).toEqual({
      type: 'transcript',
      text: 'partial',
      isFinal: false,
      confidence: 0.8,
    });
  });

  it('aggregates complete SSE into the legacy result shape', async () => {
    mockFetch(
      new Response(
        textStream(
          sse('meta', {
            provider: 'openai',
            model: 'gpt-4o-mini',
            failoverCount: 0,
            totalFailoverCount: 0,
            scoresRunId: 'run_llm',
            hop: 0,
          }),
          sse('delta', { text: 'Hel' }),
          sse('delta', { text: 'lo' }),
          sse('done', {
            text: 'Hello',
            provider: 'openai',
            model: 'gpt-4o-mini',
            usage: { promptTokens: 4, completionTokens: 2 },
            failoverCount: 0,
            scoresRunId: 'run_llm',
          }),
        ),
        {
          headers: { 'Content-Type': 'text/event-stream' },
        },
      ),
    );

    const speko = new Speko({ apiKey: 'sk_test', baseUrl: 'https://api.test' });
    const result = await speko.complete({
      messages: [{ role: 'user', content: 'Hi' }],
      intent: { language: 'en' },
    });

    expect(result).toEqual({
      text: 'Hello',
      provider: 'openai',
      model: 'gpt-4o-mini',
      usage: { promptTokens: 4, completionTokens: 2 },
      failoverCount: 0,
      scoresRunId: 'run_llm',
    });
  });

  it('exposes complete SSE events directly', async () => {
    mockFetch(
      new Response(
        textStream(
          sse('meta', {
            provider: 'openai',
            model: 'gpt-4o-mini',
            failoverCount: 0,
            totalFailoverCount: 0,
            scoresRunId: null,
            hop: 0,
          }),
          sse('delta', { text: 'Hello' }),
          sse('tool_call', {
            id: 'call_1',
            name: 'lookup',
            args: '{"q":"x"}',
          }),
          sse('done', {
            text: 'Hello',
            provider: 'openai',
            model: 'gpt-4o-mini',
            usage: { promptTokens: 4, completionTokens: 2 },
            failoverCount: 0,
            scoresRunId: null,
            toolCalls: [
              {
                id: 'call_1',
                name: 'lookup',
                args: '{"q":"x"}',
              },
            ],
          }),
        ),
        {
          headers: { 'Content-Type': 'text/event-stream' },
        },
      ),
    );

    const speko = new Speko({ apiKey: 'sk_test', baseUrl: 'https://api.test' });
    const events = await collect(
      speko.completeStream({
        messages: [{ role: 'user', content: 'Hi' }],
        intent: { language: 'en' },
      }),
    );

    expect(events.map((event) => event.type)).toEqual(['meta', 'delta', 'tool_call', 'done']);
    expect(events[2]).toEqual({
      type: 'tool_call',
      id: 'call_1',
      name: 'lookup',
      args: '{"q":"x"}',
    });
  });

  it('aggregates synthesize chunks into the legacy result shape', async () => {
    mockFetch(
      new Response(byteStream(new Uint8Array([1, 2]), new Uint8Array([3])), {
        headers: {
          'Content-Type': 'audio/mpeg',
          'X-Speko-Provider': 'elevenlabs',
          'X-Speko-Model': 'eleven_multilingual_v2',
          'X-Speko-Failover-Count': '1',
          'X-Speko-Scores-Run-Id': 'run_tts',
        },
      }),
    );

    const speko = new Speko({ apiKey: 'sk_test', baseUrl: 'https://api.test' });
    const result = await speko.synthesize('Hello', { language: 'en' });

    expect([...result.audio]).toEqual([1, 2, 3]);
    expect(result).toMatchObject({
      contentType: 'audio/mpeg',
      provider: 'elevenlabs',
      model: 'eleven_multilingual_v2',
      failoverCount: 1,
      scoresRunId: 'run_tts',
    });
  });

  it('exposes synthesize chunks directly with response headers', async () => {
    mockFetch(
      new Response(byteStream(new Uint8Array([4]), new Uint8Array([5, 6])), {
        headers: {
          'Content-Type': 'audio/pcm;rate=24000',
          'X-Speko-Provider': 'cartesia',
          'X-Speko-Model': 'sonic-2',
          'X-Speko-Failover-Count': '0',
        },
      }),
    );

    const speko = new Speko({ apiKey: 'sk_test', baseUrl: 'https://api.test' });
    const result = await speko.synthesizeStream('Hello', { language: 'en' });

    expect(result.contentType).toBe('audio/pcm;rate=24000');
    expect(result.provider).toBe('cartesia');
    expect(result.model).toBe('sonic-2');
    expect(result.failoverCount).toBe(0);
    expect((await collect(result)).map((chunk) => [...chunk])).toEqual([[4], [5, 6]]);
  });
});

function mockFetch(response: Response) {
  const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(response);
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function sse(event: string, data: unknown): Uint8Array {
  return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function textStream(...chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return byteStream(...chunks);
}

function byteStream(...chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(chunk);
      }
      controller.close();
    },
  });
}

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of iterable) {
    out.push(item);
  }
  return out;
}
