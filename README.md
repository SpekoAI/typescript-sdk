# @spekoai/sdk

Official TypeScript SDK for [Speko](https://speko.ai) — one API, every voice provider.

Speko is a voice AI gateway that benchmarks every STT, LLM, and TTS provider
across languages, then routes each request to the best provider in real
time. Failover is handled. You write one integration; Speko picks the
right provider for every call.

## Installation

```bash
npm install @spekoai/sdk
# or
pnpm add @spekoai/sdk
```

## Quickstart

```ts
import { Speko } from '@spekoai/sdk';
import { readFile } from 'node:fs/promises';

const speko = new Speko({ apiKey: process.env.SPEKO_API_KEY });

// Transcribe — best STT provider auto-routed for your language
const audio = await readFile('./call.wav');
const { text, provider, confidence } = await speko.transcribe(audio, {
  language: 'es-MX',
  region: 'us-east4', // optional — rank streaming providers in this region
});

// Synthesize — best TTS provider auto-routed
const speech = await speko.synthesize('Hello world', {
  language: 'en',
});

// Complete — best LLM provider auto-routed
const { text: reply } = await speko.complete({
  messages: [{ role: 'user', content: 'Hi!' }],
  intent: { language: 'en' },
});

// Streaming variants are also available:
// speko.transcribeStream(...), speko.synthesizeStream(...), speko.completeStream(...)
```

> The client accepts `baseURL` as an alias for `baseUrl` — e.g.
> `new Speko({ apiKey, baseURL: process.env.SPEKO_BASE_URL })`. If both are set,
> `baseUrl` wins.

## Registered tools

Tools registered against an agent (via `speko.agents.tools.create(...)` or the
dashboard) can be loaded and handed straight to `complete()`.
`listChatTools(agentId)` fetches the agent's tools and converts every source
kind — `inline`, `webhook`, `builtin`, and `integration` — into the
`ChatTool[]` shape `complete()` expects:

```ts
const speko = new Speko({
  apiKey: process.env.SPEKO_API_KEY,
  baseURL: process.env.SPEKO_BASE_URL,
});

// Fetch once, then pass straight to complete()
const tools = await speko.agents.tools.listChatTools(agentId);

const { text, toolCalls } = await speko.complete({
  messages: [{ role: 'user', content: 'Book me a slot tomorrow at 3pm' }],
  intent: { language: 'en' },
  tools,
});
```

Webhook, builtin, and integration tools run server-side and are folded back into
the response; inline tools come back to you as `toolCalls` to execute yourself.

## Documentation

Full API reference and guides: <https://docs.speko.dev>

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

[MIT](./LICENSE)
