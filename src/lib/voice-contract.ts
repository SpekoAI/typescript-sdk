/**
 * Programmable voice — the wire contract.
 *
 * A hand-kept mirror of the platform's own `voice-contract.ts`. The SDK ships
 * standalone to npm, so these shapes are re-declared here rather than imported
 * across the monorepo; when the platform contract moves, this file moves with
 * it.
 *
 * Every wire shape here is member-for-member identical to the platform's. Two
 * things there are deliberately not mirrored, because they exist to serve the
 * server and would only be dead surface on a client: the `as const` arrays the
 * server derives its zod enums from (`CALL_STATUSES` and friends — the unions
 * below have exactly those members), and `isBrokerReachable`, whose verdict
 * already arrives precomputed as {@link BrokerPresenceResource.reachable}.
 * `CALL_COMMANDS` and `CALL_EVENTS` *are* mirrored as arrays, because a client
 * does enumerate those.
 *
 * The model is Telnyx Call Control's, deliberately: every leg of a call carries
 * an opaque `controlId`, and commands are addressed to that handle rather than
 * to a room or a participant identity. A migrating integration maps one command
 * to one command. What is underneath (LiveKit) never leaks into the API.
 *
 * Two divergences from Telnyx are worth knowing before you port anything, both
 * forced by the transport:
 *
 *  - `hold` is synthesized (mute + unsubscribe); there is no LiveKit hold
 *    primitive. Without a music-on-hold source configured, **hold is silent** —
 *    the far end hears nothing at all, not hold music.
 *  - There is **no SIP registrar**. A third-party SIP endpoint (a desk phone, a
 *    softphone, another PBX) cannot register against Speko and be rung. Humans
 *    join from the browser; `browser` and `pstn` are the only human-reachable
 *    leg kinds.
 */

// --- Resources -------------------------------------------------------------

/** Which way a call or leg was set up. `internal` is broker-to-broker. */
export type CallDirection = 'inbound' | 'outbound' | 'internal';

/**
 * Lifecycle of a call. Terminal states distinguish the three ways a call can
 * die unanswered, so a missed-call list can tell them apart: `declined` (a
 * human said no), `missed` (the ring timed out), `cancelled` (the originator
 * hung up first).
 */
export type CallStatus =
  | 'initiating'
  | 'ringing'
  | 'active'
  | 'ended'
  | 'declined'
  | 'missed'
  | 'cancelled'
  | 'failed';

/** Per-leg lifecycle. `held` is a state, not a flag — see {@link CallLegResource.onHold}. */
export type CallLegStatus = 'initiating' | 'ringing' | 'active' | 'held' | 'ended' | 'failed';

/**
 * What is on the far end of a leg. `browser` is a human on the WebRTC
 * softphone, `pstn` a phone reached over SIP, `agent` a Speko AI worker — which
 * is what makes escalating an AI call to a human an ordinary bridge rather than
 * a special case.
 */
export type CallLegKind = 'browser' | 'pstn' | 'agent';

/** Valid org-defined broker ids accepted by the human-calling API. */
export const BROKER_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

/** One party on a call. The unit every command is addressed to. */
export interface CallLegResource {
  readonly id: string;
  /** The command handle. Telnyx `call_control_id` equivalent. */
  readonly controlId: string;
  readonly callId: string;
  readonly kind: CallLegKind;
  readonly direction: CallDirection;
  readonly status: CallLegStatus;
  /** Org-defined broker identity when `kind === 'browser'`; null otherwise. */
  readonly brokerId: string | null;
  /** E.164 of the far end, when `kind === 'pstn'`. */
  readonly phoneNumber: string | null;
  readonly muted: boolean;
  readonly onHold: boolean;
  readonly answeredAt: string | null;
  readonly endedAt: string | null;
  readonly endReason: string | null;
  readonly createdAt: string;
}

/** A call and every leg on it. */
export interface CallResource {
  readonly id: string;
  readonly direction: CallDirection;
  readonly status: CallStatus;
  readonly answeredAt: string | null;
  readonly endedAt: string | null;
  readonly endReason: string | null;
  readonly legs: readonly CallLegResource[];
  readonly createdAt: string;
}

/**
 * What a browser client needs to actually join a room — a live credential, so
 * mint it at the moment you connect and never stockpile it.
 *
 * Returned by {@link CallControl.dial} (alongside the call, because the dialing
 * broker must already be in the room when the far end answers) and by
 * {@link CallControl.join} (for a leg you were rung on). Either way it is minted
 * per join, short-lived, and issued only to the leg's own owner: a token is a
 * live credential for a room that may carry a customer conversation.
 *
 * Hand `token` and `url` to `@spekoai/client`, or to `livekit-client` directly.
 */
export interface CallJoinCredentials {
  readonly token: string;
  readonly url: string;
  readonly identity: string;
  readonly roomName: string;
  readonly expiresAt: string;
}

// --- Commands --------------------------------------------------------------

/**
 * Every command a live leg accepts. Names mirror Telnyx Call Control verbs so a
 * migrating integration can be mapped mechanically.
 */
export const CALL_COMMANDS = [
  'answer',
  'hangup',
  'bridge',
  'hold',
  'unhold',
  'mute',
  'unmute',
  'dtmf',
  'transfer',
] as const;

export type CallCommand = (typeof CALL_COMMANDS)[number];

/** Digits accepted in a DTMF payload: 0-9, `*`, `#`, and `w` for a pause. */
export const DTMF_PATTERN = /^[0-9*#w,]{1,64}$/;

export interface BridgeCommandPayload {
  /** `controlId` of the leg to bridge this one to. */
  readonly bridgeTo: string;
}

export interface DtmfCommandPayload {
  /** Matches {@link DTMF_PATTERN}: 0-9, `*`, `#`, `,`, and `w` for a pause. */
  readonly digits: string;
}

export interface TransferCommandPayload {
  /**
   * Where to send the leg — an E.164 number for a PSTN transfer, or the
   * `controlId` of a broker leg for an internal one.
   */
  readonly to: string;
  /**
   * `blind` hands the call off and drops this leg immediately. `warm` parks the
   * far end and opens a consultation room first, so the two humans can talk
   * before the handoff completes.
   */
  readonly mode: 'blind' | 'warm';
}

export interface HangupCommandPayload {
  /** Free-text, surfaced as the leg's `endReason`. */
  readonly reason?: string;
}

export type CallCommandPayload =
  | BridgeCommandPayload
  | DtmfCommandPayload
  | TransferCommandPayload
  | HangupCommandPayload
  | Record<string, never>;

/**
 * Commands are idempotent by intent, not by replay: issuing `mute` twice is a
 * no-op, but the second call still returns the current leg. Every command
 * resolves to the leg's post-command state so a client never has to re-read.
 */
export interface CallCommandResult {
  readonly leg: CallLegResource;
  /** Present when the command changed nothing, e.g. muting a muted leg. */
  readonly noop?: boolean;
}

// --- Events ----------------------------------------------------------------

/**
 * The event stream. Assembled from LiveKit room webhooks plus SIP call status —
 * which is coarser than a carrier's own signalling, so a few Telnyx events have
 * no faithful equivalent and are deliberately absent rather than approximated:
 * there is no early-media event, and no distinction between a 486 Busy and a
 * generic rejection.
 */
export const CALL_EVENTS = [
  'call.initiated',
  'call.ringing',
  'call.answered',
  'call.bridged',
  'call.hold',
  'call.unhold',
  'call.mute',
  'call.unmute',
  'call.dtmf.received',
  'call.dtmf.sent',
  'call.transfer.initiated',
  'call.transfer.completed',
  'call.transfer.failed',
  'call.leg.hangup',
  'call.hangup',
] as const;

export type CallEventType = (typeof CALL_EVENTS)[number];

export interface CallEventResource {
  readonly id: string;
  readonly type: CallEventType;
  readonly callId: string;
  /** Null for call-scoped events that belong to no single leg. */
  readonly controlId: string | null;
  readonly payload: Record<string, unknown>;
  readonly occurredAt: string;
}

// --- Presence --------------------------------------------------------------

export type BrokerPresenceStatus = 'available' | 'busy' | 'away' | 'offline';

/**
 * How long a broker's heartbeat stays valid. Past this, inbound routing treats
 * them as offline whatever their stored status says — a crashed tab must not
 * black-hole calls. Heartbeat comfortably inside this window (a third of it is
 * a good default).
 */
export const PRESENCE_STALE_AFTER_MS = 90_000;

export interface BrokerPresenceResource {
  readonly brokerId: string;
  readonly status: BrokerPresenceStatus;
  readonly lastSeenAt: string;
  /** False once the heartbeat has gone stale, regardless of `status`. */
  readonly reachable: boolean;
}

// --- Presence wire messages ------------------------------------------------

/**
 * What the server publishes into a broker's presence room — the ring channel's
 * wire format, and the reason a browser softphone needs more than the HTTP
 * surface. Read these off the LiveKit data channel you opened with
 * {@link CallControl.presenceToken}; there is no HTTP equivalent, because a ring
 * has to arrive unsolicited.
 *
 * Discriminate on `type`. New members can appear without a major version, so
 * treat an unrecognized `type` as "ignore", never as an error.
 *
 * @example
 * ```ts
 * import type { PresenceMessage } from '@spekoai/sdk';
 *
 * room.on('dataReceived', async (payload) => {
 *   const message = JSON.parse(new TextDecoder().decode(payload)) as PresenceMessage;
 *   switch (message.type) {
 *     case 'incoming_call': {
 *       // Join the room first, then answer — see CallControl.join.
 *       const credentials = await speko.callControl.join(message.controlId);
 *       await connectTo(credentials);
 *       await speko.callControl.answer(message.controlId);
 *       break;
 *     }
 *     case 'call_event':
 *       // Also how a ring is cancelled: a caller who gives up before you answer
 *       // ends your ringing leg, which arrives here as `call.leg.hangup`.
 *       if (message.event.type === 'call.leg.hangup') dismissIncomingCallPrompt(message.event.callId);
 *       applyToUi(message.event);
 *       break;
 *   }
 * });
 * ```
 */
export type PresenceMessage = RingOffer | CallEventNotice;

/** Published to the callee when a call starts ringing them. */
export interface RingOffer {
  readonly type: 'incoming_call';
  readonly callId: string;
  /**
   * The callee's OWN browser leg — the handle {@link CallControl.answer},
   * {@link CallControl.join} and {@link CallControl.hangup} are addressed to.
   * A ring without it is unanswerable, so treat its absence as a malformed
   * packet rather than rendering an answer button that cannot work.
   */
  readonly controlId: string;
  readonly roomName: string;
  readonly caller: {
    /** Org-defined broker id on an internal call; null when the caller is a phone. */
    readonly brokerId: string | null;
    readonly name: string | null;
    /** E.164 of the calling phone, when the call arrived over the PSTN. */
    readonly phoneNumber: string | null;
  };
}

/**
 * A call-lifecycle event mirrored into the broker's presence room so the
 * softphone reflects state changes it did not initiate — the far end hanging up,
 * a supervisor bridging in, a transfer completing.
 *
 * The event is carried verbatim as a {@link CallEventResource}, the same shape
 * {@link CallControl.events} returns, so one parser serves both the live feed
 * and the history. History is authoritative: a dropped packet costs freshness,
 * never a record.
 */
export interface CallEventNotice {
  readonly type: 'call_event';
  readonly event: CallEventResource;
}

// --- Error codes -----------------------------------------------------------

/**
 * Stable codes so you can branch without string-matching prose. They arrive on
 * `SpekoApiError.code`.
 *
 * @example
 * ```ts
 * import { SpekoApiError, VOICE_ERROR_CODES } from '@spekoai/sdk';
 *
 * try {
 *   await speko.callControl.hold(controlId);
 * } catch (err) {
 *   if (err instanceof SpekoApiError && err.code === VOICE_ERROR_CODES.legNotLive) {
 *     // The leg hung up between render and click — drop the control, don't retry.
 *   }
 * }
 * ```
 */
export const VOICE_ERROR_CODES = {
  disabled: 'HUMAN_CALLING_DISABLED',
  unconfigured: 'HUMAN_CALLING_UNCONFIGURED',
  notFound: 'NOT_FOUND',
  validation: 'VALIDATION_ERROR',
  legNotLive: 'LEG_NOT_LIVE',
  callNotLive: 'CALL_NOT_LIVE',
  unsupportedCommand: 'UNSUPPORTED_COMMAND',
  bridgeTargetInvalid: 'BRIDGE_TARGET_INVALID',
  noBrokerAvailable: 'NO_BROKER_AVAILABLE',
} as const;

export type VoiceErrorCode = (typeof VOICE_ERROR_CODES)[keyof typeof VOICE_ERROR_CODES];
