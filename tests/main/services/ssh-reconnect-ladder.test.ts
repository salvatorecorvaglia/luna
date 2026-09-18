import { IPC } from '@shared/constants';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getSetting } from '../../../src/main/services/database';
import { emitToRenderer } from '../../../src/main/services/emit';
import { sshManager } from '../../../src/main/services/ssh-manager';

/**
 * The reconnect ladder, end to end.
 *
 * The existing ssh-manager tests drive attemptReconnect() directly with a
 * pre-seeded attempt counter, so they verify the give-up branch in isolation
 * and never exercise the chain that leads to it: attempt 1 fails -> attempt 2
 * is scheduled. That chain was broken. Every failure path in connect()
 * `sessions.delete(sessionId)`s, and the retry logic read its bookkeeping back
 * out of the session map afterwards, so it found nothing and stopped — one
 * attempt, no give-up error, ssh.maxReconnectAttempts dead for any value > 1.
 *
 * These tests model that faithfully: the connect() stub deletes the session
 * entry on failure, exactly as the real failure paths do. A stub that left the
 * entry in place would pass against the broken implementation.
 */

vi.mock('../../../src/main/services/database', () => ({
  getDatabase: vi.fn(() => ({
    prepare: vi.fn(() => ({ get: vi.fn(), run: vi.fn(), all: vi.fn(() => []) })),
  })),
  getSetting: vi.fn((_key: string, def: unknown) => def),
}));

vi.mock('../../../src/main/services/emit', () => ({ emitToRenderer: vi.fn() }));

vi.mock('../../../src/main/lib/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

type Reach = {
  sessions: Map<string, Record<string, unknown>>;
  /** Ladder bookkeeping; outlives `sessions` by design, so tests must reset it. */
  reconnects: Map<string, { timer: ReturnType<typeof setTimeout> | null; attempts: number }>;
  handleDisconnect(id: string): void;
  connect(id: string, connectionId: string, cols?: number, rows?: number): Promise<unknown>;
};

/**
 * Reset both maps. A test that leaves a ladder mid-flight leaves a spent
 * attempt budget and a pending timer behind, which would otherwise make the
 * next test start with part of its budget already consumed.
 */
function resetState(): void {
  for (const state of reach().reconnects.values()) {
    if (state.timer) clearTimeout(state.timer);
  }
  reach().reconnects.clear();
  reach().sessions.clear();
}

const SESSION_ID = 'ladder-session';

function reach(): Reach {
  return sshManager as unknown as Reach;
}

function seedConnectedSession(): Record<string, unknown> {
  const session = {
    id: SESSION_ID,
    connectionId: 'conn-1',
    client: { removeAllListeners: vi.fn(), destroy: vi.fn(), end: vi.fn() },
    shell: undefined,
    status: 'connected',
    cols: 120,
    rows: 40,
    reconnectAttempts: 0,
    reconnectTimer: null,
    reconnecting: false,
    reconnectGen: 0,
  };
  reach().sessions.set(SESSION_ID, session);
  return session;
}

/**
 * Replace connect() with a stub that models both halves of its contract:
 *
 *  - on failure it deletes the session entry, as every real failure path does
 *    (ssh-manager.ts onError/onClose/timeout). A stub that left the entry in
 *    place would pass against the broken implementation.
 *  - on success it clears the attempt budget, as the real onReady does, so the
 *    "next outage gets a full budget" assertion means something.
 *
 * `failNext(n)` arms the next n calls to fail, so one stub can drive several
 * consecutive outages.
 */
function stubConnect(): {
  calls: () => number;
  failNext: (n: number) => void;
  restore: () => void;
} {
  const original = reach().connect.bind(sshManager);
  let calls = 0;
  let remainingFailures = 0;

  const stub = vi.fn(async (id: string) => {
    calls += 1;
    if (remainingFailures > 0) {
      remainingFailures -= 1;
      reach().sessions.delete(id);
      return { success: false, error: 'stubbed failure' };
    }
    seedConnectedSession();
    const state = reach().reconnects.get(id);
    if (state) state.attempts = 0;
    return { success: true };
  });

  (sshManager as unknown as { connect: unknown }).connect = stub;
  return {
    calls: () => calls,
    failNext: (n: number) => {
      remainingFailures = n;
    },
    restore: () => {
      (sshManager as unknown as { connect: unknown }).connect = original;
    },
  };
}

let restoreConnect: (() => void) | null = null;

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(emitToRenderer).mockClear();
  vi.mocked(getSetting).mockImplementation((key: string, def: unknown) => {
    if (key === 'ssh.autoReconnect') return true as never;
    if (key === 'ssh.maxReconnectAttempts') return 3 as never;
    return def as never;
  });
  resetState();
});

afterEach(() => {
  restoreConnect?.();
  restoreConnect = null;
  resetState();
  vi.useRealTimers();
});

describe('reconnect ladder', () => {
  it('keeps retrying after a failed attempt, up to maxReconnectAttempts', async () => {
    const stub = stubConnect();
    stub.failNext(99); // never succeeds
    restoreConnect = stub.restore;
    seedConnectedSession();

    reach().handleDisconnect(SESSION_ID);

    // Drain the whole ladder. Each attempt schedules the next from inside an
    // async timer body, so time has to advance with the microtask queue.
    for (let i = 0; i < 10; i++) {
      await vi.advanceTimersByTimeAsync(60_000);
    }

    expect(stub.calls()).toBe(3);
  });

  it('emits the give-up error and drops the session once the budget is spent', async () => {
    const stub = stubConnect();
    stub.failNext(99);
    restoreConnect = stub.restore;
    seedConnectedSession();

    reach().handleDisconnect(SESSION_ID);
    for (let i = 0; i < 10; i++) {
      await vi.advanceTimersByTimeAsync(60_000);
    }

    const errors = vi
      .mocked(emitToRenderer)
      .mock.calls.filter(([channel]) => channel === IPC.SSH_ON_ERROR)
      .map(([, payload]) => (payload as { error: string }).error);

    expect(errors.some((e) => e.includes('Reconnection failed after 3 attempts'))).toBe(true);
    expect(reach().sessions.has(SESSION_ID)).toBe(false);
  });

  it('backs off exponentially between attempts rather than retrying immediately', async () => {
    const stub = stubConnect();
    stub.failNext(99);
    restoreConnect = stub.restore;
    seedConnectedSession();

    reach().handleDisconnect(SESSION_ID);

    // Attempt 1 is scheduled at the 1s base delay.
    await vi.advanceTimersByTimeAsync(999);
    expect(stub.calls()).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(stub.calls()).toBe(1);

    // Attempt 2 waits ~2s, not another 1s — the ladder must actually double.
    await vi.advanceTimersByTimeAsync(1_000);
    expect(stub.calls()).toBe(1);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(stub.calls()).toBe(2);
  });

  it('stops the ladder and resets the budget once a reconnect succeeds', async () => {
    const stub = stubConnect();
    restoreConnect = stub.restore;
    seedConnectedSession();

    // First outage: one failure, then a success on the second attempt.
    stub.failNext(1);
    reach().handleDisconnect(SESSION_ID);
    for (let i = 0; i < 10; i++) {
      await vi.advanceTimersByTimeAsync(60_000);
    }

    expect(stub.calls()).toBe(2);
    expect(reach().sessions.has(SESSION_ID)).toBe(true);
    // And the ladder is genuinely stopped, not merely quiet for a moment.
    await vi.advanceTimersByTimeAsync(300_000);
    expect(stub.calls()).toBe(2);

    // Second outage must get a full budget of 3 again, not the leftover from
    // the first. Before the fix the counter was carried on the session and this
    // is the half that silently drifted.
    stub.failNext(99);
    reach().handleDisconnect(SESSION_ID);
    for (let i = 0; i < 10; i++) {
      await vi.advanceTimersByTimeAsync(60_000);
    }
    expect(stub.calls()).toBe(2 + 3);
  });
});
