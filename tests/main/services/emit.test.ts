import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Capture what would have been broadcast: each invocation of webContents.send
// is recorded for inspection. We swap in a per-test fake window list.
const sent: { channel: string; payload: unknown }[] = [];

function makeWindow(destroyed = false): {
  isDestroyed: () => boolean;
  webContents: { send: (channel: string, payload: unknown) => void };
} {
  return {
    isDestroyed: () => destroyed,
    webContents: { send: (channel, payload) => sent.push({ channel, payload }) },
  };
}

const windowsRef: { current: ReturnType<typeof makeWindow>[] } = { current: [] };

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => windowsRef.current },
}));

import { emitToRenderer } from '../../../src/main/services/emit';

beforeEach(() => {
  sent.length = 0;
  windowsRef.current = [makeWindow()];
});

afterEach(() => {
  windowsRef.current = [];
});

describe('emitToRenderer (redaction at the IPC boundary)', () => {
  it('redacts password fields in structured payloads', () => {
    emitToRenderer('ssh:on-error', { sessionId: 'a', error: 'auth failed', password: 'hunter2' });
    expect(sent).toHaveLength(1);
    const payload = sent[0]!.payload as { password: string; error: string; sessionId: string };
    expect(payload.password).toBe('[REDACTED]');
    expect(payload.error).toBe('auth failed');
    expect(payload.sessionId).toBe('a');
  });

  it('redacts password fragments inside error message strings', () => {
    emitToRenderer('ssh:on-error', {
      sessionId: 'x',
      error: 'failed: password=hunter2 retry',
    });
    const payload = sent[0]!.payload as { error: string };
    expect(payload.error).toContain('[REDACTED]');
    expect(payload.error).not.toContain('hunter2');
  });

  it('does NOT redact ssh:on-data — terminal stream must be byte-exact', () => {
    // A user typing `password=hunter2` into a remote shell prompt would have
    // those literal bytes echoed back. Redaction would corrupt the terminal.
    emitToRenderer('ssh:on-data', { sessionId: 'a', data: 'password=hunter2\n' });
    const payload = sent[0]!.payload as { data: string };
    expect(payload.data).toBe('password=hunter2\n');
  });

  it('skips destroyed windows', () => {
    windowsRef.current = [makeWindow(true), makeWindow(false)];
    emitToRenderer('ssh:on-status', { sessionId: 'a', status: 'connected' });
    expect(sent).toHaveLength(1);
  });
});

describe('RAW_CHANNELS allowlist', () => {
  /**
   * Exactly one channel bypasses redaction, and it has to stay that way.
   *
   * `ssh:on-data` carries the raw terminal bytestream: redacting it would
   * corrupt the stream the renderer has to reproduce byte-for-byte (users type
   * passwords at prompts, and the echo suppression is the remote side's job).
   * Every *other* channel carries structured metadata where redaction is both
   * safe and required — a future channel quietly added to the allowlist would
   * start leaking credentials into the renderer with no other signal.
   */
  const KNOWN_RAW_CHANNELS = ['ssh:on-data'];

  it('passes the terminal bytestream through untouched', () => {
    const raw = 'password=hunter2\r\n\x1b[32mok\x1b[0m';
    emitToRenderer('ssh:on-data', { sessionId: 's1', data: raw });
    expect((sent[0]!.payload as { data: string }).data).toBe(raw);
  });

  it.each([
    'ssh:on-error',
    'ssh:on-status',
    'ssh:on-close',
    'ssh:on-host-key-change',
    'transfer:progress',
    'transfer:error',
    'credential:on-tamper',
    'storage:list-truncated',
    'local-terminal:on-data',
  ])('redacts secrets on %s', (channel) => {
    expect(KNOWN_RAW_CHANNELS).not.toContain(channel);
    emitToRenderer(channel, { sessionId: 's1', password: 'hunter2', secret: 'sk-abc' });
    const payload = sent[0]!.payload as Record<string, string>;
    expect(payload.password).toBe('[REDACTED]');
    expect(payload.secret).toBe('[REDACTED]');
  });

  it('redacts a private key embedded in a nested error message', () => {
    emitToRenderer('ssh:on-error', {
      sessionId: 's1',
      detail: {
        message:
          'failed with -----BEGIN OPENSSH PRIVATE KEY-----\nabc123\n-----END OPENSSH PRIVATE KEY-----',
      },
    });
    const payload = sent[0]!.payload as { detail: { message: string } };
    expect(payload.detail.message).not.toContain('abc123');
    expect(payload.detail.message).toContain('[REDACTED]');
  });
});
