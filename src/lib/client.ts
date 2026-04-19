import type {
  CompleteParams,
  CompleteResult,
  SpekoClientOptions,
  SynthesizeOptions,
  SynthesizeResult,
  TranscribeOptions,
  TranscribeResult,
} from './types/index.js';
import { HttpClient } from './http.js';
import { Usage } from './resources/usage.js';
import { Credits } from './resources/credits.js';
import { Transcribe } from './resources/transcribe.js';
import { Synthesize } from './resources/synthesize.js';
import { Complete } from './resources/complete.js';
import { Realtime } from './resources/realtime.js';

const DEFAULT_BASE_URL = 'https://api.speko.ai';
const DEFAULT_TIMEOUT = 30_000;

/**
 * Speko client — one API, every voice provider.
 *
 * @example
 * ```ts
 * import { Speko } from '@spekoai/sdk';
 *
 * const speko = new Speko({ apiKey: process.env.SPEKO_API_KEY });
 *
 * const { text, provider } = await speko.transcribe(audioBytes, {
 *   language: 'es-MX',
 *   vertical: 'healthcare',
 * });
 * ```
 */
export class Speko {
  readonly usage: Usage;
  readonly credits: Credits;
  readonly realtime: Realtime;

  private readonly transcribeResource: Transcribe;
  private readonly synthesizeResource: Synthesize;
  private readonly completeResource: Complete;

  constructor(options: SpekoClientOptions) {
    if (!options.apiKey) {
      throw new Error(
        'Speko: apiKey is required. Get one at https://dashboard.speko.ai/api-keys',
      );
    }

    const http = new HttpClient({
      baseUrl: options.baseUrl ?? DEFAULT_BASE_URL,
      apiKey: options.apiKey,
      timeout: options.timeout ?? DEFAULT_TIMEOUT,
    });

    this.usage = new Usage(http);
    this.credits = new Credits(http);
    this.realtime = new Realtime(http);
    this.transcribeResource = new Transcribe(http);
    this.synthesizeResource = new Synthesize(http);
    this.completeResource = new Complete(http);
  }

  /**
   * Transcribe audio. The router picks the best STT provider for your
   * `(language, vertical, optimizeFor)` and fails over automatically.
   *
   * Pass an `AbortSignal` to cancel the in-flight request — useful when a
   * calling framework (e.g. LiveKit Agents) tears down a session mid-call.
   */
  transcribe(
    audio: Uint8Array,
    options: TranscribeOptions,
    abortSignal?: AbortSignal,
  ): Promise<TranscribeResult> {
    return this.transcribeResource.call(audio, options, abortSignal);
  }

  /**
   * Synthesize text into audio. The router picks the best TTS provider and
   * fails over automatically. The result includes the audio bytes plus the
   * provider's native content type.
   */
  synthesize(
    text: string,
    options: SynthesizeOptions,
    abortSignal?: AbortSignal,
  ): Promise<SynthesizeResult> {
    return this.synthesizeResource.call(text, options, abortSignal);
  }

  /**
   * Run an LLM completion. The router picks the best LLM provider and fails
   * over automatically.
   */
  complete(
    params: CompleteParams,
    abortSignal?: AbortSignal,
  ): Promise<CompleteResult> {
    return this.completeResource.call(params, abortSignal);
  }
}
