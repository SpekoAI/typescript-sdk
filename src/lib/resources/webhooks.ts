import type { HttpClient } from '../http.js';
import type {
  WebhookDeliveryDetail,
  WebhookDeliveryListParams,
  WebhookDeliveryPage,
  WebhookEndpoint,
  WebhookEndpointInput,
  WebhookEndpointUpdate,
} from '../types/index.js';

/** Organization-owned lifecycle webhook endpoints and their delivery history. */
export class Webhooks {
  readonly deliveries: WebhookDeliveries;

  constructor(private readonly http: HttpClient) {
    this.deliveries = new WebhookDeliveries(http);
  }

  async list(): Promise<WebhookEndpoint[]> {
    const response = await this.http.get<{ data: WebhookEndpoint[] }>('/v1/webhooks');
    return response.data;
  }

  create(params: WebhookEndpointInput): Promise<WebhookEndpoint> {
    return this.http.post<WebhookEndpoint>('/v1/webhooks', params);
  }

  get(endpointId: string): Promise<WebhookEndpoint> {
    return this.http.get<WebhookEndpoint>(`/v1/webhooks/${encodeURIComponent(endpointId)}`);
  }

  update(endpointId: string, params: WebhookEndpointUpdate): Promise<WebhookEndpoint> {
    return this.http.patch<WebhookEndpoint>(
      `/v1/webhooks/${encodeURIComponent(endpointId)}`,
      params,
    );
  }

  async delete(endpointId: string): Promise<void> {
    await this.http.delete<unknown>(`/v1/webhooks/${encodeURIComponent(endpointId)}`);
  }
}

export class WebhookDeliveries {
  constructor(private readonly http: HttpClient) {}

  list(params: WebhookDeliveryListParams = {}): Promise<WebhookDeliveryPage> {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) query.set(key, String(value));
    }
    const suffix = query.size > 0 ? `?${query.toString()}` : '';
    return this.http.get<WebhookDeliveryPage>(`/v1/webhook-deliveries${suffix}`);
  }

  get(deliveryId: string): Promise<WebhookDeliveryDetail> {
    return this.http.get<WebhookDeliveryDetail>(
      `/v1/webhook-deliveries/${encodeURIComponent(deliveryId)}`,
    );
  }

  redeliver(
    deliveryId: string,
  ): Promise<{ delivered: boolean; httpStatus: number | null; error: string | null }> {
    return this.http.post(`/v1/webhook-deliveries/${encodeURIComponent(deliveryId)}/redeliver`, {});
  }
}
