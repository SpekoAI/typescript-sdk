/** Options for creating a Speko client. */
export interface SpekoClientOptions {
  /** API key for authentication. */
  apiKey: string;
  /** Base URL of the Speko API. Defaults to https://api.speko.dev */
  baseUrl?: string;
  /** Alias for {@link SpekoClientOptions.baseUrl}. If both are set, `baseUrl` wins. */
  baseURL?: string;
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

export type CreditLedgerKind = 'grant' | 'debit' | 'topup' | 'refund' | 'adjustment';

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
  /**
   * Optional voice/session identifier forwarded as `x-session-id` for usage
   * attribution. The value is carried out-of-band so request bodies and STT
   * provider options stay provider-shaped.
   */
  sessionId?: string;
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

export type TranscribeStreamEvent =
  | {
      type: 'meta';
      provider: string;
      model: string;
      failoverCount: number;
      scoresRunId: string | null;
    }
  | {
      type: 'transcript';
      text: string;
      isFinal: boolean;
      confidence: number;
    }
  | (TranscribeResult & { type: 'done' })
  | { type: 'error'; error: string; code: string };

// --- Synthesize -------------------------------------------------------------

export interface SynthesizeOptions extends RoutingIntent {
  /**
   * Optional voice/session identifier forwarded as `x-session-id` for usage
   * attribution. The value is carried out-of-band so request bodies and TTS
   * provider options stay provider-shaped.
   */
  sessionId?: string;
  /** Optional voice override. Otherwise the SDK uses each provider's default. */
  voice?: string;
  /**
   * Optional upstream model name to use for synthesis (e.g.
   * `eleven_multilingual_v2`, `sonic-2`, `gpt-4o-mini-tts`,
   * `qwen3-tts-flash`). When omitted, the router picks the best-ranked
   * model for the chosen provider. When set, applies to the primary
   * candidate only — failover candidates still use the selector's model
   * so a model intended for provider A isn't sent to provider B.
   */
  model?: string;
  speed?: number;
  /**
   * Free-text speaking-style instruction (tone, pace, emotion) forwarded to the
   * TTS model. Only instruction-capable models honor it (OpenAI
   * `gpt-4o-mini-tts`, Hume Octave, `qwen3-tts-instruct-flash`); the router
   * drops it for any other resolved model, so it's safe to always pass.
   */
  instructions?: string;
  /**
   * Normalize the text into spoken form before TTS — strip markdown/URLs, spell
   * out numbers/currency/abbreviations. A deterministic safety net beneath the
   * voice directive. The voice pipeline sets this; direct TTS callers default
   * off and get literal text.
   */
  spokenForm?: boolean;
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

export interface SynthesizeStreamResult extends AsyncIterable<Uint8Array> {
  contentType: string;
  provider: string;
  model: string;
  failoverCount: number;
  scoresRunId: string | null;
}

// --- Voices (TTS catalog) ---------------------------------------------------

export interface VoiceCatalogEntry {
  /** Routing-key vendor (matches `allowedProviders.tts` entries). */
  vendor: string;
  /** Voice id passed through to the provider's TTS API. */
  id: string;
  /** Human-readable label. */
  name: string;
}

export interface VoicesProviderEntry {
  key: string;
  name: string;
  models: readonly string[];
  /**
   * `true` when the provider's voice library is account-scoped and must
   * be fetched live from the provider (currently only ElevenLabs).
   */
  voicesFetchedLive: boolean;
}

export interface VoicesListResult {
  voices: readonly VoiceCatalogEntry[];
  providers: readonly VoicesProviderEntry[];
}

export interface VoicesListParams {
  /**
   * Filter to a single provider's voices. Accepts either the routing key
   * (`cartesia`, `xai`, `alibaba`, `openai`, `inworld`, `elevenlabs`) or the
   * catalog suffix form (`xai-tts`, `alibaba-tts`, `openai-tts`).
   */
  provider?: string;
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
 * text or hands back an inline tool call. `builtin` runs Speko-managed
 * primitives (e.g. `search_knowledge_base`, `transfer_call`, `end_call`).
 * `integration` runs an
 * org-installed Speko app action such as Google Calendar or Slack.
 */
export type ChatToolExecutionMode = 'inline' | 'webhook' | 'builtin' | 'integration';

/**
 * Spoken lead-in behavior before a server-executed tool runs. `auto` lets the
 * gateway decide from the tool's recent execution durations; `always` forces a
 * spoken lead-in (the gateway injects one when the model didn't produce any);
 * `never` runs the tool silently.
 */
export type ChatToolPreToolSpeech = 'auto' | 'always' | 'never';

/**
 * Source-of-execution config. Required when `executionMode` is
 * `webhook`, `builtin`, or `integration`. Mirrors the SpekoTool `source` shape inside
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
      /**
       * Outbound auth headers whose values are secret-referenced (resolved and
       * injected by Speko at call time). The raw credential never leaves the
       * server — only the `secretRef` pointer is exposed.
       */
      authHeaders?: Array<{ name: string; secretRef: string }>;
      timeoutMs?: number;
      /** `async` returns `asyncAck` immediately while Speko dispatches the webhook in the background. */
      responseMode?: 'sync' | 'async';
      /** LLM-facing acknowledgement used when `responseMode` is `async`. */
      asyncAck?: string;
    }
  | { kind: 'builtin'; name: string; config?: unknown }
  | {
      kind: 'integration';
      installationId: string;
      appKey: string;
      actionKey: string;
      config?: unknown;
    };

/**
 * Tool definition exposed to the LLM. `parameters` is a JSON Schema (draft-7)
 * object — typically generated from a Zod schema via
 * `llm.toJsonSchema()` from `@livekit/agents`.
 *
 * `executionMode` and `source` are optional and back-compat: omitting
 * both preserves the v0.3 inline behavior. Set `executionMode: 'webhook'`
 * with a matching `source: { kind: 'webhook', ... }` or
 * `source: { kind: 'integration', ... }` to opt into server-managed execution.
 */
export interface ChatTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  executionMode?: ChatToolExecutionMode;
  source?: ChatToolSource;
  /** Spoken lead-in behavior before this tool executes. Defaults to `auto` for registered tools. */
  preToolSpeech?: ChatToolPreToolSpeech;
}

/** Mirrors LiveKit's `ToolChoice` for parity with the agents framework. */
export type ChatToolChoice =
  | 'auto'
  | 'none'
  | 'required'
  | { type: 'function'; function: { name: string } };

export type ReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';

export interface CompleteParams {
  messages: ChatMessage[];
  intent: RoutingIntent;
  /**
   * Optional voice/session identifier forwarded as `x-session-id` for
   * server-executed tools. The value is intentionally carried out-of-band
   * so `/v1/complete` request bodies stay provider-shaped.
   */
  sessionId?: string;
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
  reasoningEffort?: ReasoningEffort;
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

export type CompleteStreamEvent =
  | {
      type: 'meta';
      provider: string;
      model: string;
      failoverCount: number;
      totalFailoverCount: number;
      scoresRunId: string | null;
      hop: number;
    }
  | { type: 'delta'; text: string }
  | (ChatToolCall & { type: 'tool_call' })
  | {
      type: 'server_tool_call';
      id: string;
      name: string;
      status: 'started' | 'completed' | 'failed';
    }
  | (CompleteResult & { type: 'done' })
  | { type: 'error'; error: string; code: string };

// --- Realtime (S2S) ---------------------------------------------------------

export type RealtimeProvider = 'openai' | 'google' | 'xai' | 'inworld' | 'alibaba';

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
  | { type: 'ready'; inputSampleRate: 16000 | 24000; outputSampleRate: 16000 | 24000 }
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
  | { type: 'interruption'; at: 'user' | 'assistant' }
  | {
      type: 'server_tool_call';
      id: string;
      name: string;
      status: 'started' | 'completed' | 'failed';
    }
  | { type: 'error'; code: string; message: string }
  | { type: 'close'; code: number; reason: string };

export type RealtimeEventHandler = (frame: RealtimeFrame) => void;

export interface RealtimeSessionHandle {
  readonly sessionId: string;
  readonly expiresAt: string;
  readonly inputSampleRate: 16000 | 24000;
  readonly outputSampleRate: 16000 | 24000;

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
  /** Persisted assistant to run for this call. When supplied, `intent` can be omitted. */
  agentId?: string;
  /** Routing intent — language is required, optimizeFor optional. */
  intent?: RoutingIntent;
  constraints?: PipelineConstraints;
  /** TTS voice id passed through to the picked TTS provider. */
  voice?: string;
  /** Agent system prompt. */
  systemPrompt?: string;
  /** Optional first utterance. `null` is not accepted by phone dial; omit to use the agent default. */
  firstMessage?: string;
  /**
   * Call-time values for template variables in `systemPrompt` / `firstMessage`.
   * Sending this key (even `{}`) — or dialing with an agent that declares
   * variables in its registry — compiles both strings as Liquid templates at
   * call-create time: `{{name}}` interpolation, `{% if %}` / `{% elsif %}`
   * branching, `| default:` filters, and platform-provided `system.*` values
   * (`system.now`, `system.caller_number`, `system.call_id`, …).
   *
   * Resolution per variable: this map → the agent registry's default → inline
   * `| default:` → the request fails with 400 `MISSING_TEMPLATE_VARIABLES`
   * listing every unresolved name. Keys under `system.` are rejected. Omit
   * this field entirely to send both strings verbatim (no compilation).
   *
   * @example
   * ```ts
   * await speko.voice.dial({
   *   to: '+12015551234',
   *   agentId: 'ag_123',
   *   systemPrompt:
   *     'You are {{agent_name | default: "Ava"}} calling {{customer}}. ' +
   *     '{% if plan == "premium" %}Offer the priority upgrade.{% endif %} ' +
   *     'The current time is {{system.now}}.',
   *   variables: { customer: 'Mr. Lee', plan: 'premium' },
   * });
   * ```
   */
  variables?: Record<string, string>;
  llm?: { temperature?: number; maxTokens?: number };
  ttsOptions?: { sampleRate?: number; speed?: number };
  sttOptions?: { keywords?: string[] };
  /** Server-side wall-clock cap in seconds. Values are clamped server-side to 30s-4h. */
  maxDurationSeconds?: number;
  /**
   * Optional per-call turn-taking overrides. `greetFirst` defaults ON for
   * outbound (worker-side, 2026-07-03): the greeting plays immediately while
   * AMD classifies in the background. Pass false to hold the greeting for the
   * AMD verdict.
   */
  turnHandling?: {
    profile?: 'conversational' | 'ivr' | 'ivr_patient';
    endpointing?: { minDelay?: number; maxDelay?: number };
    interruption?: {
      mode?: 'adaptive' | 'vad';
      minDuration?: number;
      minWords?: number;
    };
    turnDetection?: boolean | 'stt';
    contextThreshold?: boolean;
    greetFirst?: boolean;
  };
  /** Optional per-call SIP routing hints. Carrier AMD requires trunk/provider support. */
  telephony?: {
    region?: string;
    amd?: {
      mode?: 'agent' | 'carrier' | 'disabled';
      timeoutSeconds?: number;
    };
  };
  /** Free-form metadata round-tripped to your webhooks. */
  metadata?: Record<string, unknown>;
  /**
   * @deprecated The agent-initiated end_call tool is now always on; the server
   * accepts this field for compat but ignores it.
   */
  endCall?: { enabled: boolean };
}

export interface VoiceDialResult {
  sessionId: string;
  callControlId: string;
  roomName: string;
  /** 'dialing' on a real call, 'dialing-stub' if managed telephony isn't configured. */
  status: 'dialing' | 'dialing-stub';
  to: string;
  from: string;
}

// ─── Phone numbers ───────────────────────────────────────────────────

export type PhoneNumberDirection = 'inbound' | 'outbound' | 'both';
export type PhoneNumberSource = 'managed' | 'sip_trunk';
export type PhoneNumberSmsAssignmentStatus =
  | 'FAILED_ASSIGNMENT'
  | 'PENDING_ASSIGNMENT'
  | 'ASSIGNED'
  | 'PENDING_UNASSIGNMENT'
  | 'FAILED_UNASSIGNMENT';

export interface PhoneNumberSetupStatus {
  status: 'ready' | 'action_required' | 'suspended';
  inboundReady: boolean;
  outboundReady: boolean;
  agentReady: boolean;
  forwardingRequired: boolean;
  sipConnectionReady: boolean;
  issues: string[];
}

export interface PhoneNumberRow {
  id: string;
  organizationId: string;
  e164: string;
  source: PhoneNumberSource;
  /** Platform-neutral resource id for a platform-managed number. */
  providerResourceId: string | null;
  /** @deprecated Use `providerResourceId`. */
  telnyxPhoneNumberId: string | null;
  /** @deprecated LiveKit trunk IDs are internal and no longer exposed. */
  sipTrunkId: string | null;
  sipConnectionInstallationId: string | null;
  sipProviderName: string | null;
  direction: PhoneNumberDirection;
  dispatchMetadataTemplate: Record<string, unknown> | null;
  label: string | null;
  sms10dlcProfileId: string | null;
  smsCampaignId: string | null;
  smsAssignmentStatus: PhoneNumberSmsAssignmentStatus | null;
  smsAssignmentUpdatedAt: string | null;
  /**
   * 1:1 link to a persisted agent. When set, inbound calls hydrate
   * pipeline config from the agent row instead of (or alongside) the
   * dispatch_metadata_template.
   */
  agentId: string | null;
  setupStatus: PhoneNumberSetupStatus;
  nextChargeAt: string;
  lastChargedAt: string | null;
  suspendedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PhoneNumberCreateParams {
  e164: string;
  direction?: PhoneNumberDirection;
  /** Dispatch metadata template (variables `{{var}}` resolved at dial). */
  dispatchMetadataTemplate?: Record<string, unknown>;
  label?: string;
  /** 1:1 link to an agent in the same org. */
  agentId?: string;
}

export type PhoneNumberImportSipTrunkParams = {
  e164: string;
  /** Optional provider/account label for display. */
  sipProviderName?: string;
  direction?: PhoneNumberDirection;
  /** Dispatch metadata template (variables `{{var}}` resolved at dial). */
  dispatchMetadataTemplate?: Record<string, unknown>;
  label?: string;
  /** 1:1 link to an agent in the same org. */
  agentId?: string;
} & (
  | {
      /** Installed SIP connection integration id. Preferred for productized SIP connections. */
      sipConnectionInstallationId: string;
      /** Legacy LiveKit outbound trunk id. Ignored when `sipConnectionInstallationId` is present. */
      sipTrunkId?: string;
    }
  | {
      /** Legacy LiveKit outbound trunk id. Use `sipConnectionInstallationId` for new integrations. */
      sipTrunkId: string;
      sipConnectionInstallationId?: string;
    }
);

export interface PhoneNumberUpdateParams {
  direction?: PhoneNumberDirection;
  dispatchMetadataTemplate?: Record<string, unknown> | null;
  label?: string | null;
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
  /** Max results. Default 10. */
  limit?: number;
}

export type PhoneNumberKybStatus =
  | 'missing'
  | 'draft'
  | 'submitted'
  | 'approved'
  | 'rejected'
  | 'revoked';

export type PhoneNumberKybSubmissionStatus = Exclude<PhoneNumberKybStatus, 'missing'>;

export type PhoneNumberKybSlackNotificationStatus = 'not_queued' | 'queued' | 'enqueue_failed';

export interface PhoneNumberKybBusinessProfile {
  legalName: string;
  displayName: string;
  entityType: string;
  country: string;
  registrationId?: string;
  website: string;
  address: {
    street: string;
    city: string;
    state: string;
    postalCode: string;
    country: string;
  };
  useCase: string;
  expectedUsage: string;
}

export interface PhoneNumberKybAuthorizedRepresentative {
  name: string;
  title: string;
  email: string;
  phone?: string;
}

export interface PhoneNumberKybDraftParams {
  businessProfile: PhoneNumberKybBusinessProfile;
  authorizedRepresentative: PhoneNumberKybAuthorizedRepresentative;
  attestationAccepted?: boolean;
}

export interface PhoneNumberKybSubmitParams {
  businessProfile: PhoneNumberKybBusinessProfile;
  authorizedRepresentative: PhoneNumberKybAuthorizedRepresentative;
  attestationAccepted: true;
}

export interface PhoneNumberKybSubmission {
  id: string;
  organizationId: string;
  status: PhoneNumberKybSubmissionStatus;
  businessProfile: PhoneNumberKybBusinessProfile | null;
  authorizedRepresentative: PhoneNumberKybAuthorizedRepresentative | null;
  attestationAccepted: boolean;
  attestedAt: string | null;
  submittedByUserId: string | null;
  submittedByEmail: string | null;
  submittedByApiKeyId: string | null;
  submittedAt: string | null;
  reviewerUserId: string | null;
  reviewerEmail: string | null;
  reviewedAt: string | null;
  rejectionReason: string | null;
  slackNotificationStatus: PhoneNumberKybSlackNotificationStatus;
  slackNotificationJobId: string | null;
  slackNotificationError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PhoneNumberKybOverview {
  status: PhoneNumberKybStatus;
  submission: PhoneNumberKybSubmission | null;
  prefill: {
    businessProfile: PhoneNumberKybBusinessProfile;
    authorizedRepresentative: PhoneNumberKybAuthorizedRepresentative;
  } | null;
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

/**
 * Built-in ambience clip ids supported by the hosted worker. Custom clip
 * uploads are intentionally not yet supported — pinning to the built-ins
 * keeps the v1 API simple and lets the worker map straight to the
 * `BuiltinAudioClip` enum.
 */
export type AgentAmbientClip = 'office-ambience' | 'keyboard-typing' | 'keyboard-typing2';

/**
 * Per-agent background audio. Today only ambient (continuous loop) is
 * supported. The ambience plays on a separate media track mixed
 * server-side, so it reaches both browser (WebRTC) and phone (SIP) callers
 * without any client-side change.
 */
export interface AgentBackgroundAudio {
  ambient?: {
    clip: AgentAmbientClip;
    /** Linear gain in [0, 1]. Defaults to 1.0 (clip's natural level). */
    volume?: number;
  };
}

export interface AgentSpeechNormalization {
  pronunciationDictionary?: Record<string, string>;
  textReplacements?: Record<string, string>;
}

/**
 * A caller-defined post-call extraction field. Only meaningful on the
 * `postCall` webhook: the call-analysis pass fills each from the transcript per
 * `description`, typed by `type`, and the values are delivered under the
 * webhook payload's top-level `custom_data` object keyed by `name`. `options`
 * is required for `enum` fields.
 */
export interface AgentExtractionField {
  /**
   * Stable key the value lands under in `custom_data`. Must be a valid
   * identifier (`^[a-zA-Z_][a-zA-Z0-9_]*$`), up to 64 chars, unique per webhook.
   */
  name: string;
  type: 'string' | 'number' | 'boolean' | 'enum';
  /**
   * Instruction the LLM uses to extract this field. 1 to 10,000 characters,
   * and at most 40,000 characters combined across all fields on the webhook.
   */
  description: string;
  /**
   * Allowed values — required (and only valid) when `type` is `'enum'`.
   * 1–50 options, each up to 120 characters.
   */
  options?: string[];
}

/**
 * Outbound auth header input — `value` is the plaintext credential Speko
 * encrypts at rest. Required on create; omit on update to keep the value
 * already stored under this header's ref.
 */
export interface AgentWebhookAuthHeaderInput {
  name: string;
  value?: string;
}

/** Outbound auth header as returned by the API — value stays server-side. */
export interface AgentWebhookAuthHeader {
  name: string;
  secretRef: string;
}

export interface AgentLifecycleWebhookCreate {
  url: string;
  /**
   * Optional per-webhook signing secret. When supplied, this endpoint signs
   * with its own secret instead of the shared org-level secret from API keys.
   */
  secret?: string;
  headers?: Record<string, string>;
  /** Secret-referenced outbound auth headers (e.g. a Bearer token your endpoint requires). */
  authHeaders?: AgentWebhookAuthHeaderInput[];
  timeoutMs?: number;
  responseMode?: 'sync' | 'async';
  asyncAck?: string;
  /** Post-call data-extraction fields. Applies to the `postCall` webhook only. */
  extractionFields?: AgentExtractionField[];
}

export interface AgentLifecycleWebhookUpdate {
  url: string;
  /**
   * Optional per-webhook signing secret. Supply to set/rotate a per-webhook
   * secret; omit to keep the existing (or shared org-level) secret.
   */
  secret?: string;
  headers?: Record<string, string>;
  /** Secret-referenced outbound auth headers. Replaces the stored set; omit a `value` to keep it. */
  authHeaders?: AgentWebhookAuthHeaderInput[];
  timeoutMs?: number;
  responseMode?: 'sync' | 'async';
  asyncAck?: string;
  /** Post-call data-extraction fields. Applies to the `postCall` webhook only. */
  extractionFields?: AgentExtractionField[];
}

export interface AgentLifecycleWebhookSerialized {
  url: string;
  secretRef: string;
  headers?: Record<string, string>;
  /** Outbound auth-header pointers; values stay encrypted server-side. */
  authHeaders?: AgentWebhookAuthHeader[];
  timeoutMs?: number;
  responseMode?: 'sync' | 'async';
  asyncAck?: string;
  /** Post-call data-extraction fields. Present on the `postCall` webhook only. */
  extractionFields?: AgentExtractionField[];
}

export interface AgentWebhooksSerialized {
  preCall?: AgentLifecycleWebhookSerialized;
  postCall?: AgentLifecycleWebhookSerialized;
  status?: AgentLifecycleWebhookSerialized;
  /** Dedicated `call.analysis` webhook — LLM analysis results only. */
  analysis?: AgentLifecycleWebhookSerialized;
  /** Dedicated `call.recording` webhook — fires when the recording turns terminal. */
  recording?: AgentLifecycleWebhookSerialized;
}

export interface AgentWebhooksCreate {
  preCall?: AgentLifecycleWebhookCreate;
  postCall?: AgentLifecycleWebhookCreate;
  status?: AgentLifecycleWebhookCreate;
  /**
   * Dedicated `call.analysis` webhook. Delivered once per call when the LLM
   * analysis completes: summary, outcome, structured_data, and custom_data —
   * without the transcript/cost/recording of the combined `call.report`.
   */
  analysis?: AgentLifecycleWebhookCreate;
  /**
   * Dedicated `call.recording` webhook. Delivered once per call when the
   * recording reaches a terminal state — `ready` carries the presigned
   * `recording_url` (7-day TTL), `failed` carries `recording_url: null`.
   */
  recording?: AgentLifecycleWebhookCreate;
}

export interface AgentWebhooksUpdate {
  preCall?: AgentLifecycleWebhookUpdate | null;
  postCall?: AgentLifecycleWebhookUpdate | null;
  status?: AgentLifecycleWebhookUpdate | null;
  analysis?: AgentLifecycleWebhookUpdate | null;
  recording?: AgentLifecycleWebhookUpdate | null;
}

/**
 * One prompt-variable registry entry. `defaultValue` fills the variable when a
 * session/dial call omits it (empty string = declared optional: renders blank
 * and `{% if %}` branches false). Without a default the variable is required
 * per call — omitting it fails session create with 400
 * `MISSING_TEMPLATE_VARIABLES`. Names may not use the reserved `system.`
 * namespace.
 */
export interface AgentPromptVariable {
  name: string;
  defaultValue?: string;
  description?: string;
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
  backgroundAudio: AgentBackgroundAudio | null;
  speechNormalization: AgentSpeechNormalization | null;
  webhooks: AgentWebhooksSerialized | null;
  /** Prompt-variable registry. Returned on single-agent reads; null = empty. */
  promptVariables?: AgentPromptVariable[] | null;
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
  backgroundAudio?: AgentBackgroundAudio;
  speechNormalization?: AgentSpeechNormalization;
  webhooks?: AgentWebhooksCreate;
  /** Declare the prompt's `{{variables}}` with per-agent defaults/descriptions. */
  promptVariables?: AgentPromptVariable[];
}

export type AgentUpdateParams = Partial<Omit<AgentCreateParams, 'webhooks'>> & {
  webhooks?: AgentWebhooksUpdate | null;
};

// ─── Calls ───────────────────────────────────────────────────────────

export interface CallTranscriptEntry {
  id: string;
  index: number;
  source: 'user' | 'agent' | 'system';
  text: string;
  started_at: string;
  ended_at: string | null;
  provider: string | null;
  model: string | null;
  metadata: Record<string, unknown>;
  eou_ms?: number | null;
  llm_ttft_ms?: number | null;
  tts_ttfb_ms?: number | null;
  latency_status?: 'partial' | 'complete' | 'interrupted' | 'error' | null;
  conversational_latency_ms?: number | null;
}

export interface CallCostLine {
  provider: string;
  metric: string;
  quantity: number;
  keySource: KeySource;
  costMicroUsd: string;
}

export interface CallReport {
  session_id: string;
  organization_id: string;
  summary: string;
  outcome: string;
  structured_data: Record<string, unknown>;
  transcript: { entries: CallTranscriptEntry[] };
  cost_micro_usd: string;
  cost_breakdown: CallCostLine[];
  artifacts: Record<string, unknown>;
  metadata: Record<string, unknown>;
  scheduled_callback: ScheduledCallback | Record<string, unknown> | null;
  analysis_status: 'heuristic' | 'completed' | 'failed';
  analysis_provider: string | null;
  analysis_model: string | null;
  analysis_error: string | null;
  analysis_completed_at: string | null;
  post_call_webhook_status: 'not_configured' | 'pending' | 'delivered' | 'failed';
  post_call_webhook_attempts: number;
  post_call_webhook_next_retry_at: string | null;
  post_call_webhook_delivered_at: string | null;
  post_call_webhook_error: string | null;
  created_at: string;
  updated_at: string;
}

export type ScheduledCallbackStatus =
  | 'scheduled'
  | 'dispatching'
  | 'dispatched'
  | 'cancelled'
  | 'failed';

export interface ScheduledCallback {
  id: string;
  organization_id: string;
  source_session_id: string | null;
  created_session_id: string | null;
  agent_id: string | null;
  phone_number_id: string | null;
  to_number: string;
  from_number: string | null;
  scheduled_at: string;
  status: ScheduledCallbackStatus;
  reason: string | null;
  instructions: string | null;
  summary: string | null;
  pipeline_config: Record<string, unknown>;
  metadata: Record<string, unknown>;
  failure_cause: string | null;
  attempted_at: string | null;
  dispatched_at: string | null;
  cancelled_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ScheduledCallbacksListParams {
  status?: ScheduledCallbackStatus;
  sourceSessionId?: string;
  limit?: number;
}

export interface CancelScheduledCallbackParams {
  reason?: string;
}

export interface FinalizeCallReportParams {
  forceAnalysis?: boolean;
  retryWebhook?: boolean;
}

export interface FinalizeCallReportResult {
  session_id: string;
  summary: string;
  outcome: string;
  cost_micro_usd: string;
  webhook: unknown;
}

export interface CallRecording {
  url: string;
}

export interface CallEvent {
  id: string;
  session_id: string | null;
  organization_id: string;
  provider: 'livekit' | 'telnyx' | 'speko' | string;
  event_type: string;
  status: string | null;
  failure_cause: string | null;
  sip_status_code: number | null;
  sip_status: string | null;
  occurred_at: string;
  payload: Record<string, unknown>;
  created_at: string;
}

export interface CallTransfer {
  id: string;
  session_id: string;
  organization_id: string;
  kind: 'blind' | 'warm';
  status: 'requested' | 'screening' | 'bridging' | 'completed' | 'failed' | 'cancelled';
  transfer_to: string;
  from_room_name: string | null;
  consultation_room_name: string | null;
  caller_participant_identity: string | null;
  recipient_participant_identity: string | null;
  outbound_trunk_id: string | null;
  screening_prompt: string | null;
  summary: string | null;
  failure_cause: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface CallTransferResponse extends CallTransfer {
  routing_attempts?: (CallTransfer | null)[];
  next_transfer?: CallTransfer | null;
  fallback?: WarmTransferFallbackResult | null;
}

export interface CallDetail {
  id: string;
  call_id: string;
  resource_uri: string;
  agent_id: string | null;
  status: string;
  kind: string;
  room_name: string | null;
  language: string;
  pipeline_config: Record<string, unknown>;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  ended_at: string | null;
  duration_seconds: number | null;
  recording_status: string | null;
  recording_duration_ms: number | null;
  recording_resource_uri: string;
  report: CallReport | null;
  transfers: CallTransfer[];
  transcript: { entries: CallTranscriptEntry[] };
  span_tree: Record<string, unknown>;
}

export interface BlindTransferParams {
  to: string;
  participantIdentity?: string;
  playDialtone?: boolean;
  ringingTimeout?: number;
  headers?: Record<string, string>;
}

export interface WarmTransferDestination {
  to: string;
  label?: string;
  outboundTrunkId?: string;
  screeningPrompt?: string;
  summary?: string;
  metadata?: Record<string, unknown>;
}

export interface WarmTransferFallback {
  strategy?: 'return_to_assistant' | 'take_message' | 'end_call';
  message?: string;
  takeMessagePrompt?: string;
  holdAudioUrl?: string;
}

export interface WarmTransferVoicemailDetection {
  mode?: 'agent' | 'amd' | 'disabled';
  enabled?: boolean;
  timeoutSeconds?: number;
}

export interface WarmTransferFallbackResult {
  action: 'return_to_assistant' | 'take_message' | 'end_call';
  message: string;
  take_message_prompt: string | null;
  hold_audio_url: string | null;
  voicemail_detected: boolean;
}

export interface WarmTransferParams {
  to?: string;
  destinations?: WarmTransferDestination[];
  from?: string;
  participantIdentity?: string;
  outboundTrunkId?: string;
  screeningPrompt?: string;
  summary?: string;
  ringingTimeout?: number;
  waitUntilAnswered?: boolean;
  fallback?: WarmTransferFallback;
  voicemailDetection?: WarmTransferVoicemailDetection;
  metadata?: Record<string, unknown>;
}

export interface CompleteWarmTransferParams {
  recipientParticipantIdentity?: string;
  summary?: string;
}

export interface CancelWarmTransferParams {
  reason?: string;
  summary?: string;
  tryNext?: boolean;
  voicemailDetected?: boolean;
}

export interface AgentCallListParams {
  /** Max rows. Default 50, server-capped at 100. */
  limit?: number;
  /** ISO timestamp returned as `next_cursor` from the previous page. */
  cursor?: string;
  /** ISO timestamp lower bound for calls to include. */
  since?: string;
}

export interface AgentCallListEntry {
  id: string;
  call_id: string;
  resource_uri: string;
  agent_id: string;
  status: string;
  kind: string;
  room_name: string | null;
  language: string;
  created_at: string;
  ended_at: string | null;
  duration_seconds: number | null;
  recording_status: string | null;
}

export interface AgentCallListPage {
  calls: AgentCallListEntry[];
  entries: AgentCallListEntry[];
  next_cursor: string | null;
}

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
  /** Secret-referenced outbound auth headers (e.g. a Bearer token your endpoint requires). */
  authHeaders?: AgentWebhookAuthHeaderInput[];
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
  /** Outbound auth-header pointers; values stay encrypted server-side. */
  authHeaders?: AgentWebhookAuthHeader[];
  timeoutMs?: number;
}

export interface AgentToolSourceBuiltin {
  kind: 'builtin';
  name: string;
  config?: unknown;
}

/**
 * Integration source — binds the tool to an org-installed Speko app action
 * (e.g. Google Calendar `create_event`). Speko resolves the installation and
 * runs the action server-side at completion time. The shape is identical on
 * create and in the serialized row (there is no secret to strip).
 */
export interface AgentToolSourceIntegration {
  kind: 'integration';
  installationId: string;
  appKey: string;
  actionKey: string;
  config?: unknown;
}

/**
 * Webhook source as sent to {@link AgentTools.update}. Unlike the create
 * shape, `secret` is optional: omit it to keep the existing encrypted secret
 * untouched, or supply a new one to rotate it.
 */
export interface AgentToolSourceWebhookUpdate {
  kind: 'webhook';
  url: string;
  /** Plaintext shared secret. Omit to keep the existing stored secret; supply to rotate. */
  secret?: string;
  headers?: Record<string, string>;
  /** Secret-referenced outbound auth headers. Replaces the stored set; omit a `value` to keep it. */
  authHeaders?: AgentWebhookAuthHeaderInput[];
  timeoutMs?: number;
}

export type AgentToolSourceCreate =
  | AgentToolSourceInline
  | AgentToolSourceWebhookCreate
  | AgentToolSourceBuiltin
  | AgentToolSourceIntegration;

export type AgentToolSourceSerialized =
  | AgentToolSourceInline
  | AgentToolSourceWebhookSerialized
  | AgentToolSourceBuiltin
  | AgentToolSourceIntegration;

export type AgentToolSourceUpdate =
  | AgentToolSourceInline
  | AgentToolSourceWebhookUpdate
  | AgentToolSourceBuiltin
  | AgentToolSourceIntegration;

export interface AgentToolRow {
  id: string;
  agentId: string;
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  source: AgentToolSourceSerialized;
  /** Spoken lead-in behavior before this tool executes. */
  preToolSpeech: ChatToolPreToolSpeech;
  createdAt: string;
  updatedAt: string;
}

export interface AgentToolCreateParams {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  source: AgentToolSourceCreate;
  /** Spoken lead-in behavior before the tool executes. Defaults to `auto`. */
  preToolSpeech?: ChatToolPreToolSpeech;
}

export interface AgentToolUpdateParams {
  description?: string;
  parameters?: Record<string, unknown>;
  source?: AgentToolSourceUpdate;
  preToolSpeech?: ChatToolPreToolSpeech;
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

export type KnowledgeBaseDocumentStatus = 'pending' | 'processing' | 'ready' | 'failed';

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
