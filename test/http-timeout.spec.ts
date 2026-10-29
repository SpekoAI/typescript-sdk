import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Speko } from '../src/lib/client.js';

// `timeout` bounds the wait for headers and each gap between body chunks, not
// the whole stream. Before 0.5.5 one timer covered headers plus the full body,
// so any synthesis longer than 30 s ended in AbortError mid-audio.

const TIMEOUT_MS = 1_000;

interface ControlledBody {
  push: (bytes: number) => void;
  close: () => void;
}

/**
 * Stub fetch like undici does: an abort rejects the pending fetch and errors
 * the response body with an AbortError.
 */
function stubStreamingFetch(): { body: Promise<ControlledBody> } {
  let resolveBody: (body: ControlledBody) => void = () => undefined;
  const body = new Promise<ControlledBody>((resolve) => {
    resolveBody = resolve;
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init: RequestInit) => {
      const signal = init.signal as AbortSignal;
      let controller!: ReadableStreamDefaultController<Uint8Array>;
      const stream = new ReadableStream<Uint8Array>({
        start(c) {
          controller = c;
        },
      });
      signal.addEventListener('abort', () => {
        controller.error(new DOMException('This operation was aborted', 'AbortError'));
      });
      resolveBody({
        push: (bytes) => {
          if (!signal.aborted) controller.enqueue(new Uint8Array(bytes));
        },
        close: () => controller.close(),
      });
      return new Response(stream, { headers: { 'content-type': 'audio/pcm' } });
    }),
  );
  return { body };
}

function stubStalledFetch(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          (init.signal as AbortSignal).addEventListener('abort', () => {
            reject(new DOMException('This operation was aborted', 'AbortError'));
          });
        }),
    ),
  );
}

async function collect(iterable: AsyncIterable<Uint8Array>): Promise<number> {
  let bytes = 0;
  for await (const chunk of iterable) bytes += chunk.byteLength;
  return bytes;
}

describe('HttpClient timeout', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('lets a stream run longer than the timeout while chunks keep arriving', async () => {
    const { body } = stubStreamingFetch();
    const speko = new Speko({
      apiKey: 'sk_test',
      baseUrl: 'https://api.test',
      timeout: TIMEOUT_MS,
    });

    const stream = await speko.synthesizeStream('hello', { language: 'en' });
    const done = collect(stream);
    const ctl = await body;
    for (let i = 0; i < 10; i++) {
      ctl.push(320);
      await vi.advanceTimersByTimeAsync(TIMEOUT_MS * 0.8);
    }
    ctl.close();

    await expect(done).resolves.toBe(3_200);
  });

  it('aborts a stream that stalls longer than the timeout between chunks', async () => {
    const { body } = stubStreamingFetch();
    const speko = new Speko({
      apiKey: 'sk_test',
      baseUrl: 'https://api.test',
      timeout: TIMEOUT_MS,
    });

    const stream = await speko.synthesizeStream('hello', { language: 'en' });
    const done = collect(stream);
    const settled = done.catch((err: unknown) => err);
    const ctl = await body;
    ctl.push(320);
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS + 1);

    expect(await settled).toMatchObject({ name: 'AbortError' });
  });

  it('does not count time the consumer holds a chunk', async () => {
    const { body } = stubStreamingFetch();
    const speko = new Speko({
      apiKey: 'sk_test',
      baseUrl: 'https://api.test',
      timeout: TIMEOUT_MS,
    });

    const stream = await speko.synthesizeStream('hello', { language: 'en' });
    const iterator = stream[Symbol.asyncIterator]();
    const ctl = await body;
    ctl.push(320);
    expect((await iterator.next()).value?.byteLength).toBe(320);

    // The consumer is slow; the SDK is not waiting on the network.
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS * 3);
    ctl.push(160);
    expect((await iterator.next()).value?.byteLength).toBe(160);
    ctl.close();
    expect((await iterator.next()).done).toBe(true);
  });

  it('still times out the wait for response headers', async () => {
    stubStalledFetch();
    const speko = new Speko({
      apiKey: 'sk_test',
      baseUrl: 'https://api.test',
      timeout: TIMEOUT_MS,
    });

    const pending = speko
      .synthesizeStream('hello', { language: 'en' })
      .catch((err: unknown) => err);
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS + 1);

    expect(await pending).toMatchObject({ name: 'AbortError' });
  });

  it('still honors a caller AbortSignal mid-stream', async () => {
    const { body } = stubStreamingFetch();
    const speko = new Speko({
      apiKey: 'sk_test',
      baseUrl: 'https://api.test',
      timeout: TIMEOUT_MS,
    });
    const caller = new AbortController();

    const stream = await speko.synthesizeStream('hello', { language: 'en' }, caller.signal);
    const settled = collect(stream).catch((err: unknown) => err);
    const ctl = await body;
    ctl.push(320);
    await vi.advanceTimersByTimeAsync(10);
    caller.abort();

    expect(await settled).toMatchObject({ name: 'AbortError' });
  });

  it('a caller AbortSignal.timeout() still caps the total stream length', async () => {
    const { body } = stubStreamingFetch();
    const speko = new Speko({
      apiKey: 'sk_test',
      baseUrl: 'https://api.test',
      timeout: TIMEOUT_MS,
    });

    const stream = await speko.synthesizeStream(
      'hello',
      { language: 'en' },
      AbortSignal.timeout(50),
    );
    const settled = collect(stream).catch((err: unknown) => err);
    const ctl = await body;
    for (let i = 0; i < 4; i++) {
      ctl.push(320);
      await vi.advanceTimersByTimeAsync(TIMEOUT_MS * 0.8);
    }

    expect(await settled).toMatchObject({ name: 'AbortError' });
  });
});
