import { ipcMain } from 'electron';
import log from './logger';
import { LunarError } from '@shared/errors';

/**
 * Wraps an IPC handler to provide centralized error handling and logging.
 * Any error thrown by the handler will be caught, logged, and re-thrown
 * as a structured object that the renderer can recognize.
 */
export function registerHandler(
  channel: string,
  handler: (event: Electron.IpcMainInvokeEvent, ...args: unknown[]) => Promise<unknown> | unknown,
): void {
  ipcMain.handle(channel, async (event, ...args) => {
    try {
      const result = await handler(event, ...args);
      return result;
    } catch (error) {
      const lunarError = LunarError.fromUnknown(error);

      log.error(`[IPC Handler Error] Channel: ${channel}`, {
        code: lunarError.code,
        message: lunarError.message,
        metadata: lunarError.metadata,
        stack: lunarError.stack,
      });

      // We throw a plain object as a stringified JSON so the renderer's unwrapIpcError can handle it.
      // Electron's default error serialization often loses custom properties.
      throw new Error(JSON.stringify(lunarError.toObject()), { cause: error });
    }
  });
}
