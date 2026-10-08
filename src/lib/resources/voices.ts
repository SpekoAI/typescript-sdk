import type { HttpClient } from '../http.js';
import type { VoicesListParams, VoicesListResult } from '../types/index.js';

/**
 * Read-only TTS voice catalog. Use this to browse the curated list of
 * voices per provider before calling `speko.synthesize` — handy for
 * picking a voice id without reading each provider's API docs.
 *
 * ElevenLabs voices are account-scoped and are NOT returned by this
 * endpoint; the response's `providers` array sets
 * `voicesFetchedLive: true` on the elevenlabs entry as a signal to
 * fetch them directly from ElevenLabs at runtime.
 *
 * @example
 * ```ts
 * // All voices, every provider:
 * const { voices, providers } = await speko.voices.list();
 *
 * // Just Cartesia:
 * const cartesia = await speko.voices.list({ provider: 'cartesia' });
 * ```
 */
export class Voices {
  constructor(private readonly http: HttpClient) {}

  async list(params?: VoicesListParams): Promise<VoicesListResult> {
    const query = new URLSearchParams();
    if (params?.provider) query.set('provider', params.provider);
    const qs = query.toString();
    return this.http.get<VoicesListResult>(`/v1/voices${qs ? `?${qs}` : ''}`);
  }
}
