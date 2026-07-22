import { HttpClient } from './http.js';
import { Agents } from './resources/agents.js';
import { Callbacks } from './resources/callbacks.js';
import { Calls } from './resources/calls.js';
import { Complete } from './resources/complete.js';
import { Credits } from './resources/credits.js';
import { KnowledgeBases } from './resources/knowledge-bases.js';
import { PhoneNumbers } from './resources/phone-numbers.js';
import { Realtime } from './resources/realtime.js';
import { Sessions } from './resources/sessions.js';
import { Synthesize } from './resources/synthesize.js';
import { Transcribe } from './resources/transcribe.js';
import { Usage } from './resources/usage.js';
import { Voice } from './resources/voice.js';
import { Voices } from './resources/voices.js';
import { Webhooks } from './resources/webhooks.js';
import type {
  CompleteParams,
  CompleteResult,
  CompleteStreamEvent,
  SpekoClientOptions,
  SynthesizeOptions,
  SynthesizeResult,
  SynthesizeStreamResult,
  TranscribeOptions,
  TranscribeResult,
  TranscribeStreamEvent,
} from './types/index.js';

const DEFAULT_BASE_URL = 'https://api.speko.dev';
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
 * });
 * ```
 */
export class Speko {
  readonly usage: Usage;
  readonly credits: Credits;
  readonly realtime: Realtime;
  readonly voice: Voice;
  readonly voices: Voices;
  readonly phoneNumbers: PhoneNumbers;
  readonly agents: Agents;
  readonly knowledgeBases: KnowledgeBases;
  readonly calls: Calls;
  readonly callbacks: Callbacks;
  readonly sessions: Sessions;
  readonly webhooks: Webhooks;

  private readonly transcribeResource: Transcribe;
  private readonly synthesizeResource: Synthesize;
  private readonly completeResource: Complete;

  constructor(options: SpekoClientOptions) {
    if (!options.apiKey) {
      throw new Error('Speko: apiKey is required. Get one at https://platform.speko.dev/api-keys');
    }

    const http = new HttpClient({
      baseUrl: options.baseUrl ?? options.baseURL ?? DEFAULT_BASE_URL,
      apiKey: options.apiKey,
      timeout: options.timeout ?? DEFAULT_TIMEOUT,
    });

    this.usage = new Usage(http);
    this.credits = new Credits(http);
    this.realtime = new Realtime(http);
    this.voice = new Voice(http);
    this.voices = new Voices(http);
    this.phoneNumbers = new PhoneNumbers(http);
    this.agents = new Agents(http);
    this.knowledgeBases = new KnowledgeBases(http);
    this.calls = new Calls(http);
    this.callbacks = new Callbacks(http);
    this.sessions = new Sessions(http);
    this.webhooks = new Webhooks(http);
    this.transcribeResource = new Transcribe(http);
    this.synthesizeResource = new Synthesize(http);
    this.completeResource = new Complete(http);
  }

  /**
   * Transcribe audio. The router picks the best STT provider for your
   * `(language, region, optimizeFor)` and fails over automatically.
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

  transcribeStream(
    audio: Uint8Array,
    options: TranscribeOptions,
    abortSignal?: AbortSignal,
  ): AsyncIterableIterator<TranscribeStreamEvent> {
    return this.transcribeResource.stream(audio, options, abortSignal);
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

  synthesizeStream(
    text: string,
    options: SynthesizeOptions,
    abortSignal?: AbortSignal,
  ): Promise<SynthesizeStreamResult> {
    return this.synthesizeResource.stream(text, options, abortSignal);
  }

  /**
   * Run an LLM completion. The router picks the best LLM provider and fails
   * over automatically.
   */
  complete(params: CompleteParams, abortSignal?: AbortSignal): Promise<CompleteResult> {
    return this.completeResource.call(params, abortSignal);
  }

  completeStream(
    params: CompleteParams,
    abortSignal?: AbortSignal,
  ): AsyncIterableIterator<CompleteStreamEvent> {
    return this.completeResource.stream(params, abortSignal);
  }
}
