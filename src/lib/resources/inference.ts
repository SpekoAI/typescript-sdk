import type { HttpClient } from '../http.js';
import type {
  BuildBrainInput,
  BuildBrainOutput,
  BuildBrainStreamEvent,
  InferenceInspectRequest,
  InferenceInspectResponse,
  InferenceParseConfigRequest,
  InferenceParseConfigResponse,
} from '../types/platform.js';

export interface BuildSessionConfigOptions {
  idempotencyKey?: string;
  signal?: AbortSignal;
  onEvent?: (event: BuildBrainStreamEvent) => void;
}

export class Inference {
  constructor(private readonly http: HttpClient) {}

  async buildSessionConfig(
    input: BuildBrainInput,
    options: BuildSessionConfigOptions = {},
  ): Promise<BuildBrainOutput> {
    const reasoningTrace: BuildBrainOutput['reasoning_trace'] = [];
    const warnings: string[] = [];
    const response = await this.http.postStream<
      BuildBrainStreamEvent,
      BuildBrainOutput
    >('/v1/inference/sessionconfig', {
      body: input,
      externalSignal: options.signal,
      headers: {
        ...(options.idempotencyKey && {
          'Idempotency-Key': options.idempotencyKey,
        }),
      },
      onEvent: (event) => {
        if (event.kind === 'decision') {
          reasoningTrace.push({
            component: event.component,
            decision: event.decision,
            alternatives_considered: event.alternatives_considered,
            ...(event.cost_estimate !== undefined && {
              cost_estimate: event.cost_estimate,
            }),
          });
        }
        if (event.kind === 'warning') {
          warnings.push(event.message);
        }
        options.onEvent?.(event);
      },
      resultFromEvent: (event) =>
        buildOutputFromEvent(event, reasoningTrace, warnings),
    });

    if (!response.result) {
      throw new Error('BuildBrain stream ended without a complete result');
    }
    return response.result;
  }

  parseConfig(
    input: InferenceParseConfigRequest,
    signal?: AbortSignal,
  ): Promise<InferenceParseConfigResponse> {
    return this.http.post<InferenceParseConfigResponse>(
      '/v1/inference/parse-config',
      input,
      signal,
    );
  }

  inspect(
    input: InferenceInspectRequest,
    signal?: AbortSignal,
  ): Promise<InferenceInspectResponse> {
    return this.http.post<InferenceInspectResponse>(
      '/v1/inference/inspect',
      input,
      signal,
    );
  }
}

function buildOutputFromEvent(
  event: BuildBrainStreamEvent,
  reasoningTrace: BuildBrainOutput['reasoning_trace'],
  warnings: string[],
): BuildBrainOutput | null {
  if (event.kind !== 'complete') return null;
  return {
    session_config: event.session_config,
    reasoning_trace: reasoningTrace,
    briefing: event.briefing,
    confidence: 'high',
    warnings,
  };
}
