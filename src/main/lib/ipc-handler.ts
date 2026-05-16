import { ipcMain } from 'electron';
import log from './logger';
import { ErrorCode, LunarError } from '@shared/errors';

/**
 * Hard cap on the serialized size of a single IPC request. The renderer
 * sends typed messages whose payload sizes are well under a kilobyte for
 * all real flows (transfer enqueue, connection CRUD, settings updates,
 * shell input is already capped to 64 KiB by ssh.ipc). A 4 MiB ceiling is
 * orders of magnitude above legitimate traffic but blocks a compromised
 * renderer from OOMing main by streaming hundreds of MB through a single
 * invoke. The cost of the size check itself scales linearly with the
 * payload (JSON.stringify walk), so the limit can't be much higher
 * without re-introducing the same DoS vector via the check.
 */
const MAX_IPC_PAYLOAD_BYTES = 4 * 1024 * 1024;

function payloadByteSize(args: unknown[]): number {
  try {
    return Buffer.byteLength(JSON.stringify(args), 'utf-8');
  } catch {
    // Cyclic / un-serializable values are tiny by construction (we'd hit a
    // throw, not an OOM) — fall back to "0" so the size check passes and
    // the actual handler can surface the real shape error.
    return 0;
  }
}

/**
 * Wraps an IPC handler to provide centralized error handling and logging.
 * Any error thrown by the handler will be caught, logged, and re-thrown
 * as a structured object that the renderer can recognize.
 */
export function registerHandler(
  channel: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handler: (event: Electron.IpcMainInvokeEvent, ...args: any[]) => Promise<unknown> | unknown,
): void {
  ipcMain.handle(channel, async (event, ...args) => {
    try {
      const size = payloadByteSize(args);
      if (size > MAX_IPC_PAYLOAD_BYTES) {
        throw new LunarError(
          `IPC payload too large on channel ${channel}: ${size} bytes (max ${MAX_IPC_PAYLOAD_BYTES}).`,
          ErrorCode.VALIDATION_ERROR,
        );
      }
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
