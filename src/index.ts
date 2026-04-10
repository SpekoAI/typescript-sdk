export { SpekoAI } from './lib/client.js';
export { SpekoApiError, SpekoAuthError, SpekoRateLimitError } from './lib/errors.js';
export type {
  SpekoClientOptions,
  PipelineConfig,
  CreateSessionParams,
  Session,
  SessionDetail,
  UsageSummary,
  UsageByProvider,
  UsageQueryParams,
} from './lib/types/index.js';
