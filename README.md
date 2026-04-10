# @spekoai/sdk

Official Node.js SDK for the [SpekoAI](https://speko.ai) voice AI gateway.

SpekoAI is a voice AI gateway that runs the STT → LLM → TTS pipeline so you
don't need to juggle separate API keys, credentials, and SDKs for each
provider. This SDK is the Node.js client for creating voice sessions, issuing
LiveKit tokens, and managing pipeline configuration.

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
import { SpekoAI } from '@spekoai/sdk';

const client = new SpekoAI({ apiKey: process.env.SPEKOAI_API_KEY });

const session = await client.sessions.create({
  pipeline: {
    stt: { provider: 'deepgram', model: 'nova-3' },
    llm: { provider: 'anthropic', model: 'claude-opus-4-6' },
    tts: { provider: 'elevenlabs', voiceId: 'rachel' },
  },
});

console.log('LiveKit URL:', session.livekitUrl);
console.log('Token:', session.token);
```

## Documentation

Full API reference and guides: <https://docs.speko.dev/typescript-sdk>

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

[MIT](./LICENSE)
