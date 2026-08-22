import { IPC } from '@shared/constants';
import { registerHandler } from '../lib/ipc-handler';
import log from '../lib/logger';
import { SlidingWindowLimiter } from '../lib/sliding-window-limiter';

// Unlike every other high-frequency/user-influenced channel (credentials,
// SSH/S3 connect, presign), this one had no rate limit beyond the global 4
// MiB per-call payload ceiling — a chatty or compromised renderer could burn
// disk before the 10 MB log-rotation cap kicked in. The window is generous
// since normal debug/info logging can legitimately burst.
const logMessageLimiter = new SlidingWindowLimiter(300, 10_000, 'Renderer log');

export function registerLogHandlers(): void {
  registerHandler(
    IPC.LOG_MESSAGE,
    (
      _event,
      {
        level,
        message,
        context,
      }: {
        level: 'info' | 'warn' | 'error' | 'debug';
        message: string;
        context?: Record<string, unknown>;
      },
    ) => {
      logMessageLimiter.check();
      const data: unknown[] = [`[Renderer] ${message}`];
      if (context) data.push(context);

      switch (level) {
        case 'info':
          log.info(...data);
          break;
        case 'warn':
          log.warn(...data);
          break;
        case 'error':
          data[0] = `[Renderer Error] ${message}`;
          log.warn(...data);
          break;
        case 'debug':
          log.debug(...data);
          break;
        default:
          log.info(...data);
          break;
      }
    },
  );
}
