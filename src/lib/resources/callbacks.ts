import type { HttpClient } from '../http.js';
import type {
  CancelScheduledCallbackParams,
  ScheduledCallback,
  ScheduledCallbacksListParams,
} from '../types/index.js';

export class Callbacks {
  constructor(private readonly http: HttpClient) {}

  list(params: ScheduledCallbacksListParams = {}): Promise<{ callbacks: ScheduledCallback[] }> {
    const query = new URLSearchParams();
    if (params.status) query.set('status', params.status);
    if (params.sourceSessionId) query.set('source_session_id', params.sourceSessionId);
    if (params.limit !== undefined) query.set('limit', String(params.limit));
    const suffix = query.toString() ? `?${query}` : '';
    return this.http.get<{ callbacks: ScheduledCallback[] }>(`/v1/callbacks${suffix}`);
  }

  get(callbackId: string): Promise<ScheduledCallback> {
    return this.http.get<ScheduledCallback>(`/v1/callbacks/${encodeURIComponent(callbackId)}`);
  }

  cancel(
    callbackId: string,
    params: CancelScheduledCallbackParams = {},
  ): Promise<ScheduledCallback> {
    return this.http.post<ScheduledCallback>(
      `/v1/callbacks/${encodeURIComponent(callbackId)}/cancel`,
      params,
    );
  }

  dispatch(callbackId: string): Promise<ScheduledCallback> {
    return this.http.post<ScheduledCallback>(
      `/v1/callbacks/${encodeURIComponent(callbackId)}/dispatch`,
      {},
    );
  }
}
