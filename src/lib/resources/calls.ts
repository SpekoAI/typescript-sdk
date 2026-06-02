import type { HttpClient } from '../http.js';
import type {
  BlindTransferParams,
  CallDetail,
  CallEvent,
  CallReport,
  CallTransfer,
  CallTransferResponse,
  CancelWarmTransferParams,
  CompleteWarmTransferParams,
  WarmTransferParams,
} from '../types/index.js';

export class Calls {
  constructor(private readonly http: HttpClient) {}

  get(callId: string): Promise<CallDetail> {
    return this.http.get<CallDetail>(`/v1/calls/${encodeURIComponent(callId)}`);
  }

  events(callId: string): Promise<{ events: CallEvent[] }> {
    return this.http.get<{ events: CallEvent[] }>(`/v1/calls/${encodeURIComponent(callId)}/events`);
  }

  report(callId: string): Promise<CallReport> {
    return this.http.get<CallReport>(`/v1/calls/${encodeURIComponent(callId)}/report`);
  }

  finalizeReport(callId: string): Promise<{
    session_id: string;
    summary: string;
    outcome: string;
    cost_micro_usd: string;
    webhook: unknown;
  }> {
    return this.http.post(`/v1/calls/${encodeURIComponent(callId)}/report/finalize`, {});
  }

  blindTransfer(callId: string, params: BlindTransferParams): Promise<CallTransfer> {
    return this.http.post<CallTransfer>(
      `/v1/calls/${encodeURIComponent(callId)}/transfers/blind`,
      params,
    );
  }

  warmTransfer(callId: string, params: WarmTransferParams): Promise<CallTransferResponse> {
    return this.http.post<CallTransferResponse>(
      `/v1/calls/${encodeURIComponent(callId)}/transfers/warm`,
      params,
    );
  }

  completeWarmTransfer(
    callId: string,
    transferId: string,
    params: CompleteWarmTransferParams = {},
  ): Promise<CallTransfer> {
    return this.http.post<CallTransfer>(
      `/v1/calls/${encodeURIComponent(callId)}/transfers/${encodeURIComponent(
        transferId,
      )}/complete`,
      params,
    );
  }

  cancelWarmTransfer(
    callId: string,
    transferId: string,
    params: CancelWarmTransferParams = {},
  ): Promise<CallTransferResponse> {
    return this.http.post<CallTransferResponse>(
      `/v1/calls/${encodeURIComponent(callId)}/transfers/${encodeURIComponent(transferId)}/cancel`,
      params,
    );
  }
}
