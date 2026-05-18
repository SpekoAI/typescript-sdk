import type { HttpClient } from '../http.js';
import type { VoiceDialParams, VoiceDialResult } from '../types/index.js';

/**
 * Outbound phone calls via Speko's Telnyx-backed gateway.
 *
 * @example
 * ```ts
 * const { sessionId, status } = await speko.voice.dial({
 *   to: '+12015551234',
 *   intent: { language: 'en', optimizeFor: 'latency' },
 *   systemPrompt: 'You are a helpful Speko assistant. Greet the caller in English.',
 * });
 * console.log('dialing:', sessionId, status);
 * ```
 */
export class Voice {
  constructor(private readonly http: HttpClient) {}

  /**
   * Place an outbound call. The destination's phone rings; once they pick
   * up, audio bridges to a Speko worker running the configured pipeline
   * (STT→LLM→TTS) on a LiveKit room.
   *
   * Lifecycle is observable via Telnyx webhooks (which Speko handles
   * server-side) and reflected in the `voice_session` row's `status`.
   */
  async dial(params: VoiceDialParams): Promise<VoiceDialResult> {
    return this.http.post<VoiceDialResult>('/v1/sessions/phone', params);
  }
}
