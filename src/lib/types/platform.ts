/* eslint-disable @nx/enforce-module-boundaries -- Stage 2 CLI/SDK must reuse the canonical contracts package types without redefining them. */
import type {
  AgentCallsResponse,
  AgentVersion,
  BuildBrainBriefing,
  BuildBrainInput,
  BuildBrainOutput,
  BuildBrainStreamEvent,
  Call,
  InferenceInspectRequest,
  InferenceInspectResponse,
  InferenceParseConfigRequest,
  InferenceParseConfigResponse,
  SessionConfig,
} from '@spekoai/contracts';

export type {
  AgentCallsResponse,
  AgentVersion,
  BuildBrainBriefing,
  BuildBrainInput,
  BuildBrainOutput,
  BuildBrainStreamEvent,
  InferenceInspectRequest,
  InferenceInspectResponse,
  InferenceParseConfigRequest,
  InferenceParseConfigResponse,
  SessionConfig,
};

export type AgentCall = Call;

export interface AgentRow {
  id: string;
  organizationId: string;
  name: string;
  systemPrompt: string;
  voice: string | null;
  intent: {
    language: string;
    optimizeFor?: 'latency' | 'quality' | 'cost';
  };
  llmOptions: {
    temperature?: number;
    maxTokens?: number;
    model?: string;
  } | null;
  stackPreferences: {
    allowedProviders?: {
      stt?: string[];
      llm?: string[];
      tts?: string[];
      s2s?: string[];
    };
  } | null;
  createdAt: string;
  updatedAt: string;
}

export interface AgentCreateParams {
  name: string;
  systemPrompt: string;
  voice?: string;
  intent: {
    language: string;
    optimizeFor?: 'latency' | 'quality' | 'cost';
  };
  llmOptions?: {
    temperature?: number;
    maxTokens?: number;
    model?: string;
  };
  stackPreferences?: {
    allowedProviders?: {
      stt?: string[];
      llm?: string[];
      tts?: string[];
      s2s?: string[];
    };
  };
}

export interface DeployAgentParams {
  session_config: SessionConfig;
  briefing_md?: string;
}

export interface RollbackAgentParams {
  target_version_number: number;
}

export interface AgentEval {
  id: string;
  organization_id?: string;
  agent_id?: string;
  name: string;
  description?: string | null;
  input_kind?: 'transcript' | 'audio_url' | 'assertion_only';
  input_payload?: Record<string, unknown>;
  expected_behavior: string;
  assertion_kind?:
    | 'contains_phrase'
    | 'tool_called'
    | 'language_switched'
    | 'within_latency'
    | 'no_hallucination'
    | 'custom';
  assertion_config?: Record<string, unknown>;
  source_call_id?: string | null;
  block_deploy_on_fail?: boolean;
  last_run_pass?: boolean | null;
  created_at?: string;
  updated_at?: string;
}

export interface AgentEvalRun {
  id: string;
  eval_id: string;
  agent_version_id: string;
  status: 'pass' | 'fail' | 'error';
  failure_reason: string | null;
  latency_ms: number | null;
  cost_micro_usd: string | null;
  run_at: string;
}
