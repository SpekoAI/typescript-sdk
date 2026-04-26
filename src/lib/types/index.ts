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
  /** Current organization balance in micro-USD (1_000_000 µ$ = $1), as string. */
  balanceMicroUsd: string;
  balanceUsd: number;
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
  balanceMicroUsd: string;
  balanceUsd: number;
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

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface CompleteParams {
  messages: ChatMessage[];
  intent: RoutingIntent;
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
  constraints?: PipelineConstraints;
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
}

// --- Realtime (S2S) ---------------------------------------------------------

export type RealtimeProvider = 'openai' | 'google' | 'xai';

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
