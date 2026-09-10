import type { HttpClient } from '../http.js';
import type {
  BlindTransferParams,
  CallDetail,
  CallEvent,
  CallRecording,
  CallReport,
  CallTransfer,
  CallTransferResponse,
  CancelWarmTransferParams,
  CompleteWarmTransferParams,
  EndCallResult,
  FinalizeCallReportParams,
  FinalizeCallReportResult,
  WarmTransferParams,
  WebJoinParams,
  WebJoinResult,
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

  finalizeReport(
    callId: string,
    params: FinalizeCallReportParams = {},
  ): Promise<FinalizeCallReportResult> {
    return this.http.post<FinalizeCallReportResult>(
      `/v1/calls/${encodeURIComponent(callId)}/report/finalize`,
      params,
    );
  }

  recording(callId: string): Promise<CallRecording> {
    return this.http.get<CallRecording>(`/v1/calls/${encodeURIComponent(callId)}/recording`);
  }

  /**
   * Browser bridge-in: mint a short-lived token that joins THIS live call's
   * room from a web client (pass `token`/`url` to `@spekoai/client`'s
   * `VoiceConversation.create({ transportToken, transportUrl })`). Once the
   * browser publishes audio the platform bridges it to the phone leg and
   * mutes the agent; when the browser leaves, the agent resumes.
   *
   * Mint at click time — the token is short-TTL and a `409` means the call
   * is no longer live. Concurrent/repeat joins are allowed (rejoin after a
   * drop just calls this again).
   */
  webJoin(callId: string, params: WebJoinParams = {}): Promise<WebJoinResult> {
    return this.http.post<WebJoinResult>(
      `/v1/calls/${encodeURIComponent(callId)}/web-join`,
      params,
    );
  }

  /**
   * End a live call now (kill switch): tears the room down, which hangs up
   * every leg. Resolves with `status: 'ending'` once teardown is requested,
   * or `status: 'already_ended'` if the call was over.
   */
  end(callId: string): Promise<EndCallResult> {
    return this.http.post<EndCallResult>(`/v1/calls/${encodeURIComponent(callId)}/end`, {});
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
