## 0.4.2 (2026-06-05)

### 🚀 Features

- enhance Telephony SDK with KYB and call management features ([077ea9a2](https://github.com/SpekoAI/platform/commit/077ea9a2))
- Dashboard updates for the new phone calls section ([#425](https://github.com/SpekoAI/platform/pull/425))
- **sdk:** listChatTools, baseURL alias, integration tool source + AbortSignal ([4350efcf](https://github.com/SpekoAI/platform/commit/4350efcf))
- migrate from chroma to moss.dev ([1cf69e4c](https://github.com/SpekoAI/platform/commit/1cf69e4c))
- **benchmarks:** language-fidelity (anglicization) metric for s2s/multilingual ([#382](https://github.com/SpekoAI/platform/pull/382))
- **tts:** add model param, raise 50K char cap, ship /v1/voices catalog ([#323](https://github.com/SpekoAI/platform/pull/323))
- add org integration catalog ([#319](https://github.com/SpekoAI/platform/pull/319))
- support byo sip trunk numbers ([#318](https://github.com/SpekoAI/platform/pull/318))
- add background noise options ([aaabb6b3](https://github.com/SpekoAI/platform/commit/aaabb6b3))
- update package versions across multiple packages to ensure consistency and compatibility ([23c597d7](https://github.com/SpekoAI/platform/commit/23c597d7))

### 🩹 Fixes

- update sync message prefixes in dispatch workflows for consistency ([4e7816d2](https://github.com/SpekoAI/platform/commit/4e7816d2))

### ❤️ Thank You

- Abat
- Baymurat785 @Baymurat785
- Claude Opus 4.8 (1M context)
- Laroikin

## 0.4.0 (2026-05-12)

### 🚀 Features

- **sdk:** add `KnowledgeBases` resource — `create`, `list`, `get`, `delete`, document CRUD (`listDocuments`, `getDocument`, `createDocument`, `finalizeDocument`, `deleteDocument`), plus ergonomic wrappers `uploadDocument` (3 round-trips collapsed into one) and `pollDocumentReady` (default 2 min timeout). Accessible as `speko.knowledgeBases`.
- **sdk:** add `Agents` resource — full CRUD plus `attachPhoneNumber` / `detachPhoneNumber` helpers that route through `PATCH /v1/phone-numbers/:id`. Sub-resource `speko.agents.tools` mirrors the `/v1/agents/:agentId/tools` CRUD with typed inline / webhook / builtin source variants.
- **sdk:** narrower `AgentIntent.optimizeFor` union (`'latency' | 'quality' | 'cost'`) reflecting the actual server schema for agents — distinct from the broader `RoutingIntent.optimizeFor`.

### ❤️ Thank You

- Baymurat785 @Baymurat785
- Claude Opus 4.7 (1M context)

## 0.3.0 (2026-05-02)

### 🚀 Features

- **adapter-livekit:** wire tool calls through /v1/complete ([#105](https://github.com/SpekoAI/platform/pull/105))
- **dashboard:** /phone-numbers page — buy + edit + release US numbers ([ec3d541](https://github.com/SpekoAI/platform/commit/ec3d541))
- **telephony:** Telnyx outbound + inbound + phone number CRUD ([c5cc1f0](https://github.com/SpekoAI/platform/commit/c5cc1f0))

### ❤️ Thank You

- Baymurat785 @Baymurat785
- Claude Opus 4.7 (1M context)

# Changelog

All notable changes to `@spekoai/sdk` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `speko.agents.tools.listChatTools(agentId)` — fetches an agent's registered
  tools and converts them into the `ChatTool[]` shape `complete()` accepts.
  Covers all four source kinds (`inline`, `webhook`, `builtin`, `integration`),
  so the result can be passed straight to `speko.complete({ tools })`.
- `baseURL` is now accepted as an alias for `baseUrl` on the client constructor.
  If both are set, `baseUrl` wins.
- Agent tool methods (`speko.agents.tools.*`) accept an optional trailing
  `AbortSignal` to cancel the in-flight request.
- `integration` tool source support: new `AgentToolSourceIntegration` type, added
  to `AgentToolSourceCreate` and `AgentToolSourceSerialized`. Binds a tool to an
  org-installed Speko app action (e.g. Google Calendar, Slack).
- `AgentToolSourceWebhookUpdate` / `AgentToolSourceUpdate` types: webhook updates
  may now omit `secret` to keep the existing encrypted secret (only supply it to
  rotate). `AgentToolUpdateParams.source` uses the new update union.
- Telephony SDK parity: `phoneNumbers.getKyb/saveKybDraft/submitKyb`,
  `calls.recording`, and `agents.listCalls`, plus public types for KYB,
  call recordings, report finalization, SMS assignment fields, and agent call
  pages.

### Changed

- `PhoneNumberRow.source` now reflects the public API values
  (`managed | sip_trunk`), `PhoneNumberUpdateParams` accepts `null` for clearable
  fields, and `PhoneNumberImportSipTrunkParams` supports both productized SIP
  connection imports and the legacy `sipTrunkId` path.

## [0.2.1] - 2026-04-26

### Added

- `RoutingIntent.region` — optional string forwarded to the gateway as
  `intent.region`. Set when latency to a specific geography matters
  (e.g. `'us-east4'`, `'eu-west1'`); STT/TTS rankings differ per
  region. Omitting it preserves the previous behaviour: the server
  defaults to `'global'`, which surfaces the region-agnostic (batch)
  benchmark rows. Plumbed through `transcribe()`, `synthesize()`, and
  `complete({ intent })`.

## [0.2.0] - 2026-04-26

### Removed

- **BREAKING**: `RoutingIntent.vertical` removed (and the `Vertical`
  union type along with it). The router now ranks on
  `(language, optimizeFor)` only. Callers passing `vertical` will fail
  to type-check; the gateway also rejects the field. Old persisted
  session pipeline configs containing `vertical` are tolerated server-
  side.

## [0.0.3] - 2026-04-13

### Fixed

- Add `typescript` + `@types/node` as devDependencies so the mirror publish build (`npm install --no-save` + `npx tsc`) resolves the real compiler instead of the squatter `tsc@2.0.4` npm package.

## [0.0.2] - 2026-04-13

### Changed

- Package scope renamed from `@speko/sdk` to `@spekoai/sdk`.

### Fixed

- Mirror publish workflow now uses trusted-publisher OIDC (Node 24 / npm 11), omits stale `registry-url`, drops deprecated `baseUrl`, and uses `--generate-notes` for GitHub releases from lightweight mirror tags.
