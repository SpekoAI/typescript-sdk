import type { HttpClient } from '../http.js';
import type { SessionTranscript } from '../types/index.js';

/**
 * Session-scoped reads. A `sessionId` is the id returned by
 * `voice.dial(...)` / session create — the same id `calls.*` accepts.
 */
export class Sessions {
  constructor(private readonly http: HttpClient) {}

  /**
   * Live transcript of a session, oldest turn first. Cheap enough to poll
   * (~2 s) while a call is running; includes per-turn latency legs and any
   * tool calls the agent made on the turn.
   */
  transcript(sessionId: string): Promise<SessionTranscript> {
    return this.http.get<SessionTranscript>(
      `/v1/sessions/${encodeURIComponent(sessionId)}/transcript`,
    );
  }
}
