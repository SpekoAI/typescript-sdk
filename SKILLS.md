# @spekoai/sdk — skill sheet

Dense reference for an LLM about to write TypeScript against the Speko
server SDK. For a prose walkthrough, read the README. For the full type
definitions, open `src/lib/types/index.ts`.

## When to use

Pick `@spekoai/sdk` when you're on the **server side** (Node, Bun, Deno,
Workers, a backend service) and you want one call to cover every STT, LLM,
or TTS provider with routing + failover handled for you. If you need to
run audio in a **browser**, use `@spekoai/client` instead — its
`VoiceConversation` talks to Speko over LiveKit WebRTC. If you're wiring
Speko into a **LiveKit Agents** worker, use `@spekoai/adapter-livekit`
(it depends on this package internally).

## Install

```bash
bun add @spekoai/sdk
# or: npm install @spekoai/sdk
# or: pnpm add @spekoai/sdk
```

Node 18+ / Bun 1.0+ / Deno 1.37+ (uses global `fetch`).

## Environment

- `SPEKO_API_KEY` — get one at `https://dashboard.speko.ai/api-keys`.
- `SPEKO_BASE_URL` — optional, default `https://api.speko.ai`. Set to your
  local server URL for dev.

## Minimal snippet

```ts
import { Speko } from '@spekoai/sdk';
import { readFile } from 'node:fs/promises';

const speko = new Speko({ apiKey: process.env.SPEKO_API_KEY! });

// STT — one API, router picks best provider for your language.
const audio = await readFile('./call.wav');
const stt = await speko.transcribe(audio, {
  language: 'es-MX',
});
console.log(stt.text, stt.provider, stt.confidence);

// LLM
const reply = await speko.complete({
  messages: [{ role: 'user', content: 'Hi!' }],
  intent: { language: 'en' },
});
console.log(reply.text);

// TTS
const speech = await speko.synthesize('Hello world', {
  language: 'en',
});
// speech.audio is a Uint8Array; format depends on provider (check speech.contentType):
//   audio/mpeg       -> ElevenLabs
//   audio/pcm;rate=N -> Cartesia
//   audio/wav        -> generic
```

## Public surface

- `Speko` — constructor takes `{ apiKey, baseUrl?, timeout? }`.
- `speko.transcribe(audio: Uint8Array, opts, abortSignal?) -> TranscribeResult`
- `speko.synthesize(text: string, opts, abortSignal?) -> SynthesizeResult`
- `speko.complete(params, abortSignal?) -> CompleteResult`
- `speko.usage.get({ from?, to? }) -> UsageSummary`
- Errors: `SpekoApiError`, `SpekoAuthError`, `SpekoRateLimitError`.
- Types: `RoutingIntent`, `OptimizeFor`, `PipelineConstraints`,
  `ChatMessage`, `CompleteParams`, `TranscribeOptions`, `SynthesizeOptions`,
  all `*Result` and `Usage*` interfaces.

**Not in the SDK (today):** session minting for the browser voice
flow. That lives at `POST /v1/sessions` and is a direct REST call —
see `spekoai://docs/client-skills` §"Backend: minting a conversation
token" for the exact request/response shape.

## Concepts

- **`RoutingIntent = { language, region?, optimizeFor? }`** — the
  minimum signal the router needs to rank providers. `language` is
  BCP-47. `region` is an optional string (e.g. `'us-east4'`,
  `'eu-west1'`); the server defaults it to `'global'`, which surfaces
  region-agnostic (batch) benchmark rows. Set it when streaming
  latency to a specific geography matters — STT/TTS rankings differ
  per region. Valid `optimizeFor`: `balanced | accuracy | latency |
  cost`.
- **`PipelineConstraints.allowedProviders`** — optional per-modality
  allowlist. The router still ranks by benchmark score but only from the
  subset. Use when a customer requires e.g. Deepgram-only STT.
- **Failover is automatic.** If the top-ranked provider errors, the router
  retries lower-ranked ones; `result.failoverCount` tells you how many
  retries happened.

## Common gotchas

- **Synthesize output format is provider-dependent.** Always branch on
  `result.contentType` before writing to disk or decoding. ElevenLabs =
  MP3, Cartesia = raw PCM, others vary.
- **`transcribe()` takes raw bytes**, not a `File` or `ReadableStream`.
  Use `readFile` / `arrayBuffer` / `Uint8Array.from(...)`.
- **`complete()` wants `{ messages, intent }`**, not `{ messages, language }`.
  Intent is a nested object.
- **Cancel long-running requests** by passing an `AbortSignal` as the last
  argument — LiveKit Agents tears down mid-turn and the SDK honors it.
- **`apiKey` is required.** The constructor throws if missing — fail-fast
  rather than silent 401s on the first call.
- **Do not ship this SDK in a browser bundle** — it assumes Node-style
  `fetch` and exposes the raw API key. Use `@spekoai/client` for browsers.

## See also

- README: `spekoai://docs/sdk-readme`
- Browser SDK: `spekoai://docs/client-skills`
- LiveKit adapter: `spekoai://docs/adapter-livekit-skills`
- Python equivalent: `spekoai://docs/sdk-python-skills`
- Quickstart example: `spekoai://docs/quickstart-node-readme`
