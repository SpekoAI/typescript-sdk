/**
 * Minimal ambient declarations for the WebSocket global. The SDK targets
 * browsers primarily (audio capture needs a MediaStream), but lib.dom.d.ts
 * conflicts with our fetch-with-Uint8Array body calls in http.ts. Declaring
 * just the subset we need sidesteps the conflict.
 */

interface WebSocketMessageEvent<T = unknown> {
  readonly data: T;
}

interface WebSocketCloseEvent {
  readonly code: number;
  readonly reason: string;
}

interface WebSocket {
  readonly readyState: 0 | 1 | 2 | 3;
  binaryType: 'arraybuffer' | 'blob';
  send(data: string | ArrayBufferLike | ArrayBufferView | Blob): void;
  close(code?: number, reason?: string): void;
  addEventListener(
    type: 'message',
    listener: (evt: WebSocketMessageEvent) => void,
  ): void;
  addEventListener(
    type: 'close',
    listener: (evt: WebSocketCloseEvent) => void,
  ): void;
  addEventListener(type: 'open' | 'error', listener: () => void): void;
}

interface WebSocketConstructor {
  new (url: string, protocols?: string | string[]): WebSocket;
}

declare const WebSocket: WebSocketConstructor;
