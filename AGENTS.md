# AGENTS.md

Guidance for AI coding agents working with `@spekoai/sdk`.

## What this is

`@spekoai/sdk` is the official TypeScript SDK for [Speko](https://speko.ai), an OpenRouter-style gateway for voice AI: one API that routes STT, LLM, and TTS requests across every major voice provider (10+ languages), with benchmark-driven provider selection and automatic failover. Full voice stack: speech-to-text, text-to-speech, and LLM completion behind a single typed client.

## Install

```bash
npm install @spekoai/sdk
```

## Quickstart

```ts
import { Speko } from '@spekoai/sdk';

const speko = new Speko({ apiKey: process.env.SPEKO_API_KEY });
const { text } = await speko.transcribe(audioBuffer, { language: 'es-MX' });
const speech = await speko.synthesize('Hello world', { language: 'en' });
const { text: reply } = await speko.complete({ messages: [{ role: 'user', content: 'Hi!' }], intent: { language: 'en' } });
```

Streaming variants exist for all three: `transcribeStream`, `synthesizeStream`, `completeStream`.

## Auth

Sign up at [platform.speko.dev](https://platform.speko.dev), mint a key at [platform.speko.dev/api-keys](https://platform.speko.dev/api-keys), and set `SPEKO_API_KEY`. New accounts get starter credit with no card required.

## Agent resources

- Machine-readable docs index: <https://docs.speko.dev/llms.txt> (full corpus: <https://docs.speko.dev/llms-full.txt>)
- Hosted MCP server: `https://mcp.speko.ai/mcp` (OAuth or API key). One-command setup for Claude Code, Codex, OpenCode, and Cursor: `npx @spekoai/mcp@latest init`
- Full documentation: <https://docs.speko.dev>
- README in this repo covers tool calling and client options in more depth.

## Repo notes

This repository is a read-mostly mirror of `packages/sdk` in the SpekoAI platform monorepo. Issues and PRs are welcome here; merged changes are synced back upstream automatically.
