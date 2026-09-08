import { afterEach, describe, expect, it, vi } from 'vitest';
import { Speko } from '../src/lib/client.js';
import type { AgentToolRow, AgentToolUpdateParams } from '../src/lib/types/index.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

const ISO = '2026-01-01T00:00:00.000Z';

/** One serialized tool row per source kind, as the API would return them. */
const rows: AgentToolRow[] = [
  {
    id: 't_inline',
    agentId: 'agent_1',
    name: 'echo',
    description: 'Echo the input back',
    parameters: { type: 'object', properties: { text: { type: 'string' } } },
    source: { kind: 'inline' },
    createdAt: ISO,
    updatedAt: ISO,
  },
  {
    id: 't_webhook',
    agentId: 'agent_1',
    name: 'lookup_order',
    description: 'Look up an order by id',
    parameters: { type: 'object', properties: { orderId: { type: 'string' } } },
    source: {
      kind: 'webhook',
      url: 'https://hooks.example.com/lookup',
      secretRef: 'webhook:agent_1:lookup_order',
      headers: { 'x-tenant': 'acme' },
      timeoutMs: 2000,
    },
    createdAt: ISO,
    updatedAt: ISO,
  },
  {
    id: 't_builtin',
    agentId: 'agent_1',
    name: 'search',
    description: 'Search the knowledge base',
    parameters: { type: 'object', properties: { query: { type: 'string' } } },
    source: { kind: 'builtin', name: 'search_knowledge_base', config: { knowledgeBaseId: 'kb_1' } },
    createdAt: ISO,
    updatedAt: ISO,
  },
  {
    id: 't_integration',
    agentId: 'agent_1',
    name: 'create_event',
    description: 'Create a calendar event',
    parameters: { type: 'object', properties: { title: { type: 'string' } } },
    source: {
      kind: 'integration',
      installationId: '11111111-1111-4111-8111-111111111111',
      appKey: 'google_calendar',
      actionKey: 'create_event',
      config: { calendarId: 'primary' },
    },
    createdAt: ISO,
    updatedAt: ISO,
  },
];

describe('speko.agents.tools.listChatTools', () => {
  it('converts every source kind into the ChatTool shape', async () => {
    const fetchMock = mockFetch(jsonResponse(rows));

    const speko = new Speko({ apiKey: 'sk_test', baseUrl: 'https://api.test' });
    const tools = await speko.agents.tools.listChatTools('agent_1');

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.test/v1/agents/agent_1/tools',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({ Authorization: 'Bearer sk_test' }),
      }),
    );

    expect(tools).toEqual([
      {
        name: 'echo',
        description: 'Echo the input back',
        parameters: { type: 'object', properties: { text: { type: 'string' } } },
        executionMode: 'inline',
        source: { kind: 'inline' },
      },
      {
        name: 'lookup_order',
        description: 'Look up an order by id',
        parameters: { type: 'object', properties: { orderId: { type: 'string' } } },
        executionMode: 'webhook',
        source: {
          kind: 'webhook',
          url: 'https://hooks.example.com/lookup',
          secretRef: 'webhook:agent_1:lookup_order',
          headers: { 'x-tenant': 'acme' },
          timeoutMs: 2000,
        },
      },
      {
        name: 'search',
        description: 'Search the knowledge base',
        parameters: { type: 'object', properties: { query: { type: 'string' } } },
        executionMode: 'builtin',
        source: {
          kind: 'builtin',
          name: 'search_knowledge_base',
          config: { knowledgeBaseId: 'kb_1' },
        },
      },
      {
        name: 'create_event',
        description: 'Create a calendar event',
        parameters: { type: 'object', properties: { title: { type: 'string' } } },
        executionMode: 'integration',
        source: {
          kind: 'integration',
          installationId: '11111111-1111-4111-8111-111111111111',
          appKey: 'google_calendar',
          actionKey: 'create_event',
          config: { calendarId: 'primary' },
        },
      },
    ]);
  });

  it('uses baseURL as an alias for baseUrl', async () => {
    const fetchMock = mockFetch(jsonResponse(rows));

    const speko = new Speko({ apiKey: 'sk_test', baseURL: 'https://alias.test' });
    await speko.agents.tools.listChatTools('agent_1');

    expect(fetchMock).toHaveBeenCalledWith(
      'https://alias.test/v1/agents/agent_1/tools',
      expect.objectContaining({ method: 'GET' }),
    );
  });
});

describe('speko.agents.tools AbortSignal', () => {
  it('forwards the caller signal to the underlying request', async () => {
    let capturedSignal: AbortSignal | undefined;
    let resolveFetch: (() => void) | undefined;
    const fetchMock = vi.fn<typeof fetch>().mockImplementation((_url, init) => {
      capturedSignal = (init as RequestInit).signal ?? undefined;
      return new Promise<Response>((resolve) => {
        resolveFetch = () => resolve(jsonResponse(rows));
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const speko = new Speko({ apiKey: 'sk_test', baseUrl: 'https://api.test' });
    const controller = new AbortController();
    const promise = speko.agents.tools.list('agent_1', controller.signal);

    // The composed signal reaches fetch and is not yet aborted.
    expect(capturedSignal).toBeInstanceOf(AbortSignal);
    expect(capturedSignal?.aborted).toBe(false);

    // Aborting the caller's controller aborts the signal fetch is watching.
    controller.abort();
    expect(capturedSignal?.aborted).toBe(true);

    resolveFetch?.();
    await promise;
  });
});

describe('speko.agents.tools.update', () => {
  it('omits secret on a webhook update to keep the existing one', async () => {
    const updatedRow: AgentToolRow = {
      ...rows[1],
      source: {
        kind: 'webhook',
        url: 'https://hooks.example.com/lookup-v2',
        secretRef: 'webhook:agent_1:lookup_order',
      },
    };
    const fetchMock = mockFetch(jsonResponse(updatedRow));

    const speko = new Speko({ apiKey: 'sk_test', baseUrl: 'https://api.test' });
    // No `secret` field — allowed by AgentToolSourceWebhookUpdate; server keeps the stored secret.
    const params: AgentToolUpdateParams = {
      source: { kind: 'webhook', url: 'https://hooks.example.com/lookup-v2' },
    };
    await speko.agents.tools.update('agent_1', 't_webhook', params);

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(init.method).toBe('PATCH');
    const body = JSON.parse(init.body as string) as AgentToolUpdateParams;
    expect(body.source).toEqual({ kind: 'webhook', url: 'https://hooks.example.com/lookup-v2' });
    expect(body.source).not.toHaveProperty('secret');
  });
});

function mockFetch(response: Response) {
  const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(response);
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json' },
  });
}
