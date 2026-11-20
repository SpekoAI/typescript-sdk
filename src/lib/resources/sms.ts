import type { HttpClient } from '../http.js';
import type {
  SmsBatch,
  SmsBatchCreateParams,
  SmsConsent,
  SmsConsentInput,
  SmsConsentListParams,
  SmsConversation,
  SmsConversationListParams,
  SmsConversationNote,
  SmsConversationSendParams,
  SmsConversationUpdate,
  SmsMessage,
  SmsMessageListParams,
  SmsPage,
  SmsSendParams,
  SmsSettings,
  SmsSettingsUpdate,
  SmsStreamEvent,
  SmsSuppression,
} from '../types/index.js';

export class Sms {
  readonly messages: SmsMessages;
  readonly batches: SmsBatches;
  readonly conversations: SmsConversations;
  readonly consents: SmsConsents;
  readonly suppressions: SmsSuppressions;
  readonly settings: SmsSettingsResource;

  constructor(private readonly http: HttpClient) {
    this.messages = new SmsMessages(http);
    this.batches = new SmsBatches(http);
    this.conversations = new SmsConversations(http);
    this.consents = new SmsConsents(http);
    this.suppressions = new SmsSuppressions(http);
    this.settings = new SmsSettingsResource(http);
  }

  async *stream(
    options: { lastEventId?: string; signal?: AbortSignal } = {},
  ): AsyncIterableIterator<SmsStreamEvent> {
    const headers = options.lastEventId ? { 'Last-Event-ID': options.lastEventId } : undefined;
    for await (const event of this.http.requestSse(
      'GET',
      '/v1/sms/stream',
      undefined,
      options.signal,
      headers,
      0,
    )) {
      if (event.event === 'heartbeat') continue;
      const data = event.data as Omit<SmsStreamEvent, 'event' | 'id'>;
      yield { event: event.event, ...(event.id ? { id: event.id } : {}), ...data };
    }
  }
}

export class SmsMessages {
  constructor(private readonly http: HttpClient) {}

  send(params: SmsSendParams): Promise<SmsMessage> {
    const { idempotencyKey, ...body } = params;
    return this.http.post('/v1/sms/messages', body, undefined, {
      'Idempotency-Key': idempotencyKey,
    });
  }

  list(params: SmsMessageListParams = {}): Promise<SmsPage<SmsMessage>> {
    return this.http.get(`/v1/sms/messages${query(params)}`);
  }

  get(messageId: string): Promise<SmsMessage> {
    return this.http.get(`/v1/sms/messages/${encodeURIComponent(messageId)}`);
  }

  cancel(messageId: string): Promise<SmsMessage> {
    return this.http.post(`/v1/sms/messages/${encodeURIComponent(messageId)}/cancel`, {});
  }
}

export class SmsBatches {
  constructor(private readonly http: HttpClient) {}

  create(params: SmsBatchCreateParams): Promise<SmsBatch> {
    const { idempotencyKey, ...body } = params;
    return this.http.post('/v1/sms/batches', body, undefined, {
      'Idempotency-Key': idempotencyKey,
    });
  }

  get(batchId: string): Promise<SmsBatch> {
    return this.http.get(`/v1/sms/batches/${encodeURIComponent(batchId)}`);
  }

  messages(
    batchId: string,
    params: { cursor?: string; limit?: number } = {},
  ): Promise<SmsPage<SmsMessage>> {
    return this.http.get(`/v1/sms/batches/${encodeURIComponent(batchId)}/messages${query(params)}`);
  }

  cancel(batchId: string): Promise<SmsBatch> {
    return this.http.post(`/v1/sms/batches/${encodeURIComponent(batchId)}/cancel`, {});
  }
}

export class SmsConversations {
  constructor(private readonly http: HttpClient) {}

  list(params: SmsConversationListParams = {}): Promise<SmsPage<SmsConversation>> {
    return this.http.get(`/v1/sms/conversations${query(params)}`);
  }

  get(conversationId: string): Promise<SmsConversation> {
    return this.http.get(`/v1/sms/conversations/${encodeURIComponent(conversationId)}`);
  }

  messages(
    conversationId: string,
    params: { cursor?: string; limit?: number } = {},
  ): Promise<SmsPage<SmsMessage>> {
    return this.http.get(
      `/v1/sms/conversations/${encodeURIComponent(conversationId)}/messages${query(params)}`,
    );
  }

  send(conversationId: string, params: SmsConversationSendParams): Promise<SmsMessage> {
    const { idempotencyKey, ...body } = params;
    return this.http.post(
      `/v1/sms/conversations/${encodeURIComponent(conversationId)}/messages`,
      body,
      undefined,
      { 'Idempotency-Key': idempotencyKey },
    );
  }

  update(conversationId: string, params: SmsConversationUpdate): Promise<SmsConversation> {
    return this.http.patch(`/v1/sms/conversations/${encodeURIComponent(conversationId)}`, params);
  }

  markRead(conversationId: string): Promise<SmsConversation> {
    return this.http.post(`/v1/sms/conversations/${encodeURIComponent(conversationId)}/read`, {});
  }

  addNote(conversationId: string, body: string): Promise<SmsConversationNote> {
    return this.http.post(`/v1/sms/conversations/${encodeURIComponent(conversationId)}/notes`, {
      body,
    });
  }

  notes(
    conversationId: string,
    params: { limit?: number } = {},
  ): Promise<SmsPage<SmsConversationNote>> {
    return this.http.get(
      `/v1/sms/conversations/${encodeURIComponent(conversationId)}/notes${query(params)}`,
    );
  }

  async redact(conversationId: string): Promise<void> {
    await this.http.delete(`/v1/sms/conversations/${encodeURIComponent(conversationId)}`);
  }
}

export class SmsConsents {
  constructor(private readonly http: HttpClient) {}

  list(params: SmsConsentListParams = {}): Promise<SmsPage<SmsConsent>> {
    return this.http.get(`/v1/sms/consents${query(params)}`);
  }

  create(params: SmsConsentInput): Promise<SmsConsent> {
    return this.http.post('/v1/sms/consents', params);
  }

  import(records: readonly SmsConsentInput[]): Promise<{ data: SmsConsent[]; imported: number }> {
    return this.http.post('/v1/sms/consents/import', { records });
  }

  revoke(consentId: string, reason = 'manual_revocation'): Promise<SmsConsent> {
    return this.http.post(`/v1/sms/consents/${encodeURIComponent(consentId)}/revoke`, { reason });
  }
}

export class SmsSuppressions {
  constructor(private readonly http: HttpClient) {}

  list(
    params: { recipient?: string; active?: boolean; limit?: number } = {},
  ): Promise<SmsPage<SmsSuppression>> {
    return this.http.get(`/v1/sms/suppressions${query(params)}`);
  }
}

export class SmsSettingsResource {
  constructor(private readonly http: HttpClient) {}

  get(): Promise<SmsSettings | null> {
    return this.http.get('/v1/sms/settings');
  }

  update(params: SmsSettingsUpdate): Promise<SmsSettings> {
    return this.http.patch('/v1/sms/settings', params);
  }
}

function query(params: object): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) search.set(key, String(value));
  }
  return search.size ? `?${search.toString()}` : '';
}
