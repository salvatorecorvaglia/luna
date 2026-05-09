import { IPC } from '@shared/constants';
import log from '../lib/logger';
import { registerHandler } from '../lib/ipc-handler';

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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data: any[] = [`[Renderer] ${message}`];
      if (context) data.push(context);

      switch (level) {
        case 'info':
          log.info(...data);
          break;
        case 'warn':
          log.warn(...data);
          break;
        case 'error':
          log.error(...data);
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
