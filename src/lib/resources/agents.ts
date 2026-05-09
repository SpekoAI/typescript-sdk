import type { HttpClient } from '../http.js';
import type {
  AgentCall,
  AgentCreateParams,
  AgentEval,
  AgentEvalRun,
  AgentRow,
  AgentVersion,
  DeployAgentParams,
  RollbackAgentParams,
} from '../types/platform.js';

export class Agents {
  constructor(private readonly http: HttpClient) {}

  list(signal?: AbortSignal): Promise<AgentRow[]> {
    return this.http.get<AgentRow[]>('/v1/agents', signal);
  }

  get(id: string, signal?: AbortSignal): Promise<AgentRow> {
    return this.http.get<AgentRow>(`/v1/agents/${encodeURIComponent(id)}`, signal);
  }

  create(params: AgentCreateParams, signal?: AbortSignal): Promise<AgentRow> {
    return this.http.post<AgentRow>('/v1/agents', params, signal);
  }

  deploy(
    id: string,
    params: DeployAgentParams,
    signal?: AbortSignal,
  ): Promise<AgentVersion> {
    return this.http.post<AgentVersion>(
      `/v1/agents/${encodeURIComponent(id)}/deploy`,
      params,
      signal,
    );
  }

  versions(id: string, signal?: AbortSignal): Promise<AgentVersion[]> {
    return this.http.get<AgentVersion[]>(
      `/v1/agents/${encodeURIComponent(id)}/versions`,
      signal,
    );
  }

  rollback(
    id: string,
    params: RollbackAgentParams,
    signal?: AbortSignal,
  ): Promise<AgentVersion> {
    return this.http.post<AgentVersion>(
      `/v1/agents/${encodeURIComponent(id)}/rollback`,
      params,
      signal,
    );
  }

  evals(id: string, signal?: AbortSignal): Promise<AgentEval[]> {
    return this.http.get<AgentEval[]>(
      `/v1/agents/${encodeURIComponent(id)}/evals`,
      signal,
    );
  }

  runEval(
    id: string,
    evalId: string,
    signal?: AbortSignal,
  ): Promise<AgentEvalRun> {
    return this.http.post<AgentEvalRun>(
      `/v1/agents/${encodeURIComponent(id)}/evals/${encodeURIComponent(
        evalId,
      )}/run`,
      {},
      signal,
    );
  }

  calls(id: string, signal?: AbortSignal): Promise<AgentCall[]> {
    return this.http.get<AgentCall[]>(
      `/v1/agents/${encodeURIComponent(id)}/calls`,
      signal,
    );
  }

  async streamCalls(
    id: string,
    onEvent: (event: AgentCall) => void,
    signal?: AbortSignal,
  ): Promise<boolean> {
    const response = await this.http.getStream<AgentCall, AgentCall>(
      `/v1/agents/${encodeURIComponent(id)}/calls?follow=1`,
      {
        externalSignal: signal,
        onEvent,
        resultFromEvent: (event) => event,
      },
    );
    return response.streamed;
  }
}
