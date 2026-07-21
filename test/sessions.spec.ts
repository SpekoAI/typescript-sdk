import { afterEach, describe, expect, it, vi } from 'vitest';
import { HttpClient } from '../src/lib/http.js';
import { Sessions } from '../src/lib/resources/sessions.js';
import type { SessionStreamEvent } from '../src/lib/types/index.js';

const T0 = Date.parse('2026-07-22T10:00:00.000Z');

function sse(...frames: Array<{ event: string; data: unknown }>): string {
  return frames.map((f) => `event: ${f.event}\ndata: ${JSON.stringify(f.data)}\n\n`).join('');
}

function turn(index: number, text: string) {
  return {
    id: `turn_${index}`,
    index,
    source: 'agent',
    text,
    startedAt: new Date(T0).toISOString(),
    endedAt: null,
    provider: null,
    model: null,
    eouMs: null,
    llmTtftMs: null,
    ttsTtfbMs: null,
    latencyStatus: null,
    conversationalLatencyMs: null,
    toolCalls: [],
  };
}

function callEvent(id: string, createdMs: number) {
  return {
    id,
    session_id: 'sess_1',
    organization_id: 'org_1',
    provider: 'speko',
    event_type: 'sip.dial_started',
    status: null,
    failure_cause: null,
    sip_status_code: null,
    sip_status: null,
    occurred_at: new Date(createdMs).toISOString(),
    payload: {},
    created_at: new Date(createdMs).toISOString(),
  };
}

/** Serve each scripted body once, recording the URLs fetch was called with. */
function stubFetch(bodies: Array<string | { status: number; body: string }>) {
  const urls: string[] = [];
  const queue = [...bodies];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string | URL) => {
      urls.push(String(url));
      const next = queue.shift();
      if (next === undefined) throw new Error('fetch called more times than scripted');
      if (typeof next === 'string') {
        return new Response(next, {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        });
      }
      return new Response(next.body, {
        status: next.status,
        headers: { 'Content-Type': 'application/json' },
      });
    }),
  );
  return urls;
}

function makeSessions(): Sessions {
  return new Sessions(
    new HttpClient({ baseUrl: 'https://api.test', apiKey: 'sk_test', timeout: 5000 }),
  );
}

async function collect(iter: AsyncIterableIterator<SessionStreamEvent>) {
  const events: SessionStreamEvent[] = [];
  for await (const ev of iter) events.push(ev);
  return events;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('sessions.stream', () => {
  it('yields status, transcript, and event frames, ending on session_ended', async () => {
    stubFetch([
      sse(
        { event: 'status', data: { status: 'active', endedAt: null } },
        { event: 'transcript', data: turn(0, 'hello') },
        { event: 'event', data: callEvent('ev_1', T0) },
        { event: 'end', data: { reason: 'session_ended' } },
      ),
    ]);

    const events = await collect(makeSessions().stream('sess_1'));
    expect(events.map((e) => e.type)).toEqual(['status', 'transcript', 'event', 'end']);
    expect(events[1]).toMatchObject({ turn: { index: 0, text: 'hello' } });
    expect(events.at(-1)).toEqual({ type: 'end', reason: 'session_ended' });
  });

  it('reconnects after a server rotation with the advanced cursor', async () => {
    const urls = stubFetch([
      sse(
        { event: 'status', data: { status: 'active', endedAt: null } },
        { event: 'transcript', data: turn(3, 'first half') },
        { event: 'event', data: callEvent('ev_1', T0) },
        { event: 'end', data: { reason: 'timeout' } },
      ),
      sse(
        { event: 'transcript', data: turn(4, 'second half') },
        { event: 'end', data: { reason: 'session_ended' } },
      ),
    ]);

    const events = await collect(makeSessions().stream('sess_1'));
    expect(events.filter((e) => e.type === 'transcript')).toHaveLength(2);
    expect(events.at(-1)).toEqual({ type: 'end', reason: 'session_ended' });
    // The rotation is invisible to the consumer but the second request resumes
    // where the first left off.
    expect(urls).toHaveLength(2);
    expect(urls[0]).toContain('cursor=-1:0');
    expect(urls[1]).toContain(`cursor=3:${T0}`);
  });

  it('filters overlap replays across reconnects by event id', async () => {
    // The server's dedupe state dies with each response, so a rotation
    // replays the overlap window; the iterator must swallow the repeat.
    stubFetch([
      sse(
        { event: 'status', data: { status: 'active', endedAt: null } },
        { event: 'event', data: callEvent('ev_1', T0) },
        { event: 'end', data: { reason: 'timeout' } },
      ),
      sse(
        { event: 'event', data: callEvent('ev_1', T0) }, // overlap replay
        { event: 'event', data: callEvent('ev_2', T0 + 10) },
        { event: 'end', data: { reason: 'session_ended' } },
      ),
    ]);

    const events = await collect(makeSessions().stream('sess_1'));
    const ids = events
      .filter((e) => e.type === 'event')
      .map((e) => (e as { event: { id: string } }).event.id);
    expect(ids).toEqual(['ev_1', 'ev_2']);
  });

  it('dedupes a replayed burst larger than any fixed ring capacity', async () => {
    // 600 events inside the overlap window, all replayed after a rotation:
    // retention keyed on the event's own timestamp must remember every one
    // of them (a 512-capacity FIFO evicted the first 88 and let them through
    // twice).
    const burst = Array.from({ length: 600 }, (_, i) => ({
      event: 'event',
      data: callEvent(`ev_${i}`, T0 + i),
    }));
    stubFetch([
      sse({ event: 'status', data: { status: 'active', endedAt: null } }, ...burst, {
        event: 'end',
        data: { reason: 'timeout' },
      }),
      sse(
        ...burst, // full overlap replay
        { event: 'event', data: callEvent('ev_new', T0 + 700) },
        { event: 'end', data: { reason: 'session_ended' } },
      ),
    ]);

    const events = await collect(makeSessions().stream('sess_1'));
    const ids = events
      .filter((e) => e.type === 'event')
      .map((e) => (e as { event: { id: string } }).event.id);
    expect(ids).toHaveLength(601);
    expect(new Set(ids).size).toBe(601);
    expect(ids.at(-1)).toBe('ev_new');
  });

  it('propagates 4xx immediately instead of retrying', async () => {
    const urls = stubFetch([
      { status: 404, body: JSON.stringify({ error: 'Session not found', code: 'NOT_FOUND' }) },
    ]);
    await expect(collect(makeSessions().stream('sess_missing'))).rejects.toMatchObject({
      status: 404,
    });
    expect(urls).toHaveLength(1);
  });

  it('stops when the abort signal fires', async () => {
    const controller = new AbortController();
    stubFetch([
      sse(
        { event: 'status', data: { status: 'active', endedAt: null } },
        { event: 'end', data: { reason: 'timeout' } },
      ),
    ]);
    const events: SessionStreamEvent[] = [];
    for await (const ev of makeSessions().stream('sess_1', { signal: controller.signal })) {
      events.push(ev);
      controller.abort(); // stop before any reconnect happens
    }
    expect(events.map((e) => e.type)).toEqual(['status']);
  });
});
