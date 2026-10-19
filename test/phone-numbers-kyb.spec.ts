import { afterEach, describe, expect, it, vi } from 'vitest';
import { Speko } from '../src/lib/client.js';

afterEach(() => vi.unstubAllGlobals());

describe('speko.phoneNumbers.submitKyb', () => {
  it('serializes the minimal declaration contract', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ status: 'submitted' }), {
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const speko = new Speko({ apiKey: 'sk_test', baseUrl: 'https://api.test' });

    await speko.phoneNumbers.submitKyb({
      declaration: {
        businessName: 'Acme Inc.',
        useCase: 'Inbound support and opted-in reminders',
      },
      attestationAccepted: true,
      attestationVersion: 'phone-communications-v1',
    });

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({
      declaration: {
        businessName: 'Acme Inc.',
        useCase: 'Inbound support and opted-in reminders',
      },
      attestationAccepted: true,
      attestationVersion: 'phone-communications-v1',
    });
  });
});
