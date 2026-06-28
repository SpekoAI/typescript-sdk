import type { HttpClient } from '../http.js';
import type {
  AvailablePhoneNumber,
  PhoneNumberCreateParams,
  PhoneNumberImportSipTrunkParams,
  PhoneNumberKybDraftParams,
  PhoneNumberKybOverview,
  PhoneNumberKybSubmission,
  PhoneNumberKybSubmitParams,
  PhoneNumberRow,
  PhoneNumberSearchParams,
  PhoneNumberUpdateParams,
} from '../types/index.js';

/**
 * Phone numbers Speko has provisioned as managed numbers or registered
 * from your own SIP trunk. Each number can be used for outbound dialing
 * and/or inbound, and carries an optional metadata template that's
 * merged into the worker dispatch payload when the number is used.
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

  /**
   * Search the platform-managed pool for orderable US numbers. Filter by area code
   * and/or locality. Results include cost so you can preview "$1 upfront +
   * $1/month" before committing to {@link create}.
   *
   * @example
   * ```ts
   * const candidates = await speko.phoneNumbers.searchAvailable({ areaCode: '415' });
   * console.log(candidates[0].friendlyName); // "+1 (415) 555-0123"
   * ```
   */
  searchAvailable(params: PhoneNumberSearchParams = {}): Promise<AvailablePhoneNumber[]> {
    const query = new URLSearchParams();
    if (params.areaCode) query.set('areaCode', params.areaCode);
    if (params.locality) query.set('locality', params.locality);
    if (params.limit !== undefined) query.set('limit', String(params.limit));
    const qs = query.toString();
    return this.http.get<AvailablePhoneNumber[]>(
      `/v1/phone-numbers/available${qs ? `?${qs}` : ''}`,
    );
  }

  get(id: string): Promise<PhoneNumberRow> {
    return this.http.get<PhoneNumberRow>(`/v1/phone-numbers/${encodeURIComponent(id)}`);
  }

  create(params: PhoneNumberCreateParams): Promise<PhoneNumberRow> {
    return this.http.post<PhoneNumberRow>('/v1/phone-numbers', params);
  }

  importSipTrunk(params: PhoneNumberImportSipTrunkParams): Promise<PhoneNumberRow> {
    return this.http.post<PhoneNumberRow>('/v1/phone-numbers/import', params);
  }

  update(id: string, params: PhoneNumberUpdateParams): Promise<PhoneNumberRow> {
    return this.http.patch<PhoneNumberRow>(`/v1/phone-numbers/${encodeURIComponent(id)}`, params);
  }

  delete(id: string): Promise<{ released: boolean }> {
    return this.http.delete<{ released: boolean }>(`/v1/phone-numbers/${encodeURIComponent(id)}`);
  }

  /**
   * Read business verification state used to gate managed phone-number purchases.
   * Includes the latest submission plus any SMS 10DLC-derived prefill.
   */
  getKyb(): Promise<PhoneNumberKybOverview> {
    return this.http.get<PhoneNumberKybOverview>('/v1/phone-numbers/kyb');
  }

  /**
   * Save a draft business verification submission without sending it for review.
   */
  saveKybDraft(params: PhoneNumberKybDraftParams): Promise<PhoneNumberKybSubmission> {
    return this.http.put<PhoneNumberKybSubmission>('/v1/phone-numbers/kyb/draft', params);
  }

  /**
   * Submit business verification for review. `attestationAccepted` must be `true`.
   */
  submitKyb(params: PhoneNumberKybSubmitParams): Promise<PhoneNumberKybSubmission> {
    return this.http.post<PhoneNumberKybSubmission>('/v1/phone-numbers/kyb/submit', params);
  }
}
