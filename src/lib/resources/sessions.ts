import type { HttpClient } from '../http.js';
import type {
  CreateSessionParams,
  Session,
  SessionDetail,
} from '../types/index.js';

export class Sessions {
  constructor(private readonly http: HttpClient) {}

  /**
   * Create a new voice session.
   *
   * @example
   * ```ts
   * const session = await speko.sessions.create({
   *   pipeline: {
   *     stt: { provider: 'deepgram' },
   *     llm: { provider: 'openai', model: 'gpt-4o' },
   *     tts: { provider: 'elevenlabs', voice: 'rachel' },
   *   },
   * });
   * console.log(session.token); // Use to connect via LiveKit
   * ```
   */
  async create(params: CreateSessionParams): Promise<Session> {
    return this.http.post<Session>('/v1/sessions', params);
  }

  /**
   * Get a session by ID.
   *
   * @example
   * ```ts
   * const session = await speko.sessions.get('sess_abc123');
   * ```
   */
  async get(sessionId: string): Promise<SessionDetail> {
    return this.http.get<SessionDetail>(`/v1/sessions/${sessionId}`);
  }

  /**
   * End an active session.
   *
   * @example
   * ```ts
   * await speko.sessions.end('sess_abc123');
   * ```
   */
  async end(sessionId: string): Promise<{ id: string; status: string }> {
    return this.http.delete<{ id: string; status: string }>(
      `/v1/sessions/${sessionId}`,
    );
  }
}
