import type { HttpClient } from '../http.js';
import type {
  WhatsAppConnection,
  WhatsAppConnectParams,
  WhatsAppDisconnectResult,
  WhatsAppNumber,
  WhatsAppNumberUpdateParams,
} from '../types/index.js';

/**
 * WhatsApp numbers connected through your own Meta app. Speko reads the number
 * from Meta with your token, stores the token and app secret encrypted, and
 * never returns either.
 *
 * @example
 * ```ts
 * const connection = await speko.whatsapp.connect({
 *   accessToken: process.env.META_SYSTEM_USER_TOKEN!,
 *   appSecret: process.env.META_APP_SECRET!,
 *   phoneNumberId: '123456789012345',
 *   agentId: 'agent_123',
 * });
 * // Set these on your Meta app's WhatsApp webhook, subscribed to `calls`.
 * console.log(connection.webhookUrl, connection.verifyToken);
 * ```
 */
export class WhatsApp {
  constructor(private readonly http: HttpClient) {}

  /**
   * Retrying with the same phone number ID, token, and app secret is safe: it
   * returns the existing connection.
   */
  connect(params: WhatsAppConnectParams): Promise<WhatsAppConnection> {
    return this.http.post<WhatsAppConnection>('/v1/whatsapp/connections', params);
  }

  /** The workspace's WhatsApp numbers, with each one's webhook settings and calling status. */
  listNumbers(): Promise<{ data: WhatsAppNumber[] }> {
    return this.http.get<{ data: WhatsAppNumber[] }>('/v1/whatsapp/numbers');
  }

  /** Sets the agent that answers a number, or `null` to stop answering. */
  updateNumber(id: string, params: WhatsAppNumberUpdateParams): Promise<WhatsAppNumber> {
    return this.http.patch<WhatsAppNumber>(
      `/v1/whatsapp/numbers/${encodeURIComponent(id)}`,
      params,
    );
  }

  /**
   * Deletes the stored token and app secret and removes the number. Connecting
   * it again gives a new webhook URL and verify token.
   */
  disconnect(connectionId: string): Promise<WhatsAppDisconnectResult> {
    return this.http.delete<WhatsAppDisconnectResult>(
      `/v1/whatsapp/connections/${encodeURIComponent(connectionId)}`,
    );
  }
}
