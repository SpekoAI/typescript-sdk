import type { HttpClient } from '../http.js';
import type {
  TranscribeOptions,
  TranscribeResult,
} from '../types/index.js';

export class Transcribe {
  constructor(private readonly http: HttpClient) {}

  /**
   * Transcribe audio. The Speko router picks the best STT provider for
   * your `(language, vertical, optimizeFor)` and falls over automatically.
   *
   * @example
   * ```ts
   * const audio = await readFile('./call.wav');
   * const { text, provider, confidence } = await speko.transcribe(audio, {
   *   language: 'es-MX',
   *   vertical: 'healthcare',
   * });
   * ```
   */
  async call(
    audio: Uint8Array,
    options: TranscribeOptions,
    abortSignal?: AbortSignal,
  ): Promise<TranscribeResult> {
    const intent = {
      language: options.language,
      vertical: options.vertical,
      ...(options.optimizeFor !== undefined && { optimizeFor: options.optimizeFor }),
    };

    const headers: Record<string, string> = {
      'Content-Type': options.contentType ?? 'audio/wav',
      'X-Speko-Intent': JSON.stringify(intent),
    };
    if (options.constraints) {
      headers['X-Speko-Constraints'] = JSON.stringify(options.constraints);
    }

    return this.http.requestRaw<TranscribeResult>(
      'POST',
      '/v1/transcribe',
      audio,
      headers,
      abortSignal,
    );
  }
}
