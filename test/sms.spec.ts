import { afterEach, describe, expect, it, vi } from 'vitest';
import { Speko } from '../src/lib/client.js';

afterEach(() => vi.unstubAllGlobals());

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

describe('speko.sms', () => {
  it('sends with a separate Idempotency-Key and snake_case JSON', async () => {
    const fetchMock = mockFetch(respond({ id: 'message_1', status: 'queued' }, 202));
    const speko = new Speko({ apiKey: 'sk_test', baseUrl: 'https://api.test' });

    await speko.sms.messages.send({
      from_phone_number_id: 'number_1',
      to: '+12025550123',
      text: 'Hello',
      recipient_timezone: 'America/New_York',
      idempotencyKey: 'customer-message-1',
    });

    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://api.test/v1/sms/messages');
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(init.method).toBe('POST');
    expect(new Headers(init.headers).get('Idempotency-Key')).toBe('customer-message-1');
    expect(JSON.parse(init.body as string)).toEqual({
      from_phone_number_id: 'number_1',
      to: '+12025550123',
      text: 'Hello',
      recipient_timezone: 'America/New_York',
    });
  });

  it('covers batch, conversation, consent, suppression, and settings resources', async () => {
    const fetchMock = mockFetch(
      respond({ id: 'batch_1' }, 202),
      respond({ data: [], next_cursor: null }),
      respond({ id: 'conversation_1' }),
      respond({ data: [], imported: 0 }, 201),
      respond({ data: [], next_cursor: null }),
      respond({ retention_days: 365 }),
    );
    const speko = new Speko({ apiKey: 'sk_test', baseUrl: 'https://api.test' });

    await speko.sms.batches.create({
      from_phone_number_id: 'number_1',
      recipients: [{ to: '+12025550123', text: 'Hello' }],
      idempotencyKey: 'batch-1',
    });
    await speko.sms.conversations.list({ unread: true, limit: 25 });
    await speko.sms.conversations.update('conversation_1', { automation_status: 'paused' });
    await speko.sms.consents.import([]);
    await speko.sms.suppressions.list({ active: false });
    await speko.sms.settings.update({ retention_days: 365 });

    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      'https://api.test/v1/sms/batches',
      'https://api.test/v1/sms/conversations?unread=true&limit=25',
      'https://api.test/v1/sms/conversations/conversation_1',
      'https://api.test/v1/sms/consents/import',
      'https://api.test/v1/sms/suppressions?active=false',
      'https://api.test/v1/sms/settings',
    ]);
  });
});
