import { afterEach, describe, expect, it, vi } from 'vitest';
import { SpekoRateLimitError } from '../src/lib/errors.js';
import { HttpClient } from '../src/lib/http.js';

function stub429(retryAfter: string | null) {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(JSON.stringify({ error: 'Too many requests', code: 'RATE_LIMITED' }), {
          status: 429,
          headers: {
            'Content-Type': 'application/json',
            ...(retryAfter === null ? {} : { 'Retry-After': retryAfter }),
          },
        }),
    ),
  );
}

async function rateLimitError(): Promise<SpekoRateLimitError> {
  const http = new HttpClient({ baseUrl: 'https://api.test', apiKey: 'sk_test', timeout: 5000 });
  const err = await http.get('/v1/usage').catch((e: unknown) => e);
  expect(err).toBeInstanceOf(SpekoRateLimitError);
  return err as SpekoRateLimitError;
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('SpekoRateLimitError.retryAfter', () => {
  it('reads delay-seconds', async () => {
    stub429('120');
    expect((await rateLimitError()).retryAfter).toBe(120);
  });

  it('converts an HTTP-date into seconds from now', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-28T10:00:00.000Z'));
    stub429('Wed, 28 Oct 2026 10:00:30 GMT');
    expect((await rateLimitError()).retryAfter).toBe(30);
  });

  it('clamps an HTTP-date in the past to 0', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-28T10:00:00.000Z'));
    stub429('Wed, 28 Oct 2026 09:59:00 GMT');
    expect((await rateLimitError()).retryAfter).toBe(0);
  });

  it('is null when the header is missing or unparseable', async () => {
    stub429(null);
    expect((await rateLimitError()).retryAfter).toBeNull();
    stub429('soon');
    expect((await rateLimitError()).retryAfter).toBeNull();
  });
});
