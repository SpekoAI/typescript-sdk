/** Options for creating a Speko client. */
export interface SpekoClientOptions {
  /** API key for authentication. */
  apiKey: string;
  /** Base URL of the Speko API. Defaults to https://api.speko.ai */
  baseUrl?: string;
  /** Request timeout in milliseconds. Defaults to 30000. */
  timeout?: number;
}

/** BYOK = customer key, no Speko charge. MANAGED = platform key, billed. */
export type KeySource = 'BYOK' | 'MANAGED';

/** Usage record for a workspace. */
export interface UsageSummary {
  totalSessions: number;
  totalMinutes: number;
  totalCost: number;
  breakdown: UsageByProvider[];
  balanceUsd: number;
  currency: 'USD';
}

export interface UsageByProvider {
  provider: string;
  type: 'stt' | 'llm' | 'tts';
  metric: string;
  keySource: KeySource;
  quantity: number;
  cost: number;
}

/** Parameters for querying usage. */
export interface UsageQueryParams {
  /** Start date (ISO 8601). */
  from?: string;
  /** End date (ISO 8601). */
  to?: string;
}

/** Current prepaid credit balance. */
export interface OrganizationBalance {
  balanceUsd: number;
  currency: 'USD';
  updatedAt: string;
}

export type CreditLedgerKind =
  | 'grant'
  | 'debit'
  | 'topup'
  | 'refund'
  | 'adjustment';

export interface CreditLedgerEntry {
  id: string;
  kind: CreditLedgerKind;
  /** Signed. Positive for grants/topups/refunds, negative for debits. */
  amountMicroUsd: string;
  metric: string | null;
  provider: string | null;
  sessionId: string | null;
  createdAt: string;
}

export interface CreditLedgerPage {
  entries: CreditLedgerEntry[];
  /** Pass back as `cursor` for the next page, or null if exhausted. */
  nextCursor: string | null;
}

export interface CreditLedgerQueryParams {
  limit?: number;
  cursor?: string;
}

// --- Routing primitives -----------------------------------------------------

/** Optimization preset that biases the router's weighted score. */
export type OptimizeFor = 'balanced' | 'accuracy' | 'latency' | 'cost';

/** Routing intent passed to the proxy primitives. */
export interface RoutingIntent {
  /** BCP-47 language tag, e.g. "en" or "es-MX". */
  language: string;
  /**
   * Region to rank streaming providers in (e.g. `"us-east4"`, `"eu-west1"`).
   * Defaults to `"global"` on the server, which surfaces region-agnostic
   * (batch) benchmark rows. Set this when latency to a specific
   * geography matters — STT/TTS rankings differ per region.
   */
  region?: string;
  optimizeFor?: OptimizeFor;
}

/**
 * Optional constraints layered on top of `RoutingIntent`. The router still
 * ranks candidates by benchmark score — but if `allowedProviders[modality]`
 * is set and non-empty, it only considers that subset.
 */
export interface PipelineConstraints {
  allowedProviders?: {
    stt?: string[];
    llm?: string[];
    tts?: string[];
  };
}

// --- Transcribe -------------------------------------------------------------

export interface TranscribeOptions extends RoutingIntent {
  /** MIME type of the audio body. Defaults to "audio/wav". */
  contentType?: string;
  constraints?: PipelineConstraints;
  /**
   * Domain keywords to bias the STT toward. Forwarded to whichever provider
   * the router picks: Deepgram → `keywords`, AssemblyAI → `keyterms_prompt`
   * (or `word_boost` on legacy models), OpenAI Whisper → comma-joined prompt,
   * ElevenLabs Scribe → `biased_keywords`. Casing matters for proper nouns.
   */
  keywords?: readonly string[];
}

export interface TranscribeResult {
  text: string;
  provider: string;
  model: string;
  confidence: number | null;
  failoverCount: number;
  scoresRunId: string | null;
}

// --- Synthesize -------------------------------------------------------------

export interface SynthesizeOptions extends RoutingIntent {
  /** Optional voice override. Otherwise the SDK uses each provider's default. */
  voice?: string;
  speed?: number;
  constraints?: PipelineConstraints;
}

export interface SynthesizeResult {
  /** Raw audio bytes. Format depends on the chosen provider — see `contentType`. */
  audio: Uint8Array;
  /** MIME type of the audio (e.g. "audio/mpeg" for ElevenLabs, "audio/pcm;rate=24000" for Cartesia). */
  contentType: string;
  provider: string;
  model: string;
  failoverCount: number;
  scoresRunId: string | null;
}

// --- Complete (LLM) ---------------------------------------------------------

/**
 * One LLM-emitted tool invocation. `args` is a JSON-encoded string (LLMs may
 * stream partial JSON; the proxy guarantees a complete, parseable string).
 */
export interface ChatToolCall {
  id: string;
  name: string;
  args: string;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  /** Present on `role: 'assistant'` when the model invoked one or more tools. */
  toolCalls?: ChatToolCall[];
  /** Required on `role: 'tool'` — pairs with the `id` from a prior assistant `toolCalls[]`. */
  toolCallId?: string;
  /**
   * Present on `role: 'tool'` when the customer's tool execute() threw or
   * returned an error. The proxy translates to provider-native error signals
   * (Anthropic `is_error: true`, OpenAI prefixed content) so the LLM sees the
   * failure instead of treating the error message as a normal tool result.
   */
  isError?: boolean;
}

/**
 * Where the tool runs. `inline` (default) preserves the v0.3 behavior —
 * the SDK / customer worker executes the tool. `webhook` opts into
 * Speko's server-side execution: the proxy POSTs a Standard-Webhooks-
 * signed request to your URL, folds the result back into the next
 * provider turn, and only returns to you when the model emits final
 * text or hands back an inline tool call. `builtin` reserves a slot
 * for managed tools (e.g. `search_knowledge_base`) — handlers ship in
 * a follow-on release.
 */
export type ChatToolExecutionMode = 'inline' | 'webhook' | 'builtin';

/**
 * Source-of-execution config. Required when `executionMode` is
 * `webhook` or `builtin`. Mirrors the SpekoTool `source` shape inside
 * `@spekoai/tool-execution`.
 */
export type ChatToolSource =
  | { kind: 'inline' }
  | {
      kind: 'webhook';
      url: string;
      /** Pointer into Speko's secrets store. Created via `POST /v1/agents/:id/tools` (which encrypts and stores the raw secret). */
      secretRef: string;
      headers?: Record<string, string>;
      timeoutMs?: number;
    }
  | { kind: 'builtin'; name: string; config?: unknown };

/**
 * Tool definition exposed to the LLM. `parameters` is a JSON Schema (draft-7)
 * object — typically generated from a Zod schema via
 * `llm.toJsonSchema()` from `@livekit/agents`.
 *
 * `executionMode` and `source` are optional and back-compat: omitting
 * both preserves the v0.3 inline behavior. Set `executionMode: 'webhook'`
 * with a matching `source: { kind: 'webhook', ... }` to opt into
 * server-managed execution.
 */
export interface ChatTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  executionMode?: ChatToolExecutionMode;
  source?: ChatToolSource;
}

/** Mirrors LiveKit's `ToolChoice` for parity with the agents framework. */
export type ChatToolChoice =
  | 'auto'
  | 'none'
  | 'required'
  | { type: 'function'; function: { name: string } };

export interface CompleteParams {
  messages: ChatMessage[];
  intent: RoutingIntent;
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
  constraints?: PipelineConstraints;
  tools?: ChatTool[];
  toolChoice?: ChatToolChoice;
  parallelToolCalls?: boolean;
  /**
   * Cap on how many provider hops the proxy may chain when one or more
   * tools have `executionMode: 'webhook' | 'builtin'`. Each hop is one
   * provider call. Default 8 server-side, hard cap 16. Ignored when all
   * tools are inline (the proxy always returns toolCalls verbatim and
   * the caller drives the loop themselves).
   */
  maxToolHops?: number;
}

export interface CompleteResult {
  text: string;
  provider: string;
  model: string;
  usage: {
    promptTokens: number;
    completionTokens: number;
  };
  failoverCount: number;
  scoresRunId: string | null;
  /** Present when the LLM invoked tools instead of (or in addition to) emitting text. */
  toolCalls?: ChatToolCall[];
}

// --- Realtime (S2S) ---------------------------------------------------------

export type RealtimeProvider = 'openai' | 'google' | 'xai' | 'inworld';

export interface RealtimeToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface RealtimeConnectParams {
  provider: RealtimeProvider;
  model: string;
  voice?: string;
  systemPrompt?: string;
  temperature?: number;
  inputSampleRate?: 16000 | 24000;
  outputSampleRate?: 16000 | 24000;
  tools?: RealtimeToolSpec[];
  metadata?: Record<string, unknown>;
  /** Max session duration in seconds. Server-capped at 1800 (30 min). */
  ttlSeconds?: number;
}

/**
 * Event shape emitted by a `RealtimeSessionHandle`. Binary audio comes in
 * as `audio` frames; text control messages come through typed variants.
 */
export type RealtimeFrame =
  | { type: 'audio'; pcm: Uint8Array; sampleRate: number }
  | {
      type: 'transcript';
      role: 'user' | 'assistant';
      text: string;
      final: boolean;
    }
  | {
      type: 'tool_call';
      callId: string;
      name: string;
      arguments: string;
    }
  | {
      type: 'usage';
      inputAudioTokens: number;
      outputAudioTokens: number;
    }
  | { type: 'error'; code: string; message: string }
  | { type: 'close'; code: number; reason: string };

export type RealtimeEventHandler = (frame: RealtimeFrame) => void;

export interface RealtimeSessionHandle {
  readonly sessionId: string;
  readonly expiresAt: string;

  /** Send a PCM16 audio chunk up to the model. */
  sendAudio(pcm: Uint8Array): void;

  /** Signal user-turn boundary / commit the input buffer. */
  commit(): void;

  /** Interrupt the current assistant response. */
  interrupt(): void;

  /** Return a previously-requested tool call result. */
  sendToolResult(callId: string, output: string): void;

  /** Subscribe to frames. Returns an unsubscribe callback. */
  on(handler: RealtimeEventHandler): () => void;

  /** Close the session. Safe to call multiple times. */
  close(code?: number, reason?: string): void;
}

// ─── Voice (phone dial) ──────────────────────────────────────────────

export interface VoiceDialParams {
  /** Destination number in E.164 format (e.g. "+12015551234"). */
  to: string;
  /** Caller ID. Falls back to the org default if omitted server-side. */
  from?: string;
  /** Routing intent — language is required, optimizeFor optional. */
  intent: RoutingIntent;
  constraints?: PipelineConstraints;
  /** TTS voice id passed through to the picked TTS provider. */
  voice?: string;
  /** Agent system prompt. */
  systemPrompt?: string;
  llm?: { temperature?: number; maxTokens?: number };
  ttsOptions?: { sampleRate?: number; speed?: number };
  /** Free-form metadata round-tripped to your webhooks. */
  metadata?: Record<string, unknown>;
}

export interface VoiceDialResult {
  sessionId: string;
  callControlId: string;
  roomName: string;
  /** 'dialing' on a real call, 'dialing-stub' if Telnyx isn't configured. */
  status: 'dialing' | 'dialing-stub';
  to: string;
  from: string;
}

// ─── Phone numbers ───────────────────────────────────────────────────

export type PhoneNumberDirection = 'inbound' | 'outbound' | 'both';

export interface PhoneNumberRow {
  id: string;
  organizationId: string;
  e164: string;
  telnyxPhoneNumberId: string | null;
  direction: PhoneNumberDirection;
  dispatchMetadataTemplate: Record<string, unknown> | null;
  label: string | null;
  /**
   * 1:1 link to a persisted agent. When set, inbound calls hydrate
   * pipeline config from the agent row instead of (or alongside) the
   * dispatch_metadata_template.
   */
  agentId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PhoneNumberCreateParams {
  e164: string;
  direction?: PhoneNumberDirection;
  /** LiveKit dispatch metadata template (variables `{{var}}` resolved at dial). */
  dispatchMetadataTemplate?: Record<string, unknown>;
  label?: string;
  /** 1:1 link to an agent in the same org. */
  agentId?: string;
}

export interface PhoneNumberUpdateParams {
  direction?: PhoneNumberDirection;
  dispatchMetadataTemplate?: Record<string, unknown>;
  label?: string;
  /** Pass `null` to unlink, a string to relink. */
  agentId?: string | null;
}

export interface AvailablePhoneNumber {
  e164: string;
  friendlyName: string;
  monthlyCostUsd: number;
  upfrontCostUsd: number;
  features: string[];
  region: {
    state: string | null;
    locality: string | null;
    rateCenter: string | null;
  };
}

export interface PhoneNumberSearchParams {
  /** 3-digit US area code, e.g. "415". */
  areaCode?: string;
  /** Optional locality filter, e.g. "San Francisco". */
  locality?: string;
  /** Max results — Telnyx caps at 50. Default 10. */
  limit?: number;
}

// ─── Agents ──────────────────────────────────────────────────────────

/**
 * Routing intent for an agent's voice pipeline. Narrower than the
 * top-level {@link RoutingIntent} — the agents API specifically
 * accepts `latency`, `quality`, or `cost` (no `balanced` / `accuracy`).
 */
export interface AgentIntent {
  /** BCP-47 language tag, e.g. "en" or "es-MX". */
  language: string;
  optimizeFor?: 'latency' | 'quality' | 'cost';
}

export interface AgentLlmOptions {
  temperature?: number;
  maxTokens?: number;
  model?: string;
}

export interface AgentStackPreferences {
  allowedProviders?: {
    stt?: string[];
    llm?: string[];
    tts?: string[];
    s2s?: string[];
  };
}

export interface AgentSttOptions {
  /** Vocabulary keywords forwarded to whichever STT provider the router picks. */
  keywords?: string[];
}

export interface AgentRow {
  id: string;
  organizationId: string;
  name: string;
  systemPrompt: string;
  voice: string | null;
  intent: AgentIntent;
  llmOptions: AgentLlmOptions | null;
  stackPreferences: AgentStackPreferences | null;
  sttOptions: AgentSttOptions | null;
  createdAt: string;
  updatedAt: string;
}

export interface AgentCreateParams {
  name: string;
  systemPrompt: string;
  voice?: string;
  intent: AgentIntent;
  llmOptions?: AgentLlmOptions;
  stackPreferences?: AgentStackPreferences;
  sttOptions?: AgentSttOptions;
}

export type AgentUpdateParams = Partial<AgentCreateParams>;

// ─── Agent tools ─────────────────────────────────────────────────────

export interface AgentToolSourceInline {
  kind: 'inline';
}

/**
 * Webhook source as sent to {@link AgentTools.create}. The plaintext
 * `secret` is encrypted server-side; the returned row carries
 * `secretRef` instead.
 */
export interface AgentToolSourceWebhookCreate {
  kind: 'webhook';
  url: string;
  /** Plaintext shared secret. Encrypted server-side at write time. */
  secret: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
}

/**
 * Webhook source as returned by the API. The plaintext secret never
 * leaves the server — only the {@link secretRef} pointer is exposed.
 */
export interface AgentToolSourceWebhookSerialized {
  kind: 'webhook';
  url: string;
  /** Pointer into Speko's secrets store. */
  secretRef: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
}

export interface AgentToolSourceBuiltin {
  kind: 'builtin';
  name: string;
  config?: unknown;
}

export type AgentToolSourceCreate =
  | AgentToolSourceInline
  | AgentToolSourceWebhookCreate
  | AgentToolSourceBuiltin;

export type AgentToolSourceSerialized =
  | AgentToolSourceInline
  | AgentToolSourceWebhookSerialized
  | AgentToolSourceBuiltin;

export interface AgentToolRow {
  id: string;
  agentId: string;
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  source: AgentToolSourceSerialized;
  createdAt: string;
  updatedAt: string;
}

export interface AgentToolCreateParams {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  source: AgentToolSourceCreate;
}

export interface AgentToolUpdateParams {
  description?: string;
  parameters?: Record<string, unknown>;
  source?: AgentToolSourceCreate;
}

// ─── Knowledge bases ─────────────────────────────────────────────────

export interface KnowledgeBaseRow {
  id: string;
  organizationId: string;
  agentId: string;
  name: string;
  description: string | null;
  embeddingModel: string;
  documentCount: number;
  chunkCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface KnowledgeBaseCreateParams {
  agentId: string;
  name: string;
  description?: string;
}

export interface KnowledgeBaseListParams {
  /** Filter to a single agent's KBs. */
  agentId?: string;
}

export type KnowledgeBaseDocumentStatus =
  | 'pending'
  | 'processing'
  | 'ready'
  | 'failed';

export interface KnowledgeBaseDocumentRow {
  id: string;
  knowledgeBaseId: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  status: KnowledgeBaseDocumentStatus;
  errorMessage: string | null;
  chunkCount: number;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
  ingestedAt: string | null;
}

export interface KnowledgeBaseDocumentCreateParams {
  filename: string;
  /** MIME type. Currently the ingest pipeline accepts `text/plain` and `text/markdown` (plus `text/x-markdown`, `application/x-markdown`). */
  contentType: string;
  sizeBytes: number;
  metadata?: Record<string, unknown>;
}

export interface KnowledgeBaseDocumentUploadSpec {
  /** Signed GCS URL valid for `expiresInSeconds` from issuance. */
  url: string;
  method: 'PUT';
  /** Headers that MUST be sent on the PUT (Content-Type, length-range, etc.). */
  headers: Record<string, string>;
  expiresInSeconds: number;
}

export interface KnowledgeBaseDocumentCreateResult {
  document: KnowledgeBaseDocumentRow;
  upload: KnowledgeBaseDocumentUploadSpec;
}

/**
 * Convenience parameter shape for {@link KnowledgeBases.uploadDocument}.
 * The wrapper computes `sizeBytes` from `data` automatically.
 */
export interface KnowledgeBaseDocumentUploadParams {
  filename: string;
  contentType: string;
  data: ArrayBuffer | Uint8Array | Blob;
  metadata?: Record<string, unknown>;
}

export interface KnowledgeBaseDocumentPollOptions {
  /** Polling interval in milliseconds. Default 2000. */
  intervalMs?: number;
  /** Total timeout in milliseconds. Default 120000 (2 min). */
  timeoutMs?: number;
}
