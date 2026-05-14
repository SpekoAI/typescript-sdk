import type { HttpClient } from '../http.js';
import type {
  TranscribeOptions,
  TranscribeResult,
  TranscribeStreamEvent,
} from '../types/index.js';
import { SpekoApiError } from '../errors.js';

export class Transcribe {
  constructor(private readonly http: HttpClient) {}

  /**
   * Transcribe audio. The Speko router picks the best STT provider for
   * your `(language, optimizeFor)` and falls over automatically.
   *
   * @example
   * ```ts
   * const audio = await readFile('./call.wav');
   * const { text, provider, confidence } = await speko.transcribe(audio, {
   *   language: 'es-MX',
   * });
   * ```
   */
  async call(
    audio: Uint8Array,
    options: TranscribeOptions,
    abortSignal?: AbortSignal,
  ): Promise<TranscribeResult> {
    let done: TranscribeResult | undefined;
    for await (const event of this.stream(audio, options, abortSignal)) {
      if (event.type === 'done') {
        done = {
          text: event.text,
          provider: event.provider,
          model: event.model,
          confidence: event.confidence,
          failoverCount: event.failoverCount,
          scoresRunId: event.scoresRunId,
        };
      } else if (event.type === 'error') {
        throw new SpekoApiError(event.error, 200, event.code);
      }
    }
    if (!done) {
      throw new SpekoApiError('Transcribe stream ended without a done event', 200, 'STREAM_ENDED');
    }
    return done;
  }

  async *stream(
    audio: Uint8Array,
    options: TranscribeOptions,
    abortSignal?: AbortSignal,
  ): AsyncIterableIterator<TranscribeStreamEvent> {
    const intent = {
      language: options.language,
      ...(options.region !== undefined && { region: options.region }),
      ...(options.optimizeFor !== undefined && { optimizeFor: options.optimizeFor }),
    };

    const headers: Record<string, string> = {
      'Content-Type': options.contentType ?? 'audio/wav',
      'X-Speko-Intent': JSON.stringify(intent),
    };
    if (options.constraints) {
      headers['X-Speko-Constraints'] = JSON.stringify(options.constraints);
    }
    if (options.keywords && options.keywords.length > 0) {
      headers['X-Speko-Stt-Options'] = JSON.stringify({
        keywords: [...options.keywords],
      });
    }

    const stream = await this.http.requestRawSse(
      'POST',
      '/v1/transcribe',
      audio,
      headers,
      abortSignal,
    );
    for await (const event of stream) {
      yield { ...(event.data as Record<string, unknown>), type: event.event } as TranscribeStreamEvent;
    }
  }
}
