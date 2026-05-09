import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, vi } from 'vitest';
import type { StoredTokens, TokenStore } from './auth/oauth-device-code.js';

export class MemoryTokenStore implements TokenStore {
  accessToken: string | null = 'sk_test';
  refreshToken: string | null = null;

  async getAccessToken(): Promise<string | null> {
    return this.accessToken;
  }

  async getRefreshToken(): Promise<string | null> {
    return this.refreshToken;
  }

  async setTokens(tokens: StoredTokens): Promise<void> {
    this.accessToken = tokens.accessToken;
    this.refreshToken = tokens.refreshToken;
  }

  async clear(): Promise<void> {
    this.accessToken = null;
    this.refreshToken = null;
  }
}

export class BufferStream {
  output = '';

  write(chunk: string | Uint8Array): boolean {
    this.output += typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk);
    return true;
  }
}

const originalFetch = globalThis.fetch;
const originalApiKey = process.env['SPEKO_API_KEY'];

beforeEach(() => {
  process.env['SPEKO_API_KEY'] = 'sk_test';
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalApiKey === undefined) {
    delete process.env['SPEKO_API_KEY'];
  } else {
    process.env['SPEKO_API_KEY'] = originalApiKey;
  }
  vi.restoreAllMocks();
});

export async function tempPath(filename: string): Promise<string> {
  return join(await mkdtemp(join(tmpdir(), 'speko-sdk-')), filename);
}

export function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export function sseResponse(events: unknown[]): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const event of events) {
        const name =
          typeof event === 'object' && event && 'kind' in event
            ? String((event as { kind: unknown }).kind)
            : 'message';
        controller.enqueue(
          encoder.encode(`event: ${name}\ndata: ${JSON.stringify(event)}\n\n`),
        );
      }
      controller.close();
    },
  });
  return new Response(body, {
    headers: { 'content-type': 'text/event-stream' },
  });
}

export function mockFetch(
  handler: (url: URL, init: RequestInit) => Response | Promise<Response>,
): void {
  globalThis.fetch = vi.fn((input: URL | RequestInfo, init?: RequestInit) => {
    const url = new URL(String(input));
    return Promise.resolve(handler(url, init ?? {}));
  }) as typeof fetch;
}

export function sampleSessionConfig() {
  return {
    agent_id: 'agent_1',
    version_id: 'version_1',
    name: 'Acme Support',
    language: ['en'],
    use_case: 'customer-support',
    stack: {
      stt: { provider: 'deepgram', model: 'nova-3' },
      llm: { provider: 'anthropic', model: 'claude-sonnet-4-6' },
      tts: { provider: 'elevenlabs', model: 'eleven-v3' },
      fallback_chain: [],
    },
    system_prompt: 'Answer questions for Acme.',
    opening_message: 'Hi, how can I help?',
    closing_message: 'Thanks for calling.',
    voice: {
      provider: 'elevenlabs',
      voice_id: 'sarah',
      character: 'warm',
    },
    phone: { mode: 'inbound' },
    tools: [],
    runtime: {
      vad_threshold: 0.5,
      turn_timeout_ms: 1500,
      false_interruption_timeout_ms: 2000,
      max_tool_chain: 5,
      recording: true,
      region: 'global',
    },
    mode: 'cascaded',
  };
}

export function sampleAgentVersion(overrides: Record<string, unknown> = {}) {
  return {
    id: '550e8400-e29b-41d4-a716-446655440100',
    agent_id: 'agent_1',
    version_number: 2,
    session_config: sampleSessionConfig(),
    briefing_md: '## Briefing',
    build_trace_id: null,
    bundle_sha: 'a'.repeat(64),
    bundle_url: 'pg://agent_version/1',
    status: 'live',
    published_at: '2026-05-09T12:00:00.000Z',
    published_by: null,
    ...overrides,
  };
}
