import type { HttpClient } from '../http.js';
import type {
  CreditLedgerPage,
  CreditLedgerQueryParams,
  OrganizationBalance,
} from '../types/index.js';

/**
 * Prepaid credit balance + append-only ledger. Balance is reported in
 * micro-USD (`1_000_000` µ$ = $1) alongside a float USD helper.
 */
export class Credits {
  constructor(private readonly http: HttpClient) {}

  /**
   * Current credit balance for the caller's organization.
   *
   * @example
   * ```ts
   * const { balanceUsd } = await speko.credits.getBalance();
   * if (balanceUsd < 0.5) showLowBalanceBanner();
   * ```
   */
  getBalance(): Promise<OrganizationBalance> {
    return this.http.get<OrganizationBalance>('/v1/credits/balance');
  }

  /**
   * Most-recent-first page of credit movements (grants, debits, topups,
   * refunds, adjustments). `nextCursor` is the `createdAt` of the last
   * entry on the current page — pass it back as `cursor` to fetch the
   * next page; `null` means no more pages.
   */
  getLedger(params?: CreditLedgerQueryParams): Promise<CreditLedgerPage> {
    const query = new URLSearchParams();
    if (params?.limit) query.set('limit', String(params.limit));
    if (params?.cursor) query.set('cursor', params.cursor);

    const qs = query.toString();
    return this.http.get<CreditLedgerPage>(
      `/v1/credits/ledger${qs ? `?${qs}` : ''}`,
    );
  }
}
