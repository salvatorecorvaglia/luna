import type { CommandSetItem } from '@shared/types/command-set';

export type ItemStatus = 'idle' | 'running' | 'success' | 'failed';

export interface RunnerCallbacks {
  onItemStart: (itemId: string) => void;
  onItemSuccess: (itemId: string) => void;
  onItemFailed: (itemId: string, reason: string) => void;
  onComplete: () => void;
}

/**
 * Runs a list of CommandSetItems in sequence against the given SSH session.
 * For items with `expectedOutput`, listens on ssh:on-data until the output
 * matches or the timeout fires.
 * Returns a cancel function.
 */
export function runCommandSetSequence(
  items: CommandSetItem[],
  sessionId: string,
  callbacks: RunnerCallbacks,
): () => void {
  let cancelled = false;
  let cleanup: (() => void) | null = null;

  (async () => {
    for (const item of items) {
      if (cancelled) break;
      callbacks.onItemStart(item.id);

      window.api.ssh.sendData({ sessionId, data: item.command + '\n' });

      if (item.expectedOutput) {
        const matched = await waitForOutput(
          sessionId,
          item.expectedOutput,
          item.timeoutMs,
          (unsubscribe) => {
            cleanup = unsubscribe;
          },
        );
        cleanup = null;

        if (cancelled) break;

        if (!matched) {
          callbacks.onItemFailed(
            item.id,
            `Expected output not received within ${item.timeoutMs}ms`,
          );
          return; // abort sequence
        }
      } else {
        // No expected output — fixed 300ms delay before next item
        await new Promise<void>((resolve) => {
          const t = setTimeout(resolve, 300);
          cleanup = () => {
            clearTimeout(t);
            resolve();
          };
        });
        cleanup = null;
        if (cancelled) break;
      }

      callbacks.onItemSuccess(item.id);
    }

    if (!cancelled) callbacks.onComplete();
  })();

  return () => {
    cancelled = true;
    cleanup?.();
  };
}

function waitForOutput(
  sessionId: string,
  expected: string,
  timeoutMs: number,
  registerCleanup: (fn: () => void) => void,
): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    let buffer = '';
    let resolved = false;

    let matcher: (s: string) => boolean;
    try {
      const re = new RegExp(expected);
      matcher = (s) => re.test(s);
    } catch {
      matcher = (s) => s.includes(expected);
    }

    const timer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        unsubscribe();
        resolve(false);
      }
    }, timeoutMs);

    const unsubscribe = window.api.ssh.onData((event) => {
      if (event.sessionId !== sessionId || resolved) return;
      buffer += event.data;
      if (matcher(buffer)) {
        resolved = true;
        clearTimeout(timer);
        unsubscribe();
        resolve(true);
      }
    });

    registerCleanup(() => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timer);
        unsubscribe();
        resolve(false);
      }
    });
  });
}
