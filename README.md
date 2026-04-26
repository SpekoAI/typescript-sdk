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
# or
bun add @spekoai/sdk
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
```

## Documentation

Full API reference and guides: <https://docs.speko.ai>

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

[MIT](./LICENSE)
