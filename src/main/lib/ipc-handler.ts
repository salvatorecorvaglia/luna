import { ErrorCode, LunaError } from '@shared/errors';
import type { IpcChannel, IpcRequest, IpcResponse } from '@shared/types/ipc';
import { ipcMain } from 'electron';
import log from './logger';

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

/**
 * Returns the serialized byte size, or `null` if the args are not
 * JSON-serializable (cyclic reference, BigInt, etc.). The caller treats
 * `null` as a hard reject: a renderer that sends un-serializable input is
 * either buggy or hostile, and silently passing it through would let a
 * crafted cyclic object bypass the size cap entirely.
 */
function payloadByteSize(args: unknown[]): number | null {
  // Fast path for the shapes that dominate call volume. `ssh:send-data` and
  // `local-terminal:send-data` fire on every keystroke, and the generic path
  // below JSON-stringifies the whole argument list just to measure it —
  // a full serialization walk per keypress. A lone string or primitive can be
  // measured directly, and neither can hide a cycle.
  if (args.length === 0) return 2; // "[]"
  if (args.length === 1) {
    const only = args[0];
    if (typeof only === 'string') return Buffer.byteLength(only, 'utf-8');
    if (only === null || typeof only === 'number' || typeof only === 'boolean') {
      return String(only).length;
    }
  }
  try {
    return Buffer.byteLength(JSON.stringify(args), 'utf-8');
  } catch {
    return null;
  }
}

/**
 * Args tuple for a handler. `void` requests are erased (handlers take no
 * request arg); every other request type becomes a single-element tuple so
 * channels with a typed request must declare it in their handler signature.
 */
type HandlerArgs<C extends IpcChannel> = IpcRequest<C> extends void ? [] : [IpcRequest<C>];

type ChannelHandler<C extends IpcChannel> = (
  event: Electron.IpcMainInvokeEvent,
  ...args: HandlerArgs<C>
) => IpcResponse<C> | Promise<IpcResponse<C>>;

/**
 * Wraps an IPC handler to provide centralized error handling and logging.
 * Any error thrown by the handler will be caught, logged, and re-thrown
 * as a structured object that the renderer can recognize.
 *
 * The handler signature is derived from `IpcHandlerMap`, so a wrong-typed
 * request or response is a compile error at the call site rather than a
 * runtime surprise on the renderer.
 */
export function registerHandler<C extends IpcChannel>(
  channel: C,
  handler: ChannelHandler<C>,
): void {
  ipcMain.handle(channel, async (event, ...args) => {
    try {
      const size = payloadByteSize(args);
      if (size === null) {
        throw new LunaError(
          `IPC payload on channel ${channel} is not JSON-serializable (cyclic or unsupported value).`,
          ErrorCode.VALIDATION_ERROR,
        );
      }
      if (size > MAX_IPC_PAYLOAD_BYTES) {
        throw new LunaError(
          `IPC payload too large on channel ${channel}: ${size} bytes (max ${MAX_IPC_PAYLOAD_BYTES}).`,
          ErrorCode.VALIDATION_ERROR,
        );
      }
      // ipcMain.handle forwards args as unknown[]; the channel-typed handler
      // expects HandlerArgs<C>. The cast is safe at the IPC boundary because
      // size + content validation in each handler runs before any args are
      // trusted, and Electron preserves arity from the renderer side.
      const result = await (handler as (...a: unknown[]) => unknown)(event, ...args);
      return result;
    } catch (error) {
      const lunaError = LunaError.fromUnknown(error);

      log.error(`[IPC Handler Error] Channel: ${channel}`, {
        code: lunaError.code,
        message: lunaError.message,
        metadata: lunaError.metadata,
        stack: lunaError.stack,
      });

      // Cross the bridge with code + message only.
      //
      // `toObject()` also carries `stack` and `metadata`. Shipping those to
      // the renderer handed it absolute main-process paths, module layout,
      // and whatever internal detail a handler happened to attach — on every
      // failure, including ones a remote server can provoke. That is exactly
      // the reconnaissance an attacker who has a foothold in the renderer
      // wants, and it undoes the care `emit.ts` takes to redact the event
      // channels. The full record stays in the main-process log above, which
      // is where an operator debugging a failure should be looking anyway.
      throw new Error(JSON.stringify({ code: lunaError.code, message: lunaError.message }), {
        cause: error,
      });
    }
  });
}
