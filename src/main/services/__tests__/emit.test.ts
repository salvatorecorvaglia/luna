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

import { emitToRenderer } from '../emit';

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
    const payload = sent[0].payload as { password: string; error: string; sessionId: string };
    expect(payload.password).toBe('[REDACTED]');
    expect(payload.error).toBe('auth failed');
    expect(payload.sessionId).toBe('a');
  });

  it('redacts password fragments inside error message strings', () => {
    emitToRenderer('ssh:on-error', {
      sessionId: 'x',
      error: 'failed: password=hunter2 retry',
    });
    const payload = sent[0].payload as { error: string };
    expect(payload.error).toContain('[REDACTED]');
    expect(payload.error).not.toContain('hunter2');
  });

  it('does NOT redact ssh:on-data — terminal stream must be byte-exact', () => {
    // A user typing `password=hunter2` into a remote shell prompt would have
    // those literal bytes echoed back. Redaction would corrupt the terminal.
    emitToRenderer('ssh:on-data', { sessionId: 'a', data: 'password=hunter2\n' });
    const payload = sent[0].payload as { data: string };
    expect(payload.data).toBe('password=hunter2\n');
  });

  it('skips destroyed windows', () => {
    windowsRef.current = [makeWindow(true), makeWindow(false)];
    emitToRenderer('ssh:on-status', { sessionId: 'a', status: 'connected' });
    expect(sent).toHaveLength(1);
  });
});
