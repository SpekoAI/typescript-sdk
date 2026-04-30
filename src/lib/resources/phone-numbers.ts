import type { HttpClient } from '../http.js';
import type {
  PhoneNumberCreateParams,
  PhoneNumberRow,
  PhoneNumberUpdateParams,
} from '../types/index.js';

/**
 * Phone numbers Speko has provisioned (or imported) on Telnyx for your
 * organization. Each number can be used for outbound dialing and/or
 * inbound, and carries an optional metadata template that's merged into
 * the worker dispatch payload when the number is used.
 *
 * @example
 * ```ts
 * // List org's numbers
 * const numbers = await speko.phoneNumbers.list();
 *
 * // Provision a new US local number
 * const num = await speko.phoneNumbers.create({
 *   e164: '+12015551234',
 *   direction: 'both',
 *   label: 'Sales line',
 *   dispatchMetadataTemplate: {
 *     intent: { language: 'en', optimizeFor: 'latency' },
 *     systemPrompt: 'You are a helpful sales agent for Acme.',
 *   },
 * });
 * ```
 */
export class PhoneNumbers {
  constructor(private readonly http: HttpClient) {}

  list(): Promise<PhoneNumberRow[]> {
    return this.http.get<PhoneNumberRow[]>('/v1/phone-numbers');
  }

  get(id: string): Promise<PhoneNumberRow> {
    return this.http.get<PhoneNumberRow>(
      `/v1/phone-numbers/${encodeURIComponent(id)}`,
    );
  }

  create(params: PhoneNumberCreateParams): Promise<PhoneNumberRow> {
    return this.http.post<PhoneNumberRow>('/v1/phone-numbers', params);
  }

  update(
    id: string,
    params: PhoneNumberUpdateParams,
  ): Promise<PhoneNumberRow> {
    return this.http.patch<PhoneNumberRow>(
      `/v1/phone-numbers/${encodeURIComponent(id)}`,
      params,
    );
  }

  delete(id: string): Promise<{ released: boolean }> {
    return this.http.delete<{ released: boolean }>(
      `/v1/phone-numbers/${encodeURIComponent(id)}`,
    );
  }
}
