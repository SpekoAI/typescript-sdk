import type { HttpClient } from '../http.js';
import type { UsageSummary, UsageQueryParams } from '../types/index.js';

export class Usage {
  constructor(private readonly http: HttpClient) {}

  /**
   * Get usage summary for the current billing period.
   *
   * @example
   * ```ts
   * const usage = await speko.usage.get();
   * console.log(usage.totalMinutes, usage.totalCost);
   * ```
   */
  async get(params?: UsageQueryParams): Promise<UsageSummary> {
    const query = new URLSearchParams();
    if (params?.from) query.set('from', params.from);
    if (params?.to) query.set('to', params.to);

    const qs = query.toString();
    return this.http.get<UsageSummary>(
      `/v1/usage${qs ? `?${qs}` : ''}`,
    );
  }
}
