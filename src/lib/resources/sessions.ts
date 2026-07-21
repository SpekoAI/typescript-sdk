import { SpekoApiError } from '../errors.js';
import type { HttpClient } from '../http.js';
import type {
  CallEvent,
  SessionStreamEvent,
  SessionStreamOptions,
  SessionTranscript,
  SessionTranscriptEntry,
} from '../types/index.js';

/** Consecutive failed connect attempts (no frame received) before giving up. */
const MAX_RECONNECT_ATTEMPTS = 10;
/**
 * Per-connection cap, above the server's own stream rotation (10 min +
 * `end {reason:'timeout'}`) so the server always rotates first and this
 * client-side abort only nets a server that went quiet.
 */
const STREAM_REQUEST_TIMEOUT_MS = 15 * 60_000;

/**
 * Session-scoped reads. A `sessionId` is the id returned by
 * `voice.dial(...)` / session create — the same id `calls.*` accepts.
 */
export class Sessions {
  constructor(private readonly http: HttpClient) {}

  /**
   * Transcript of a session, oldest turn first — the point-in-time snapshot.
   * For live consumption prefer `stream()`, which pushes each turn as it
   * lands; this endpoint stays the final word on per-turn latency numbers
   * (legs keep enriching after a turn is first written).
   */
  transcript(sessionId: string): Promise<SessionTranscript> {
    return this.http.get<SessionTranscript>(
      `/v1/sessions/${encodeURIComponent(sessionId)}/transcript`,
    );
  }

  /**
   * Observe a session live: transcript turns, call events, and status changes
   * pushed as they happen (SSE under the hood). Iterate until `end` — the
   * SDK reconnects through server stream rotations and transient drops with
   * an internal cursor, so consumers never poll and never see duplicates.
   *
   * ```ts
   * for await (const ev of speko.sessions.stream(sessionId)) {
   *   if (ev.type === 'transcript') render(ev.turn);
   *   if (ev.type === 'event') timeline(ev.event.event_type);
   *   if (ev.type === 'end') break; // session over
   * }
   * ```
   *
   * A stream opened on an already-ended session replays the backlog and then
   * ends, so late subscribers converge on the same picture.
   *
   * The no-duplicates guarantee holds per iterator: reconnects re-read a
   * short server-side overlap window, and this iterator filters the replays
   * by event id. A brand-new iterator resumed via `options.cursor` (process
   * restart) starts with no memory and may replay up to ~2 s of events —
   * dedupe by `event.id` if that matters to you.
   */
  async *stream(
    sessionId: string,
    options: SessionStreamOptions = {},
  ): AsyncIterableIterator<SessionStreamEvent> {
    // Cursor is derived from payloads (max turn index / max event created_at),
    // so resume needs no SSE `id:` plumbing in the shared HTTP client.
    let turnIndex = -1;
    let eventMs = 0;
    if (options.cursor) {
      const m = /^(-?\d+):(\d+)$/.exec(options.cursor.trim());
      if (m?.[1] !== undefined && m[2] !== undefined) {
        turnIndex = Number(m[1]);
        eventMs = Number(m[2]);
      }
    }

    // Every reconnect re-reads the server's overlap window (its own dedupe
    // state dies with the response), so the iterator remembers delivered
    // event ids to keep replays away from the consumer. Retention is by the
    // EVENT's timestamp falling behind the cursor window — the same invariant
    // the server uses — never by count: a capacity ring can evict ids that a
    // reconnect is still allowed to replay (a >capacity burst inside the
    // overlap window), reintroducing duplicates. All timestamps are
    // DB-stamped, so no client clock is involved; the horizon just needs to
    // comfortably exceed the server's 2 s overlap re-read. Turns need no
    // dedupe — their cursor (`index`) is exact and resumed with strict `>`.
    const SEEN_EVENT_WINDOW_MS = 10_000;
    const seenEvents = new Map<string, number>();
    const rememberEvent = (id: string, createdMs: number) => {
      seenEvents.set(id, Number.isFinite(createdMs) ? createdMs : eventMs);
      for (const [seenId, seenMs] of seenEvents) {
        if (seenMs < eventMs - SEEN_EVENT_WINDOW_MS) seenEvents.delete(seenId);
      }
    };

    let failedAttempts = 0;
    while (true) {
      if (options.signal?.aborted) return;
      let receivedFrame = false;
      try {
        const path =
          `/v1/sessions/${encodeURIComponent(sessionId)}/stream` +
          `?cursor=${turnIndex}:${eventMs}`;
        const frames = this.http.requestSse(
          'GET',
          path,
          undefined,
          options.signal,
          { Accept: 'text/event-stream' },
          STREAM_REQUEST_TIMEOUT_MS,
        );
        for await (const frame of frames) {
          receivedFrame = true;
          failedAttempts = 0;
          switch (frame.event) {
            case 'status': {
              const data = frame.data as { status: string; endedAt: string | null };
              yield { type: 'status', status: data.status, endedAt: data.endedAt ?? null };
              break;
            }
            case 'transcript': {
              const turn = frame.data as SessionTranscriptEntry;
              turnIndex = Math.max(turnIndex, turn.index);
              yield { type: 'transcript', turn };
              break;
            }
            case 'event': {
              const event = frame.data as CallEvent;
              const createdMs = Date.parse(event.created_at);
              if (Number.isFinite(createdMs)) eventMs = Math.max(eventMs, createdMs);
              if (seenEvents.has(event.id)) break;
              rememberEvent(event.id, createdMs);
              yield { type: 'event', event };
              break;
            }
            case 'end': {
              const data = frame.data as { reason: string };
              if (data.reason === 'session_ended') {
                yield { type: 'end', reason: 'session_ended' };
                return;
              }
              // 'timeout' is the server rotating a long response — reconnect.
              break;
            }
            default:
              // 'error' or unknown frame: the server closes after these;
              // fall through to the reconnect path below.
              break;
          }
        }
      } catch (err) {
        if (options.signal?.aborted) return;
        // Auth failures and unknown sessions are not transient — surface them.
        if (err instanceof SpekoApiError && err.status >= 400 && err.status < 500) {
          throw err;
        }
        // Anything else (network drop, mid-stream abort) → reconnect below.
      }
      if (options.signal?.aborted) return;
      if (!receivedFrame) {
        failedAttempts += 1;
        if (failedAttempts >= MAX_RECONNECT_ATTEMPTS) {
          throw new SpekoApiError(
            `session stream: ${MAX_RECONNECT_ATTEMPTS} consecutive reconnect attempts failed`,
            0,
            'STREAM_DISCONNECTED',
          );
        }
      }
      await new Promise((resolve) =>
        setTimeout(resolve, Math.min(500 * Math.max(failedAttempts, 1), 5000)),
      );
    }
  }
}
