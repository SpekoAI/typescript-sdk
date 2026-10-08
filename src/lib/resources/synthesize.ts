import type { HttpClient } from '../http.js';
import type {
  SynthesizeOptions,
  SynthesizeResult,
  SynthesizeStreamResult,
} from '../types/index.js';

export class Synthesize {
  constructor(private readonly http: HttpClient) {}

  /**
   * Synthesize text into audio. The Speko router picks the best TTS provider
   * for your `(language, region, optimizeFor)` and falls over automatically.
   *
   * The returned audio's format depends on the chosen provider — check the
   * `contentType` field on the result. ElevenLabs returns `audio/mpeg`,
   * Cartesia returns raw `audio/pcm;rate=24000`.
   *
   * @example
   * ```ts
   * const result = await speko.synthesize('Hello world', {
   *   language: 'en',
   * });
   * await writeFile(`out.${result.contentType.includes('mpeg') ? 'mp3' : 'pcm'}`, result.audio);
   * ```
   */
  async call(
    text: string,
    options: SynthesizeOptions,
    abortSignal?: AbortSignal,
  ): Promise<SynthesizeResult> {
    const streamed = await this.stream(text, options, abortSignal);
    const chunks: Uint8Array[] = [];
    for await (const chunk of streamed) {
      chunks.push(chunk);
    }

    return {
      audio: concatChunks(chunks),
      contentType: streamed.contentType,
      provider: streamed.provider,
      model: streamed.model,
      failoverCount: streamed.failoverCount,
      scoresRunId: streamed.scoresRunId,
    };
  }

  async stream(
    text: string,
    options: SynthesizeOptions,
    abortSignal?: AbortSignal,
  ): Promise<SynthesizeStreamResult> {
    const trimmedSessionId = options.sessionId?.trim();
    const requestHeaders = trimmedSessionId ? { 'x-session-id': trimmedSessionId } : undefined;
    const intent = {
      language: options.language,
      ...(options.region !== undefined && { region: options.region }),
      ...(options.optimizeFor !== undefined && { optimizeFor: options.optimizeFor }),
    };

    const body: Record<string, unknown> = { text, intent };
    if (options.voice !== undefined) body['voice'] = options.voice;
    if (options.model !== undefined) body['model'] = options.model;
    if (options.speed !== undefined) body['speed'] = options.speed;
    if (options.instructions !== undefined) body['instructions'] = options.instructions;
    if (options.spokenForm !== undefined) body['spokenForm'] = options.spokenForm;
    if (options.constraints !== undefined) body['constraints'] = options.constraints;

    const { chunks, headers: responseHeaders } = await this.http.requestBinaryStream(
      'POST',
      '/v1/synthesize',
      body,
      abortSignal,
      requestHeaders,
    );

    const result = {
      contentType: responseHeaders['content-type'] ?? 'application/octet-stream',
      provider: responseHeaders['x-speko-provider'] ?? 'unknown',
      model: responseHeaders['x-speko-model'] ?? 'unknown',
      failoverCount: parseInt(responseHeaders['x-speko-failover-count'] ?? '0', 10),
      scoresRunId: responseHeaders['x-speko-scores-run-id'] || null,
      [Symbol.asyncIterator]() {
        return chunks;
      },
    };

    return result;
  }
}

function concatChunks(chunks: readonly Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}
