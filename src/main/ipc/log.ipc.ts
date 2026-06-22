import { IPC } from '@shared/constants';
import { registerHandler } from '../lib/ipc-handler';
import log from '../lib/logger';

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
