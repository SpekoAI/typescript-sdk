import type { HttpClient } from '../http.js';
import type {
  AgentCallListPage,
  AgentCallListParams,
  AgentCreateParams,
  AgentRow,
  AgentToolCreateParams,
  AgentToolRow,
  AgentToolUpdateParams,
  AgentUpdateParams,
  ChatTool,
  PhoneNumberRow,
} from '../types/index.js';

/**
 * Per-org agent definitions — the system prompt, voice, intent, and
 * routing constraints used when this agent answers (or places) a call.
 *
 * Every agent created via {@link create} auto-provisions a `Default`
 * knowledge base, so callers can upload documents through
 * {@link Speko.knowledgeBases} without an extra setup step.
 *
 * @example
 * ```ts
 * const agent = await speko.agents.create({
 *   name: 'Support Bot',
 *   systemPrompt: 'You are a helpful support agent for Acme.',
 *   voice: 'sophia',
 *   intent: { language: 'en', optimizeFor: 'latency' },
 * });
 *
 * await speko.agents.attachPhoneNumber(agent.id, num.id);
 * ```
 */
export class Agents {
  readonly tools: AgentTools;

  constructor(private readonly http: HttpClient) {
    this.tools = new AgentTools(http);
  }

  list(): Promise<AgentRow[]> {
    return this.http.get<AgentRow[]>('/v1/agents');
  }

  create(params: AgentCreateParams): Promise<AgentRow> {
    return this.http.post<AgentRow>('/v1/agents', params);
  }

  get(agentId: string): Promise<AgentRow> {
    return this.http.get<AgentRow>(`/v1/agents/${encodeURIComponent(agentId)}`);
  }

  update(agentId: string, params: AgentUpdateParams): Promise<AgentRow> {
    return this.http.patch<AgentRow>(`/v1/agents/${encodeURIComponent(agentId)}`, params);
  }

  delete(agentId: string): Promise<{ deleted: boolean }> {
    return this.http.delete<{ deleted: boolean }>(`/v1/agents/${encodeURIComponent(agentId)}`);
  }

  /**
   * Bind a phone number to this agent so inbound calls hydrate the
   * agent's pipeline config from the agent row. Internally calls
   * `PATCH /v1/phone-numbers/:id` with `{ agentId }`.
   */
  attachPhoneNumber(agentId: string, phoneNumberId: string): Promise<PhoneNumberRow> {
    return this.http.patch<PhoneNumberRow>(
      `/v1/phone-numbers/${encodeURIComponent(phoneNumberId)}`,
      { agentId },
    );
  }

  /**
   * Unlink a phone number from any agent. Inbound calls fall back to
   * the number's `dispatchMetadataTemplate` (or fail if neither is
   * configured). Internally calls `PATCH /v1/phone-numbers/:id` with
   * `{ agentId: null }`.
   */
  detachPhoneNumber(phoneNumberId: string): Promise<PhoneNumberRow> {
    return this.http.patch<PhoneNumberRow>(
      `/v1/phone-numbers/${encodeURIComponent(phoneNumberId)}`,
      { agentId: null },
    );
  }

  /**
   * List recent calls for an agent. Use `next_cursor` from the returned page
   * as `cursor` to page backward in time.
   */
  listCalls(agentId: string, params: AgentCallListParams = {}): Promise<AgentCallListPage> {
    const query = new URLSearchParams();
    if (params.limit !== undefined) query.set('limit', String(params.limit));
    if (params.cursor) query.set('cursor', params.cursor);
    if (params.since) query.set('since', params.since);
    const suffix = query.toString() ? `?${query}` : '';
    return this.http.get<AgentCallListPage>(
      `/v1/agents/${encodeURIComponent(agentId)}/calls${suffix}`,
    );
  }
}

/**
 * Per-agent tool definitions exposed to the LLM mid-call. Four execution
 * modes: `inline` (caller runs the tool), `webhook` (Speko POSTs to your URL
 * with a Standard-Webhooks signature), `builtin` (Speko-managed tools like
 * `search_knowledge_base`, `transfer_call`, `end_call`), and `integration`
 * (an org-installed Speko app action such as Google Calendar or Slack).
 *
 * Webhook secrets are encrypted server-side at creation; the returned
 * row carries a `secretRef` pointer instead of the plaintext.
 *
 * Every method accepts an optional trailing `AbortSignal` to cancel the
 * in-flight request — useful when a calling framework tears down a session
 * mid-call.
 */
export class AgentTools {
  constructor(private readonly http: HttpClient) {}

  /**
   * @param opts.available When true, the server returns only tools the agent
   *   can actually run right now — integration tools whose backing installation
   *   is disconnected/missing are omitted. Use this on the runtime path so the
   *   model is never offered a tool that would fail.
   */
  list(
    agentId: string,
    abortSignal?: AbortSignal,
    opts?: { available?: boolean },
  ): Promise<AgentToolRow[]> {
    const query = opts?.available ? '?available=1' : '';
    return this.http.get<AgentToolRow[]>(
      `/v1/agents/${encodeURIComponent(agentId)}/tools${query}`,
      abortSignal,
    );
  }

  create(
    agentId: string,
    params: AgentToolCreateParams,
    abortSignal?: AbortSignal,
  ): Promise<AgentToolRow> {
    return this.http.post<AgentToolRow>(
      `/v1/agents/${encodeURIComponent(agentId)}/tools`,
      params,
      abortSignal,
    );
  }

  get(agentId: string, toolId: string, abortSignal?: AbortSignal): Promise<AgentToolRow> {
    return this.http.get<AgentToolRow>(
      `/v1/agents/${encodeURIComponent(agentId)}/tools/${encodeURIComponent(toolId)}`,
      abortSignal,
    );
  }

  update(
    agentId: string,
    toolId: string,
    params: AgentToolUpdateParams,
    abortSignal?: AbortSignal,
  ): Promise<AgentToolRow> {
    return this.http.patch<AgentToolRow>(
      `/v1/agents/${encodeURIComponent(agentId)}/tools/${encodeURIComponent(toolId)}`,
      params,
      abortSignal,
    );
  }

  delete(
    agentId: string,
    toolId: string,
    abortSignal?: AbortSignal,
  ): Promise<{ deleted: boolean }> {
    return this.http.delete<{ deleted: boolean }>(
      `/v1/agents/${encodeURIComponent(agentId)}/tools/${encodeURIComponent(toolId)}`,
      abortSignal,
    );
  }

  /**
   * Fetch this agent's registered tools and convert them into the
   * {@link ChatTool}[] shape that {@link Speko.complete} accepts. Handles all
   * four source kinds (`inline`, `webhook`, `builtin`, `integration`) — load
   * once and pass the result straight to `speko.complete({ tools })`.
   */
  async listChatTools(
    agentId: string,
    abortSignal?: AbortSignal,
    opts?: { available?: boolean },
  ): Promise<ChatTool[]> {
    const rows = await this.list(agentId, abortSignal, opts);
    return rows.map(toChatTool);
  }
}

/**
 * Convert a serialized {@link AgentToolRow} into a {@link ChatTool}. The row's
 * `source` is structurally identical to `ChatToolSource` for every kind, so the
 * mapping is a direct passthrough; `executionMode` is derived from `source.kind`.
 */
function toChatTool(row: AgentToolRow): ChatTool {
  return {
    name: row.name,
    description: row.description,
    parameters: row.parameters,
    executionMode: row.source.kind,
    source: row.source,
  };
}
