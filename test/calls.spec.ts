import { afterEach, describe, expect, it, vi } from 'vitest';
import { SpekoApiError } from '../src/index.js';
import { HttpClient } from '../src/lib/http.js';
import { Calls } from '../src/lib/resources/calls.js';

const credentials = {
  token: 'tok_abc',
  url: 'wss://media.test',
  identity: 'listen-7f3a',
  roomName: 'call-room-1',
  expiresAt: '2026-11-11T10:01:00.000Z',
};

function makeCalls(): Calls {
  return new Calls(
    new HttpClient({ apiKey: 'sk_test', baseUrl: 'https://api.test', timeout: 5000 }),
  );
}

function mockFetch(response: Response) {
  const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(response);
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('calls.listen', () => {
  it('POSTs the listen route with the encoded call id and returns the credentials', async () => {
    const fetchMock = mockFetch(jsonResponse(credentials));

    const result = await makeCalls().listen('sess/1');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe('https://api.test/v1/calls/sess%2F1/listen');
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: 'POST' });
    expect(result).toEqual(credentials);
  });

  it('rejects with the server error code when the call is over', async () => {
    mockFetch(jsonResponse({ error: 'Call is not live', code: 'CALL_NOT_LIVE' }, 409));

    const error = await makeCalls()
      .listen('sess_1')
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(SpekoApiError);
    expect(error).toMatchObject({ status: 409, code: 'CALL_NOT_LIVE' });
  });
});

describe('calls.listen at the listener limit', () => {
  it('rejects with LISTENER_LIMIT_REACHED as a plain API error', async () => {
    mockFetch(jsonResponse({ error: 'Too many listeners', code: 'LISTENER_LIMIT_REACHED' }, 409));

    const error = await makeCalls()
      .listen('sess_1')
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(SpekoApiError);
    expect(error).toMatchObject({ status: 409, code: 'LISTENER_LIMIT_REACHED' });
  });
});

describe('calls.webJoin', () => {
  it('POSTs the web-join route with the display name and returns the credentials', async () => {
    const fetchMock = mockFetch(jsonResponse(credentials));

    const result = await makeCalls().webJoin('sess/1', { displayName: 'Dana' });

    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      'https://api.test/v1/calls/sess%2F1/web-join',
    );
    const init = fetchMock.mock.calls[0]?.[1];
    expect(init).toMatchObject({ method: 'POST' });
    expect(JSON.parse(String(init?.body))).toEqual({ displayName: 'Dana' });
    expect(result).toEqual(credentials);
  });
});
