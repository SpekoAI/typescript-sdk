import type { SpekoClientOptions } from './types/index.js';
import { HttpClient } from './http.js';
import { Sessions } from './resources/sessions.js';
import { Usage } from './resources/usage.js';

const DEFAULT_BASE_URL = 'https://api.speko.ai';
const DEFAULT_TIMEOUT = 30_000;

/**
 * SpekoAI client for the Voice AI gateway.
 *
 * @example
 * ```ts
 * import { SpekoAI } from '@spekoai/sdk';
 *
 * const speko = new SpekoAI({ apiKey: 'sk_live_...' });
 *
 * // Create a voice session
 * const session = await speko.sessions.create({
 *   pipeline: {
 *     stt: { provider: 'deepgram' },
 *     llm: { provider: 'openai', model: 'gpt-4o' },
 *     tts: { provider: 'elevenlabs', voice: 'rachel' },
 *   },
 * });
 *
 * // Connect to LiveKit with the returned token
 * console.log(session.livekitUrl, session.token);
 * ```
 */
export class SpekoAI {
  readonly sessions: Sessions;
  readonly usage: Usage;

  constructor(options: SpekoClientOptions) {
    if (!options.apiKey) {
      throw new Error(
        'SpekoAI: apiKey is required. Get one at https://dashboard.speko.ai/api-keys',
      );
    }

    const http = new HttpClient({
      baseUrl: options.baseUrl ?? DEFAULT_BASE_URL,
      apiKey: options.apiKey,
      timeout: options.timeout ?? DEFAULT_TIMEOUT,
    });

    this.sessions = new Sessions(http);
    this.usage = new Usage(http);
  }
}
