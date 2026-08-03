import type { HttpClient } from '../http.js';
import type {
  CallControlDialParams,
  CallControlDialResult,
  CallControlListParams,
  VoiceDialParams,
  VoiceDialResult,
} from '../types/index.js';
import type {
  BridgeCommandPayload,
  BrokerPresenceResource,
  BrokerPresenceStatus,
  CallCommand,
  CallCommandPayload,
  CallCommandResult,
  CallEventResource,
  CallJoinCredentials,
  CallResource,
  DtmfCommandPayload,
  HangupCommandPayload,
  TransferCommandPayload,
} from '../voice-contract.js';

/**
 * Outbound phone calls via Speko's managed telephony gateway.
 *
 * @example
 * ```ts
 * const { sessionId, status } = await speko.voice.dial({
 *   to: '+12015551234',
 *   intent: { language: 'en', optimizeFor: 'latency' },
 *   systemPrompt: 'You are a helpful Speko assistant. Greet the caller in English.',
 * });
 * console.log('dialing:', sessionId, status);
 * ```
 */
export class Voice {
  constructor(private readonly http: HttpClient) {}

  /**
   * Place an outbound call. The destination's phone rings; once they pick
   * up, audio bridges to a Speko worker running the configured pipeline
   * (STT→LLM→TTS) on the media transport.
   *
   * Lifecycle is reflected in the `voice_session` row's `status`.
   */
  async dial(params: VoiceDialParams): Promise<VoiceDialResult> {
    return this.http.post<VoiceDialResult>('/v1/sessions/phone', params);
  }
}

/**
 * Programmable voice — call control for **human** calls.
 *
 * Modeled on Telnyx Call Control, and the mapping is meant to be mechanical:
 * every leg of a call has an opaque `controlId` (Telnyx's `call_control_id`),
 * and every verb is addressed to that handle rather than to a room, a session,
 * or a participant. `speko.callControl.hangup(controlId)` is
 * `POST /calls/{call_control_id}/actions/hangup`, and so on down the list.
 *
 * This is a different product from {@link Voice.dial}, which dials an **AI
 * agent** out over the same telephony gateway. Here the parties are people:
 * brokers on a browser softphone and phones on the PSTN. An AI leg can still be
 * added to a call, which is what makes escalating an agent call to a human an
 * ordinary {@link CallControl.bridge} rather than a special case.
 *
 * ### Porting from Telnyx — the two things that differ
 *
 * 1. **`hold` is silent by default.** There is no hold primitive on the
 *    underlying transport; hold is synthesized from mute plus unsubscribe. With
 *    no music-on-hold source configured the held party hears nothing at all.
 *    If your Telnyx flow relied on `playback_start` looping hold music, that
 *    has no equivalent yet.
 * 2. **There is no SIP registrar.** A desk phone, a third-party softphone, or
 *    another PBX cannot register against Speko and be rung. Human legs are
 *    browser legs — `browser` and `pstn` are the only human-reachable leg
 *    kinds. Anything in your Telnyx setup that terminated on a SIP connection
 *    needs to become a PSTN transfer or a browser client.
 *
 * A handful of Telnyx events also have no faithful equivalent and are absent
 * rather than approximated: no early-media event, and no way to tell a 486 Busy
 * from a generic rejection.
 *
 * ### Broker identity
 *
 * Human calling uses the API key for organization authentication and the
 * `brokerId` passed to `new Speko({ apiKey, brokerId })` for softphone identity.
 * The SDK automatically includes that id on presence, dial, and join requests.
 * Commands and org-wide reads do not need it on the wire.
 *
 * @example
 * ```ts
 * const speko = new Speko({ apiKey: process.env.SPEKO_API_KEY, brokerId: 'broker-42' });
 *
 * // Come online, then hold a presence connection open so inbound can ring you.
 * await speko.callControl.register();
 * const presence = await speko.callControl.presenceToken();
 * setInterval(() => speko.callControl.heartbeat(), PRESENCE_STALE_AFTER_MS / 3);
 *
 * // Dial out. The browser leg is yours; the PSTN leg is the customer.
 * const { call, join } = await speko.callControl.dial({ to: '+12015551234' });
 * const mine = call.legs.find((leg) => leg.kind === 'browser');
 *
 * // Park the customer, consult a colleague, then hand the call over.
 * await speko.callControl.hold(mine!.controlId);
 * await speko.callControl.transfer(mine!.controlId, { to: '+12015559876', mode: 'warm' });
 * ```
 */
export class CallControl {
  constructor(
    private readonly http: HttpClient,
    private readonly configuredBrokerId?: string,
  ) {}

  // --- Calls ---------------------------------------------------------------

  /**
   * Place an outbound PSTN call — Telnyx `POST /calls`.
   *
   * Resolves as soon as the call exists, with the PSTN leg in `initiating` /
   * `ringing`; it does **not** wait for anyone to answer. Watch
   * {@link CallControl.events} (or the browser leg's own connection) for
   * `call.answered`.
   *
   * **Resolves to `{ call, join }`, not to a bare call.** The join credentials
   * for the dialing broker's own browser leg come back with the call because the
   * softphone must already be in the room when the far end answers — fetch them
   * in a second round trip and the first moments of the conversation are
   * silence. `call` carries both legs, so the `controlId` every later command
   * needs is in hand without a read: the `browser` leg is the broker's
   * softphone, the `pstn` leg is the far end.
   *
   * The browser leg belongs to the `brokerId` configured on this SDK instance.
   *
   * @example
   * ```ts
   * const { call, join } = await speko.callControl.dial({ to: '+12015551234' });
   * const mine = call.legs.find((leg) => leg.kind === 'browser')!;
   * // In the browser, connect with the credentials you were just handed:
   * // VoiceConversation.create({ transportToken: join.token, transportUrl: join.url })
   * ```
   */
  dial(params: CallControlDialParams): Promise<CallControlDialResult> {
    return this.http.post<CallControlDialResult>('/v1/voice/calls', {
      ...params,
      brokerId: this.brokerId(),
    });
  }

  /**
   * Mint room credentials for one of **your own** browser legs — how a broker who
   * was rung answers.
   *
   * {@link CallControl.dial} hands you credentials for the leg it created, so
   * this is the inbound counterpart: a `RingOffer` arrives on the presence
   * channel carrying the callee's `controlId`, you `join(controlId)` to get into
   * the room, then {@link CallControl.answer} to connect the audio. Joining
   * first is not optional — answering a leg whose participant is not in the room
   * yet buys you the same silent opening that a post-hoc dial join would.
   *
   * Tokens are minted per join and short-lived by design. A token is a live
   * credential for a room that may carry a customer conversation, so re-join on
   * reconnect instead of caching one; there is no endpoint that hands back a
   * token you already used.
   *
   * Scoped to the configured broker's own legs. A leg belonging to another
   * broker returns `NOT_FOUND` — deliberately indistinguishable from a leg that
   * does not exist, so a `controlId` cannot be probed for existence.
   */
  join(controlId: string): Promise<CallJoinCredentials> {
    return this.http.post<CallJoinCredentials>(
      `/v1/voice/legs/${encodeURIComponent(controlId)}/join`,
      { brokerId: this.brokerId() },
    );
  }

  /** Retrieve one call and every leg on it. */
  get(callId: string): Promise<CallResource> {
    return this.http.get<CallResource>(`/v1/voice/calls/${encodeURIComponent(callId)}`);
  }

  /**
   * List the org's calls, newest first. Filters are AND-ed, and `status` is
   * validated against the contract's `CallStatus` — a value outside it is a
   * `VALIDATION_ERROR`, not a silently ignored filter, so this type is worth
   * respecting rather than casting past.
   */
  list(params: CallControlListParams = {}): Promise<{ calls: CallResource[] }> {
    const query = new URLSearchParams();
    if (params.status) query.set('status', params.status);
    if (params.direction) query.set('direction', params.direction);
    if (params.brokerId) query.set('brokerId', params.brokerId);
    if (params.limit !== undefined) query.set('limit', String(params.limit));
    const suffix = query.toString() ? `?${query}` : '';
    return this.http.get<{ calls: CallResource[] }>(`/v1/voice/calls${suffix}`);
  }

  /**
   * Event history for a call, oldest first — the recorded equivalent of the
   * Telnyx webhook stream, so a flow you drove off webhooks can be reconstructed
   * (or reconciled) after the fact.
   */
  events(callId: string): Promise<{ events: CallEventResource[] }> {
    return this.http.get<{ events: CallEventResource[] }>(
      `/v1/voice/calls/${encodeURIComponent(callId)}/events`,
    );
  }

  // --- Commands ------------------------------------------------------------

  /**
   * Answer a ringing leg — Telnyx `actions/answer`.
   *
   * Only meaningful on an inbound leg that is still `ringing`; answering a leg
   * that is already `active` resolves with `noop: true`.
   */
  answer(controlId: string): Promise<CallCommandResult> {
    return this.command(controlId, 'answer');
  }

  /**
   * Hang a leg up — Telnyx `actions/hangup`.
   *
   * Drops this leg only. The call ends when it runs out of live legs, so
   * hanging up one side of a two-party call ends the call; hanging up one of
   * three legs leaves the other two talking.
   *
   * `reason` is free text and comes back as the leg's `endReason`.
   */
  hangup(controlId: string, params: HangupCommandPayload = {}): Promise<CallCommandResult> {
    return this.command(controlId, 'hangup', params);
  }

  /**
   * Bridge this leg to another — Telnyx `actions/bridge`.
   *
   * Both legs must be live. `bridgeTo` is the *other* leg's `controlId`, not a
   * call id: bridging is leg-to-leg, which is how an AI leg and a broker leg
   * end up in the same conversation. A target that is not a live leg of a call
   * your org owns fails with `BRIDGE_TARGET_INVALID`.
   */
  bridge(controlId: string, params: BridgeCommandPayload): Promise<CallCommandResult> {
    return this.command(controlId, 'bridge', params);
  }

  /**
   * Put a leg on hold — the leg stops hearing and being heard, and its status
   * becomes `held`.
   *
   * **Diverges from Telnyx.** There is no hold primitive on the transport, so
   * hold is synthesized from mute plus unsubscribe. Without a music-on-hold
   * source configured the held party hears **silence**, not hold music — worth
   * saying out loud in your UI, because callers read silence as a dropped call.
   *
   * Hold is a distinct state from {@link CallControl.mute}: a muted leg still
   * hears the call, a held one does not.
   */
  hold(controlId: string): Promise<CallCommandResult> {
    return this.command(controlId, 'hold');
  }

  /** Take a leg off hold, restoring audio in both directions. */
  unhold(controlId: string): Promise<CallCommandResult> {
    return this.command(controlId, 'unhold');
  }

  /**
   * Stop publishing this leg's audio to the call. The leg keeps hearing
   * everyone else — for "they can't hear me but I can hear them", which is what
   * a softphone mute button means. To silence the far end instead, use
   * {@link CallControl.hold}.
   */
  mute(controlId: string): Promise<CallCommandResult> {
    return this.command(controlId, 'mute');
  }

  /** Resume publishing this leg's audio. */
  unmute(controlId: string): Promise<CallCommandResult> {
    return this.command(controlId, 'unmute');
  }

  /**
   * Send DTMF digits out of this leg — Telnyx `actions/send_dtmf`.
   *
   * Accepts `0-9`, `*`, `#`, `,`, and `w` for a pause, up to 64 characters;
   * anything else is rejected with `VALIDATION_ERROR`. Pauses matter when
   * you're driving an IVR that swallows digits sent too early — `"w1w2"` beats
   * `"12"` on most menus.
   *
   * **Address it to the `pstn` leg**, the leg the tones are *for* — any other leg
   * kind fails with `UNSUPPORTED_COMMAND`, since DTMF is only meaningful towards
   * a phone. That the server relays the tones out through an in-room browser leg
   * (only a participant inside the room can publish SIP DTMF) is an
   * implementation detail; it does not change which `controlId` you name.
   */
  dtmf(controlId: string, params: DtmfCommandPayload): Promise<CallCommandResult> {
    return this.command(controlId, 'dtmf', params);
  }

  /**
   * Transfer a leg elsewhere — Telnyx `actions/transfer`.
   *
   * `to` is an E.164 number for a PSTN transfer, or the `controlId` of a broker
   * leg for an internal one.
   *
   * `mode: 'blind'` hands the call off and drops this leg immediately.
   * `mode: 'warm'` moves this leg into a fresh consultation room and dials the
   * destination into it, so the two humans can talk before the handoff
   * completes. Complete it by {@link CallControl.bridge}-ing the consultation
   * leg back into the original call.
   *
   * **The far end is left alone in the original room, not held.** They hear
   * silence because nobody else is in there — but their leg stays `active` with
   * `onHold: false`, and no `call.hold` event fires, so a UI that renders "on
   * hold" from `leg.onHold` will show them as live. Call
   * {@link CallControl.hold} on that leg yourself before transferring if you
   * want the state to say what the caller is experiencing.
   *
   * Resolves once the transfer is *initiated*, and the two modes then report
   * differently — do not wait on the wrong event:
   *
   * - `blind` emits `call.transfer.completed` once the carrier owns the leg (or
   *   `call.transfer.failed` if the REFER was rejected).
   * - `warm` emits `call.transfer.initiated` only. There is no
   *   `call.transfer.completed` for it, because *you* complete it: bridge the
   *   consultation leg back into the original call, which emits `call.bridged`.
   *   `call.transfer.failed` still fires if setting the consultation up failed.
   */
  transfer(controlId: string, params: TransferCommandPayload): Promise<CallCommandResult> {
    return this.command(controlId, 'transfer', params);
  }

  // --- Broker presence -----------------------------------------------------

  /**
   * Come online: mark the configured broker `available` so inbound calls can
   * be routed to them.
   *
   * **Not a SIP registration** despite the name — there is no registrar here,
   * and no endpoint to bind. This flips a flag; what actually makes a browser
   * reachable is holding the connection minted by
   * {@link CallControl.presenceToken} open and calling
   * {@link CallControl.heartbeat} on a timer.
   *
   * Equivalent to `setStatus('available')`.
   *
   * Requires `brokerId` on the SDK instance.
   */
  register(): Promise<BrokerPresenceResource> {
    return this.setStatus('available');
  }

  /**
   * Refresh the broker's heartbeat. Presence goes stale after
   * `PRESENCE_STALE_AFTER_MS`, and a stale broker is treated as offline for
   * routing purposes whatever their stored status says — a crashed tab must not
   * black-hole calls. Call this on an interval comfortably inside that window;
   * a third of it is a good default.
   *
   * Refreshes the broker configured on this SDK instance.
   */
  heartbeat(): Promise<BrokerPresenceResource> {
    return this.http.post<BrokerPresenceResource>('/v1/voice/presence/heartbeat', {
      brokerId: this.brokerId(),
    });
  }

  /**
   * Set the broker's availability. `busy` and `away` both keep the heartbeat
   * alive while diverting inbound elsewhere; `offline` takes them out of
   * routing entirely.
   *
   * Always sets the broker configured on this SDK instance.
   */
  setStatus(status: BrokerPresenceStatus): Promise<BrokerPresenceResource> {
    return this.http.put<BrokerPresenceResource>('/v1/voice/presence', {
      status,
      brokerId: this.brokerId(),
    });
  }

  /**
   * Mint the credentials a browser needs to hold its presence connection open
   * and be rung. Hand `token` and `url` to `@spekoai/client`.
   *
   * A live credential with a real expiry — mint it when the client connects,
   * re-mint on reconnect, don't stockpile it. A broker with no presence
   * connection open cannot be rung even while `available`: inbound to an
   * unreachable broker fails with `NO_BROKER_AVAILABLE`.
   *
   * What arrives on that connection is a {@link PresenceMessage} — the ring
   * offers and live call events the softphone reacts to.
   *
   * The room minted belongs to the broker configured on this SDK instance.
   */
  presenceToken(): Promise<CallJoinCredentials> {
    return this.http.post<CallJoinCredentials>('/v1/voice/presence/token', {
      brokerId: this.brokerId(),
    });
  }

  private brokerId(): string {
    if (this.configuredBrokerId) return this.configuredBrokerId;
    throw new Error(
      'Speko: brokerId is required for human-calling presence, dial, and join methods; pass it to new Speko({ apiKey, brokerId })',
    );
  }

  /**
   * Every command is one POST to the leg's action endpoint, and every one of
   * them resolves to the leg's post-command state — so a client never has to
   * re-read to find out what it just did.
   */
  private command(
    controlId: string,
    command: CallCommand,
    payload: CallCommandPayload = {},
  ): Promise<CallCommandResult> {
    return this.http.post<CallCommandResult>(
      `/v1/voice/legs/${encodeURIComponent(controlId)}/actions/${command}`,
      payload,
    );
  }
}
