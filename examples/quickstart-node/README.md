# Speko quickstart (Node)

A minimal end-to-end example of `@spekoai/sdk` against a locally running
Speko server. Hits the three proxy primitives — `transcribe`, `complete`,
`synthesize` — and writes the synthesized audio to disk.

## Prerequisites

1. **Server running locally.** From the monorepo root:
   ```bash
   docker compose up -d postgres
   cp apps/server/.env.example apps/server/.env
   bun nx run @spekoai/server:db:push
   bun nx serve @spekoai/server
   ```

   Or point at staging (`SPEKO_BASE_URL=https://api-staging.speko.dev`)
   and skip the local server entirely.

2. **API key.** Sign up at the local dashboard (`bun nx dev @spekoai/dashboard`,
   then visit <http://localhost:4200>) and generate an API key under Settings →
   API Keys.

3. **Provider credentials.** From the dashboard's Providers page, add a
   Deepgram key (for STT), an OpenAI key (for LLM), and an ElevenLabs key
   (for TTS). The router only picks providers whose credentials are stored.

4. **Optional sample audio.** Drop a short WAV clip at
   `packages/sdk/examples/quickstart-node/sample.wav` to exercise the
   transcribe path. Without it, the script skips transcribe and runs only
   `complete` and `synthesize`.

## Run

```bash
cd packages/sdk/examples/quickstart-node
SPEKO_API_KEY=sk_live_... \
SPEKO_BASE_URL=http://localhost:3000 \
bun src/index.ts
```

Expected output:

```
=== speko.transcribe ===
{ text: '...', provider: 'deepgram', model: 'nova-3', confidence: 0.94, ... }

=== speko.complete ===
{ text: 'Hi!', provider: 'openai', model: 'gpt-4o-mini', usage: {...}, ... }

=== speko.synthesize ===
{ bytes: 32400, contentType: 'audio/mpeg', provider: 'elevenlabs', ... }
```

## Note on audio format

`speko.synthesize()` returns whatever audio format the chosen TTS provider
emits natively — `audio/mpeg` for ElevenLabs, raw `audio/pcm;rate=24000`
for Cartesia. Check `result.contentType` before decoding. A future Speko
release will add server-side normalization to a canonical format.
