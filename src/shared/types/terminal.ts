export type SessionStatus = 'connecting' | 'connected' | 'disconnected' | 'error' | 'reconnecting';

export interface SshConnectParams {
  connectionId: string;
  sessionId: string;
  cols?: number;
  rows?: number;
}

export interface SshConnectResult {
  success: boolean;
  error?: string;
}

export interface SshDataEvent {
  sessionId: string;
  data: string;
}

export interface SshCloseEvent {
  sessionId: string;
}

export interface SshErrorEvent {
  sessionId: string;
  error: string;
}

export interface SshStatusEvent {
  sessionId: string;
  status: SessionStatus;
}

export interface SshHostKeyChangeEvent {
  sessionId: string;
  connectionId: string;
  host: string;
  port: number;
  /** Existing trusted fingerprint stored in known_hosts. */
  storedFingerprint: string;
  /** New fingerprint presented by the server. */
  newFingerprint: string;
  algorithm: string;
  /** True when the host has never been seen before (TOFU prompt vs. change warning). */
  isFirst: boolean;
}

export interface SshResizeParams {
  sessionId: string;
  cols: number;
  rows: number;
}

/**
 * Output flow control: the renderer reports how many characters of a
 * session's output xterm has parsed. `reset` marks a freshly attached
 * terminal — see OutputFlow.reset in main/lib/output-flow.ts.
 */
export interface TerminalAckParams {
  sessionId: string;
  chars: number;
  reset?: boolean;
}

export interface SshSendDataParams {
  sessionId: string;
  data: string;
}

export type SplitDirection = 'horizontal' | 'vertical';

export type PaneNode =
  | { type: 'terminal'; sessionId: string }
  | {
      type: 'split';
      /**
       * Stable identity for this split. Splits used to be addressed by the
       * first leaf of their left child, which an outer split and the split
       * nested on its left side share — dragging the inner divider moved the
       * outer one.
       */
      id: string;
      direction: SplitDirection;
      children: [PaneNode, PaneNode];
      ratio: number;
    };

export type TerminalThemeName =
  | 'dracula'
  | 'nord'
  | 'tokyo-night'
  | 'gruvbox'
  | 'one-dark'
  | 'monokai';
