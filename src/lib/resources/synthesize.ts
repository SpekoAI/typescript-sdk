import type { HttpClient } from '../http.js';
import type {
  SynthesizeOptions,
  SynthesizeResult,
} from '../types/index.js';

export class Synthesize {
  constructor(private readonly http: HttpClient) {}

  /**
   * Synthesize text into audio. The Speko router picks the best TTS provider
   * for your `(language, vertical, optimizeFor)` and falls over automatically.
   *
   * The returned audio's format depends on the chosen provider — check the
   * `contentType` field on the result. ElevenLabs returns `audio/mpeg`,
   * Cartesia returns raw `audio/pcm;rate=24000`.
   *
   * @example
   * ```ts
   * const result = await speko.synthesize('Hello world', {
   *   language: 'en',
   *   vertical: 'general',
   * });
   * await writeFile(`out.${result.contentType.includes('mpeg') ? 'mp3' : 'pcm'}`, result.audio);
   * ```
   */
  async call(
    text: string,
    options: SynthesizeOptions,
    abortSignal?: AbortSignal,
  ): Promise<SynthesizeResult> {
    const intent = {
      language: options.language,
      vertical: options.vertical,
      ...(options.optimizeFor !== undefined && { optimizeFor: options.optimizeFor }),
    };

    const body: Record<string, unknown> = { text, intent };
    if (options.voice !== undefined) body['voice'] = options.voice;
    if (options.speed !== undefined) body['speed'] = options.speed;
    if (options.constraints !== undefined) body['constraints'] = options.constraints;

    const { bytes, headers } = await this.http.requestBinary(
      'POST',
      '/v1/synthesize',
      body,
      abortSignal,
    );

    return {
      audio: bytes,
      contentType: headers['content-type'] ?? 'application/octet-stream',
      provider: headers['x-speko-provider'] ?? 'unknown',
      model: headers['x-speko-model'] ?? 'unknown',
      failoverCount: parseInt(headers['x-speko-failover-count'] ?? '0', 10),
      scoresRunId: headers['x-speko-scores-run-id'] || null,
    };
  }
}
