import type { HttpClient } from '../http.js';
import type {
  CompleteParams,
  CompleteResult,
  CompleteStreamEvent,
} from '../types/index.js';
import { SpekoApiError } from '../errors.js';

export class Complete {
  constructor(private readonly http: HttpClient) {}

  /**
   * Run an LLM completion. The Speko router picks the best provider for your
   * `(language, optimizeFor)` and falls over automatically.
   *
   * @example
   * ```ts
   * const { text, provider } = await speko.complete({
   *   messages: [{ role: 'user', content: 'Hi!' }],
   *   intent: { language: 'en' },
   * });
   * ```
   */
  async call(
    params: CompleteParams,
    abortSignal?: AbortSignal,
  ): Promise<CompleteResult> {
    let done: CompleteResult | undefined;
    for await (const event of this.stream(params, abortSignal)) {
      if (event.type === 'done') {
        done = {
          text: event.text,
          provider: event.provider,
          model: event.model,
          usage: event.usage,
          failoverCount: event.failoverCount,
          scoresRunId: event.scoresRunId,
          ...(event.toolCalls && { toolCalls: event.toolCalls }),
        };
      } else if (event.type === 'error') {
        throw new SpekoApiError(event.error, 200, event.code);
      }
    }
    if (!done) {
      throw new SpekoApiError('Complete stream ended without a done event', 200, 'STREAM_ENDED');
    }
    return done;
  }

  async *stream(
    params: CompleteParams,
    abortSignal?: AbortSignal,
  ): AsyncIterableIterator<CompleteStreamEvent> {
    for await (const event of this.http.requestSse(
      'POST',
      '/v1/complete',
      params,
      abortSignal,
    )) {
      yield { ...(event.data as Record<string, unknown>), type: event.event } as CompleteStreamEvent;
    }
  }
}
