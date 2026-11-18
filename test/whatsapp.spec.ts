import { afterEach, describe, expect, it, vi } from 'vitest';
import { Speko } from '../src/lib/client.js';

afterEach(() => vi.unstubAllGlobals());

function mockFetch(body: unknown, status = 200) {
  const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function sent(fetchMock: ReturnType<typeof mockFetch>) {
  const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  return {
    url,
    method: init.method,
    body: init.body === undefined ? undefined : JSON.parse(init.body as string),
  };
}

const speko = () => new Speko({ apiKey: 'sk_test', baseUrl: 'https://api.test' });

describe('speko.whatsapp', () => {
  it('connects with the REST body', async () => {
    const fetchMock = mockFetch({ id: 'connection_1' }, 201);
    await speko().whatsapp.connect({
      accessToken: 'EAAG-token',
      appSecret: 'app-secret',
      phoneNumberId: '123456789012345',
      agentId: null,
    });
    expect(sent(fetchMock)).toEqual({
      url: 'https://api.test/v1/whatsapp/connections',
      method: 'POST',
      body: {
        accessToken: 'EAAG-token',
        appSecret: 'app-secret',
        phoneNumberId: '123456789012345',
        agentId: null,
      },
    });
  });

  it('lists numbers', async () => {
    const fetchMock = mockFetch({ data: [] });
    expect(await speko().whatsapp.listNumbers()).toEqual({ data: [] });
    expect(sent(fetchMock)).toEqual({
      url: 'https://api.test/v1/whatsapp/numbers',
      method: 'GET',
      body: undefined,
    });
  });

  it('sets the agent on a number', async () => {
    const fetchMock = mockFetch({ id: 'number_1' });
    await speko().whatsapp.updateNumber('number_1', { agentId: 'agent_1' });
    expect(sent(fetchMock)).toEqual({
      url: 'https://api.test/v1/whatsapp/numbers/number_1',
      method: 'PATCH',
      body: { agentId: 'agent_1' },
    });
  });

  it('disconnects a connection', async () => {
    const fetchMock = mockFetch({ id: 'connection_1', revokedAt: '2026-11-17T12:00:00.000Z' });
    expect(await speko().whatsapp.disconnect('connection_1')).toEqual({
      id: 'connection_1',
      revokedAt: '2026-11-17T12:00:00.000Z',
    });
    expect(sent(fetchMock)).toEqual({
      url: 'https://api.test/v1/whatsapp/connections/connection_1',
      method: 'DELETE',
      body: undefined,
    });
  });
});
