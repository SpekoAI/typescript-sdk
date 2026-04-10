# @spekoai/sdk-typescript

Official Node.js SDK for the [SpekoAI](https://spekoai.com) voice AI gateway.

SpekoAI is a voice AI gateway that runs the STT → LLM → TTS pipeline so you
don't need to juggle separate API keys, credentials, and SDKs for each
provider. This SDK is the Node.js client for creating voice sessions, issuing
LiveKit tokens, and managing pipeline configuration.

## Installation

```bash
npm install @spekoai/sdk-typescript
# or
pnpm add @spekoai/sdk-typescript
# or
bun add @spekoai/sdk-typescript
```

## Quickstart

```ts
import { SpekoAI } from '@spekoai/sdk-typescript';

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

Full API reference and guides: <https://docs.spekoai.com>

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

[MIT](./LICENSE)
