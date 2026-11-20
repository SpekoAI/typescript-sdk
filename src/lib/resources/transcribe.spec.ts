import { describe, expect, it, vi } from 'vitest';
import type { HttpClient } from '../http.js';
import { Transcribe } from './transcribe.js';

type SseEvent = { event: string; id?: string; data: unknown };

/** The resource only needs the raw SSE call, so the fake records it and replays a script. */
function fakeHttp(events: SseEvent[]) {
  const requestRawSse = vi.fn(
    async (): Promise<AsyncIterableIterator<SseEvent>> =>
      (async function* () {
        for (const event of events) yield event;
      })(),
  );
  return { http: { requestRawSse } as unknown as HttpClient, requestRawSse };
}

const META: SseEvent = {
  event: 'meta',
  data: { provider: 'gemini', model: 'gemini-3.5-transcribe', failoverCount: 0, scoresRunId: null },
};

function done(extra: Record<string, unknown> = {}): SseEvent {
  return {
    event: 'done',
    data: {
      text: 'Your table is ready.',
      provider: 'gemini',
      model: 'gemini-3.5-transcribe',
      confidence: 0.97,
      failoverCount: 0,
      scoresRunId: null,
      ...extra,
    },
  };
}

describe('Transcribe.call', () => {
  it('surfaces the warnings the done frame carries', async () => {
    const warnings = [
      { kind: 'transcript_truncated', provider: 'gemini', model: 'gemini-3.5-transcribe' },
    ];
    const { http } = fakeHttp([META, done({ warnings })]);

    const result = await new Transcribe(http).call(new Uint8Array([1, 2, 3]), { language: 'en' });

    expect(result.text).toBe('Your table is ready.');
    expect(result.warnings).toEqual(warnings);
  });

  it('leaves warnings absent when the server sent none', async () => {
    const { http } = fakeHttp([META, done()]);

    const result = await new Transcribe(http).call(new Uint8Array([1, 2, 3]), { language: 'en' });

    expect('warnings' in result).toBe(false);
  });

  it('forwards the routing intent in the X-Speko-Intent header', async () => {
    const { http, requestRawSse } = fakeHttp([META, done()]);

    await new Transcribe(http).call(new Uint8Array([1, 2, 3]), { language: 'es-MX' });

    const [method, path, , headers] = requestRawSse.mock.calls[0] as unknown as [
      string,
      string,
      Uint8Array,
      Record<string, string>,
    ];
    expect([method, path]).toEqual(['POST', '/v1/transcribe']);
    expect(JSON.parse(headers['X-Speko-Intent'] ?? '{}')).toEqual({ language: 'es-MX' });
  });
});
