import type { HttpClient } from '../http.js';
import type { CompleteParams, CompleteResult } from '../types/index.js';

export class Complete {
  constructor(private readonly http: HttpClient) {}

  /**
   * Run an LLM completion. The Speko router picks the best provider for your
   * `(language, vertical, optimizeFor)` and falls over automatically.
   *
   * @example
   * ```ts
   * const { text, provider } = await speko.complete({
   *   messages: [{ role: 'user', content: 'Hi!' }],
   *   intent: { language: 'en', vertical: 'general' },
   * });
   * ```
   */
  async call(params: CompleteParams): Promise<CompleteResult> {
    return this.http.post<CompleteResult>('/v1/complete', params);
  }
}
