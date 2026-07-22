import { afterEach, describe, expect, it, vi } from 'vitest';
import { Speko } from '../src/lib/client.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

function respond(body: unknown, status = 200) {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: status === 204 ? undefined : { 'Content-Type': 'application/json' },
  });
}

function mockFetch(...responses: Response[]) {
  const fetchMock = vi.fn<typeof fetch>();
  for (const response of responses) fetchMock.mockResolvedValueOnce(response);
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('speko.webhooks', () => {
  it('creates endpoints without leaking write-only secrets into the response contract', async () => {
    const endpoint = {
      id: '11111111-1111-4111-8111-111111111111',
      name: 'Production',
      url: 'https://hooks.example.com/speko',
      events: ['call.report'],
      allAgents: true,
      agentIds: [],
      filterTags: { environment: 'production' },
      headers: {},
      authHeaders: [{ name: 'Authorization', configured: true }],
      timeoutMs: 4000,
      signingSecretSource: 'custom',
      hasCustomSigningSecret: true,
      extractionFields: [],
      legacyManaged: false,
      createdAt: '2026-07-22T10:00:00.000Z',
      updatedAt: '2026-07-22T10:00:00.000Z',
    };
    const fetchMock = mockFetch(respond(endpoint));
    const speko = new Speko({ apiKey: 'sk_test', baseUrl: 'https://api.test' });

    await expect(
      speko.webhooks.create({
        name: 'Production',
        url: endpoint.url,
        events: ['call.report'],
        filterTags: { environment: 'production' },
        signingSecretSource: 'custom',
        signingSecret: 'signing-secret',
        authHeaders: [{ name: 'Authorization', value: 'Bearer token' }],
      }),
    ).resolves.toEqual(endpoint);

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://api.test/v1/webhooks');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toMatchObject({
      signingSecret: 'signing-secret',
      authHeaders: [{ name: 'Authorization', value: 'Bearer token' }],
    });
  });

  it('serializes delivery filters and follows the detail/redelivery paths', async () => {
    const fetchMock = mockFetch(
      respond({ data: [], nextCursor: null, endpointOptions: [] }),
      respond({ id: 'delivery_1', attemptCount: 0, requestPayload: {}, attempts: [] }),
      respond({ delivered: true, httpStatus: 204, error: null }),
    );
    const speko = new Speko({ apiKey: 'sk_test', baseUrl: 'https://api.test' });

    await speko.webhooks.deliveries.list({
      endpointId: '11111111-1111-4111-8111-111111111111',
      event: 'call.report',
      status: 'failed',
      cursor: 'opaque cursor',
      limit: 25,
    });
    await speko.webhooks.deliveries.get('delivery_1');
    await speko.webhooks.deliveries.redeliver('delivery_1');

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'https://api.test/v1/webhook-deliveries?endpointId=11111111-1111-4111-8111-111111111111&event=call.report&status=failed&cursor=opaque+cursor&limit=25',
    );
    expect(fetchMock.mock.calls[1]?.[0]).toBe('https://api.test/v1/webhook-deliveries/delivery_1');
    expect(fetchMock.mock.calls[2]?.[0]).toBe(
      'https://api.test/v1/webhook-deliveries/delivery_1/redeliver',
    );
    expect((fetchMock.mock.calls[2]?.[1] as RequestInit).method).toBe('POST');
  });

  it('accepts a 204 response when deleting an endpoint', async () => {
    const fetchMock = mockFetch(respond(null, 204));
    const speko = new Speko({ apiKey: 'sk_test', baseUrl: 'https://api.test' });

    await expect(speko.webhooks.delete('endpoint_1')).resolves.toBeUndefined();
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://api.test/v1/webhooks/endpoint_1');
    expect((fetchMock.mock.calls[0]?.[1] as RequestInit).method).toBe('DELETE');
  });
});
