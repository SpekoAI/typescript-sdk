import { afterEach, describe, expect, it, vi } from 'vitest';
import { Speko } from '../src/lib/client.js';
import type { CallControlDialResult } from '../src/lib/types/index.js';
import {
  CALL_COMMANDS,
  type CallCommandResult,
  type CallJoinCredentials,
  type CallLegResource,
  type CallResource,
  VOICE_ERROR_CODES,
} from '../src/lib/voice-contract.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

const ISO = '2026-07-27T00:00:00.000Z';

function leg(overrides: Partial<CallLegResource> = {}): CallLegResource {
  return {
    id: 'leg_1',
    controlId: 'ctl_browser',
    callId: 'call_1',
    kind: 'browser',
    direction: 'outbound',
    status: 'active',
    brokerId: 'broker_1',
    phoneNumber: null,
    muted: false,
    onHold: false,
    answeredAt: ISO,
    endedAt: null,
    endReason: null,
    createdAt: ISO,
    ...overrides,
  };
}

const call: CallResource = {
  id: 'call_1',
  direction: 'outbound',
  status: 'ringing',
  answeredAt: null,
  endedAt: null,
  endReason: null,
  legs: [
    leg(),
    leg({
      id: 'leg_2',
      controlId: 'ctl_pstn',
      kind: 'pstn',
      status: 'ringing',
      brokerId: null,
      phoneNumber: '+12015551234',
      answeredAt: null,
    }),
  ],
  createdAt: ISO,
};

const credentials: CallJoinCredentials = {
  token: 'jwt',
  url: 'wss://livekit.test',
  identity: 'broker-user_1',
  roomName: 'call-1',
  expiresAt: ISO,
};

/** `POST /v1/voice/calls` answers 201 with the call AND the dialer's join credentials. */
const dialResult: CallControlDialResult = { call, join: credentials };

function client(): Speko {
  return new Speko({ apiKey: 'sk_test', brokerId: 'broker_1', baseUrl: 'https://api.test' });
}

describe('speko.callControl calls', () => {
  it('dials over POST /v1/voice/calls and returns the call AND join credentials', async () => {
    // The wrapper is load-bearing, not cosmetic: the dialing broker has to be in
    // the room before the far end answers, so the token ships with the call. A
    // mock shaped like a bare CallResource is how this went unnoticed.
    const fetchMock = mockFetch(jsonResponse(dialResult, 201));

    const { call: dialed, join } = await client().callControl.dial({
      to: '+12015551234',
      from: '+14155550000',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.test/v1/voice/calls',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer sk_test' }),
      }),
    );
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    // The SDK instance owns broker identity; individual method calls do not.
    expect(JSON.parse(init.body as string)).toEqual({
      to: '+12015551234',
      from: '+14155550000',
      brokerId: 'broker_1',
    });
    expect(dialed.legs.map((l) => l.controlId)).toEqual(['ctl_browser', 'ctl_pstn']);
    expect(join).toEqual(credentials);
  });

  it('encodes the call id on get and events', async () => {
    const fetchMock = mockFetch(jsonResponse({ events: [] }));
    const speko = client();

    await speko.callControl.events('call/1');
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://api.test/v1/voice/calls/call%2F1/events');
  });

  it('serializes list filters into the query string and omits absent ones', async () => {
    const fetchMock = mockFetch(jsonResponse({ calls: [call] }));

    await client().callControl.list({ status: 'active', brokerId: 'broker_1', limit: 10 });

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'https://api.test/v1/voice/calls?status=active&brokerId=broker_1&limit=10',
    );
  });

  it('sends no query string when list is unfiltered', async () => {
    const fetchMock = mockFetch(jsonResponse({ calls: [] }));

    await client().callControl.list();

    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://api.test/v1/voice/calls');
  });

  it('joins a leg over POST /v1/voice/legs/:controlId/join and returns fresh credentials', async () => {
    // The inbound counterpart to dial: a ring hands you your own leg's
    // controlId, and this is the only way to get a room token for it.
    const fetchMock = mockFetch(jsonResponse(credentials));

    const joined = await client().callControl.join('ctl/browser');

    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://api.test/v1/voice/legs/ctl%2Fbrowser/join');
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ brokerId: 'broker_1' });
    expect(joined).toEqual(credentials);
  });

  it('surfaces NOT_FOUND when joining a leg the caller does not own', async () => {
    // A foreign leg is deliberately indistinguishable from a missing one, so a
    // controlId cannot be probed for existence.
    mockFetch(
      new Response(JSON.stringify({ error: 'not found', code: VOICE_ERROR_CODES.notFound }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await expect(client().callControl.join('ctl_someone_else')).rejects.toMatchObject({
      status: 404,
      code: 'NOT_FOUND',
    });
  });
});

describe('speko.callControl commands', () => {
  const result: CallCommandResult = { leg: leg({ muted: true }) };

  it('addresses every contract command to the leg action endpoint', async () => {
    // One method per CALL_COMMANDS entry, each hitting
    // /v1/voice/legs/:controlId/actions/:command — the mapping a Telnyx
    // integration is ported against, so drift here is a breaking change.
    const speko = client();
    const calls: Record<string, () => Promise<CallCommandResult>> = {
      answer: () => speko.callControl.answer('ctl_1'),
      hangup: () => speko.callControl.hangup('ctl_1'),
      bridge: () => speko.callControl.bridge('ctl_1', { bridgeTo: 'ctl_2' }),
      hold: () => speko.callControl.hold('ctl_1'),
      unhold: () => speko.callControl.unhold('ctl_1'),
      mute: () => speko.callControl.mute('ctl_1'),
      unmute: () => speko.callControl.unmute('ctl_1'),
      dtmf: () => speko.callControl.dtmf('ctl_1', { digits: '1w2' }),
      transfer: () => speko.callControl.transfer('ctl_1', { to: '+12015559876', mode: 'warm' }),
    };

    expect(Object.keys(calls).sort()).toEqual([...CALL_COMMANDS].sort());

    for (const command of CALL_COMMANDS) {
      const fetchMock = mockFetch(jsonResponse(result));
      await calls[command]?.();
      expect(fetchMock.mock.calls[0]?.[0]).toBe(
        `https://api.test/v1/voice/legs/ctl_1/actions/${command}`,
      );
      expect((fetchMock.mock.calls[0]?.[1] as RequestInit).method).toBe('POST');
    }
  });

  it('sends the command payload as the body, and {} for payload-less verbs', async () => {
    const speko = client();

    const noPayload = mockFetch(jsonResponse(result));
    await speko.callControl.hold('ctl_1');
    expect(JSON.parse((noPayload.mock.calls[0]?.[1] as RequestInit).body as string)).toEqual({});

    const withPayload = mockFetch(jsonResponse(result));
    await speko.callControl.transfer('ctl_1', { to: '+12015559876', mode: 'blind' });
    expect(JSON.parse((withPayload.mock.calls[0]?.[1] as RequestInit).body as string)).toEqual({
      to: '+12015559876',
      mode: 'blind',
    });
  });

  it('encodes the control id into the path', async () => {
    const fetchMock = mockFetch(jsonResponse(result));

    await client().callControl.mute('ctl/1');

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'https://api.test/v1/voice/legs/ctl%2F1/actions/mute',
    );
  });

  it('surfaces a contract error code on SpekoApiError.code', async () => {
    mockFetch(
      new Response(
        JSON.stringify({ error: 'Leg is not live', code: VOICE_ERROR_CODES.legNotLive }),
        { status: 409, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    await expect(client().callControl.hold('ctl_dead')).rejects.toMatchObject({
      status: 409,
      code: 'LEG_NOT_LIVE',
    });
  });
});

describe('speko.callControl presence', () => {
  const presence = {
    brokerId: 'broker_1',
    status: 'available',
    lastSeenAt: ISO,
    reachable: true,
  };

  it('registers by putting an available status', async () => {
    const fetchMock = mockFetch(jsonResponse(presence));

    await client().callControl.register();

    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://api.test/v1/voice/presence');
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body as string)).toEqual({
      status: 'available',
      brokerId: 'broker_1',
    });
  });

  it('sets an explicit status', async () => {
    const fetchMock = mockFetch(jsonResponse({ ...presence, status: 'busy' }));

    const updated = await client().callControl.setStatus('busy');

    expect(JSON.parse((fetchMock.mock.calls[0]?.[1] as RequestInit).body as string)).toEqual({
      status: 'busy',
      brokerId: 'broker_1',
    });
    expect(updated.status).toBe('busy');
  });

  it('heartbeats and mints a presence token over POST', async () => {
    const speko = client();

    const beat = mockFetch(jsonResponse(presence));
    await speko.callControl.heartbeat();
    expect(beat.mock.calls[0]?.[0]).toBe('https://api.test/v1/voice/presence/heartbeat');
    expect((beat.mock.calls[0]?.[1] as RequestInit).method).toBe('POST');
    expect(JSON.parse((beat.mock.calls[0]?.[1] as RequestInit).body as string)).toEqual({
      brokerId: 'broker_1',
    });

    const token = mockFetch(
      jsonResponse({
        token: 'jwt',
        url: 'wss://livekit.test',
        identity: 'broker_1',
        roomName: 'presence:org_1:broker_1',
        expiresAt: ISO,
      }),
    );
    const credentials = await speko.callControl.presenceToken();
    expect(token.mock.calls[0]?.[0]).toBe('https://api.test/v1/voice/presence/token');
    expect(JSON.parse((token.mock.calls[0]?.[1] as RequestInit).body as string)).toEqual({
      brokerId: 'broker_1',
    });
    expect(credentials.roomName).toBe('presence:org_1:broker_1');
  });

  it('fails locally when a broker-scoped method is used without brokerId', async () => {
    const speko = new Speko({ apiKey: 'sk_test', baseUrl: 'https://api.test' });

    expect(() => speko.callControl.heartbeat()).toThrow(/brokerId is required/);
  });
});

describe('speko.voice.dial', () => {
  it('still dials an AI agent through /v1/sessions/phone', async () => {
    // The programmable-voice resource is mounted alongside, not on top of, the
    // agent dial that shipped in 0.x — this asserts the older surface is intact.
    const fetchMock = mockFetch(jsonResponse({ sessionId: 'sess_1', status: 'initiating' }));

    await client().voice.dial({ to: '+12015551234', agentId: 'agent_1' });

    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://api.test/v1/sessions/phone');
  });
});

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
