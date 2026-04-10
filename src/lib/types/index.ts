/** Options for creating a SpekoAI client. */
export interface SpekoClientOptions {
  /** API key for authentication. */
  apiKey: string;
  /** Base URL of the SpekoAI API. Defaults to https://api.speko.ai */
  baseUrl?: string;
  /** Request timeout in milliseconds. Defaults to 30000. */
  timeout?: number;
}

/** Pipeline configuration for a voice session. */
export interface PipelineConfig {
  stt: {
    provider: 'deepgram';
    model?: string;
    language?: string;
    keywords?: string[];
  };
  llm: {
    provider: 'openai';
    model: string;
    systemPrompt?: string;
    temperature?: number;
    maxTokens?: number;
  };
  tts: {
    provider: 'elevenlabs' | 'cartesia';
    voice: string;
    model?: string;
    speed?: number;
  };
}

/** Parameters for creating a session. */
export interface CreateSessionParams {
  pipeline: PipelineConfig;
  metadata?: Record<string, unknown>;
}

/** A voice session returned by the API. */
export interface Session {
  id: string;
  status: 'created' | 'connecting' | 'active' | 'ended' | 'failed';
  roomName: string;
  token: string;
  livekitUrl: string;
  createdAt: string;
}

/** A session detail object. */
export interface SessionDetail {
  id: string;
  workspaceId: string;
  status: 'created' | 'connecting' | 'active' | 'ended' | 'failed';
  roomName: string;
  pipelineConfig: PipelineConfig;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  endedAt: string | null;
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
