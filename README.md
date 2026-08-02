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

## Programmable voice (call control)

`speko.callControl` drives **human** calls — on a browser softphone,
phones on the PSTN — the way Telnyx Call Control does. Every leg of a call has
an opaque `controlId`, and every verb is addressed to that handle, so a Telnyx
integration ports one command to one command.

```ts
// Come online so inbound can ring you, and hold the presence connection open.
import { PRESENCE_STALE_AFTER_MS } from '@spekoai/sdk';

// Presence and dialing act as a *person*, so authenticate as one — an OAuth
// access token or dashboard session, not an org-wide API key. See below.
const speko = new Speko({ apiKey: brokerOAuthAccessToken });

await speko.callControl.register();
const presence = await speko.callControl.presenceToken(); // → { token, url, ... }
setInterval(() => speko.callControl.heartbeat(), PRESENCE_STALE_AFTER_MS / 3);

// Dial out. The call comes back with its legs attached, plus the room
// credentials for your own browser leg — you must be in the room before the far
// end answers, or the first moments are silent.
const { call, join } = await speko.callControl.dial({ to: '+12015551234' });
const mine = call.legs.find((leg) => leg.kind === 'browser')!;
const theirs = call.legs.find((leg) => leg.kind === 'pstn')!;
// In the browser, join the room with those credentials:
// VoiceConversation.create({ transportToken: join.token, transportUrl: join.url })

await speko.callControl.mute(mine.controlId);
// DTMF is addressed to the leg the tones are *for* — the customer's PSTN leg.
// (Speko relays them out through an in-room browser leg, because only a
// participant inside the room can publish SIP DTMF, but that's internal:
// naming a non-PSTN leg fails with UNSUPPORTED_COMMAND.)
await speko.callControl.dtmf(theirs.controlId, { digits: '1w2' });
await speko.callControl.transfer(mine.controlId, { to: '+12015559876', mode: 'warm' });
await speko.callControl.hangup(mine.controlId, { reason: 'resolved' });
```

Answering an inbound ring is the mirror image. A `RingOffer` arrives on the
presence connection carrying **your own** leg's `controlId`; take a room token
for it, connect, then answer:

```ts
// message: PresenceMessage, parsed off the presence data channel
if (message.type === 'incoming_call') {
  const credentials = await speko.callControl.join(message.controlId);
  await VoiceConversation.create({
    transportToken: credentials.token,
    transportUrl: credentials.url,
  });
  await speko.callControl.answer(message.controlId); // join the room first, then answer
}
```

The full verb set is `answer`, `hangup`, `bridge`, `hold`, `unhold`, `mute`,
`unmute`, `dtmf`, `transfer` — each resolving to the leg's post-command state,
so you never re-read to find out what you just did. `get`, `list`, and `events`
read calls back; `events` is the recorded equivalent of the Telnyx webhook
stream. The same events can be delivered as workspace webhooks (`call.initiated`
… `call.hangup`); those are sent once, without automatic retry, so treat
`events` as the durable record and reconcile from it.

### Authentication: half of this surface needs a user, not an API key

An API key authenticates an *organization*; it names no person. `dial`, `join`,
`register`, `heartbeat`, `setStatus` and `presenceToken` all act as a specific
broker, so under an API key they fail with `USER_REQUIRED` (HTTP 403). There is
no `userId` parameter to get around it — a workspace-wide credential that could
dial or answer as any broker would be an impersonation hole. Pass an **OAuth
access token** (or a dashboard session token) as `apiKey` instead; the user is
resolved from the token.

The command surface — `answer`, `hangup`, `hold`/`unhold`, `mute`/`unmute`,
`dtmf`, `bridge`, `transfer`, plus `get`, `list`, `events` — accepts API keys on
purpose: server-side automation acting on a live call is the point of a
programmable-voice API, and those are scoped by the leg's organization.

Two things differ from Telnyx and will bite if you assume otherwise:

- **`hold` is silent.** It is synthesized from mute + unsubscribe; with no
  music-on-hold source configured the held party hears nothing at all. Say so in
  your UI — callers read silence as a dropped call.
- **There is no SIP registrar.** Desk phones, third-party softphones, and other
  PBXes cannot register and be rung. Human legs are browser legs; `browser` and
  `pstn` are the only human-reachable leg kinds.

Errors carry stable codes on `SpekoApiError.code`, exported as
`VOICE_ERROR_CODES` so you can branch without string-matching prose.

> `speko.voice.dial(...)` is a different thing and is unchanged: it dials an
> **AI agent** out over the same telephony gateway.

## Documentation

Full API reference and guides: <https://docs.speko.dev>

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

[MIT](./LICENSE)
