/** Options for creating a Speko client. */
export interface SpekoClientOptions {
  /** API key for authentication. */
  apiKey: string;
  /** Base URL of the Speko API. Defaults to https://api.speko.ai */
  baseUrl?: string;
  /** Request timeout in milliseconds. Defaults to 30000. */
  timeout?: number;
}

/** Usage record for a workspace. */
export interface UsageSummary {
  totalSessions: number;
  totalMinutes: number;
  totalCost: number;
  breakdown: UsageByProvider[];
}

export interface UsageByProvider {
  provider: string;
  type: 'stt' | 'llm' | 'tts';
  metric: string;
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

// --- Routing primitives -----------------------------------------------------

/** Vertical labels supported by the router. */
export type Vertical = 'general' | 'healthcare' | 'finance' | 'legal';

/** Optimization preset that biases the router's weighted score. */
export type OptimizeFor = 'balanced' | 'accuracy' | 'latency' | 'cost';

/** Routing intent passed to the proxy primitives. */
export interface RoutingIntent {
  /** BCP-47 language tag, e.g. "en" or "es-MX". */
  language: string;
  vertical: Vertical;
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
