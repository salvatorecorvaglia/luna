import { IPC } from '@shared/constants';
import { sshManager } from '../services/ssh-manager';
import { storageRegistry } from '../services/storage/registry';
import { sftpStorageProvider } from '../services/storage/sftp-storage-provider';
import { getDatabase } from '../services/database';
import { ErrorCode, LunarError } from '@shared/errors';
import { assertBoundedInt, assertNonEmptyString } from '../lib/validate';
import {
  assertValidJumpHost,
  assertValidManualJumpHost,
} from '../lib/jump-host-validate';
import { registerHandler } from '../lib/ipc-handler';

const VALID_AUTH_TYPES = new Set(['password', 'key', 'key+passphrase']);
/** Cap on the size of a single transient secret accepted from the renderer. */
const MAX_SECRET_LEN = 4096;
/**
 * Cap on a single SSH_SEND_DATA payload. xterm typically emits a few bytes
 * per keystroke and chunks pasted blobs; 64 KiB is comfortably above any
 * realistic interactive write while preventing a buggy/compromised renderer
 * from streaming hundreds of MB into the shell write buffer.
 */
const MAX_SSH_SEND_BYTES = 65536;
import type { SshConnectParams, SshResizeParams, SshSendDataParams } from '@shared/types/terminal';
import type { AuthType, ManualJumpHostConfig } from '@shared/types/connection';

export function registerSshHandlers(): void {
  sshManager.onSessionConnect((_sessionId) => {
    // Eagerly registered in SSH_CONNECT instead to avoid races
  });

  sshManager.onSessionDisconnect((sessionId) => {
    // Mark first so any IPC call racing the unregister sees the closing state
    // and fails fast with a clear error instead of receiving a provider whose
    // SSH transport is already half-torn-down.
    storageRegistry.markClosing(sessionId);
    storageRegistry.unregister(sessionId);
  });

  registerHandler(IPC.SSH_CONNECT, async (_event, params: SshConnectParams) => {
    assertNonEmptyString(params.sessionId, 'sessionId');
    assertNonEmptyString(params.connectionId, 'connectionId');

    // Register the storage provider as soon as we start connecting. This ensures
    // that if the renderer (e.g. the SFTP view) tries to list files while the
    // connection is still in progress, the registry won't throw "No storage
    // provider registered". The subsequent list() call will either wait for the
    // connection or fail with a more descriptive SSH error.
    storageRegistry.register(params.sessionId, sftpStorageProvider);

    const result = await sshManager.connect(
      params.sessionId,
      params.connectionId,
      params.cols,
      params.rows,
    );
    return result;
  });

  registerHandler(IPC.SSH_DISCONNECT, (_event, sessionId: string) => {
    assertNonEmptyString(sessionId, 'sessionId');
    // Mark the storage session as closing *before* tearing the SSH transport
    // down so a concurrent storage IPC can't grab the provider during the
    // gap between disconnect start and the unregister fired by the
    // onSessionDisconnect callback.
    storageRegistry.markClosing(sessionId);
    sshManager.disconnect(sessionId);
    // Unregistration happens centrally via onSessionDisconnect
  });

  registerHandler(IPC.SSH_SEND_DATA, (_event, params: SshSendDataParams) => {
    assertNonEmptyString(params.sessionId, 'sessionId');
    if (typeof params.data !== 'string') {
      throw new LunarError('data must be a string', ErrorCode.VALIDATION_ERROR);
    }
    // Bound by UTF-8 byte length, not character count: a 2-byte char would
    // otherwise let a renderer ship 2× the intended payload.
    const byteLength = Buffer.byteLength(params.data, 'utf8');
    if (byteLength > MAX_SSH_SEND_BYTES) {
      throw new LunarError(
        `SSH input exceeds ${MAX_SSH_SEND_BYTES}-byte cap (got ${byteLength})`,
        ErrorCode.VALIDATION_ERROR,
      );
    }
    sshManager.sendData(params.sessionId, params.data);
  });

  registerHandler(
    IPC.SSH_TEST_CONNECTION,
    async (
      _event,
      params: {
        connectionId?: string;
        config?: {
          host: string;
          port: number;
          username: string;
          authType: AuthType;
          privateKeyPath?: string;
          password?: string;
          passphrase?: string;
          jumpHostConnectionId?: string;
          jumpHostConfig?: ManualJumpHostConfig;
        };
      },
    ) => {
      // Never accept transient secrets alongside a saved connectionId —
      // forces the renderer to choose one path explicitly so password material
      // can't be silently injected into a flow that should use stored creds.
      if (params.connectionId && params.config) {
        throw new LunarError(
          'testConnection accepts either connectionId or config, not both',
          ErrorCode.VALIDATION_ERROR,
        );
      }
      if (params.config) {
        const c = params.config;
        assertNonEmptyString(c.host, 'host');
        assertBoundedInt(c.port, 'port', 1, 65535);
        assertNonEmptyString(c.username, 'username');
        if (!VALID_AUTH_TYPES.has(c.authType)) {
          throw new LunarError(`Unsupported authType "${c.authType}"`, ErrorCode.VALIDATION_ERROR);
        }
        for (const [k, v] of Object.entries({ password: c.password, passphrase: c.passphrase })) {
          if (v === undefined) continue;
          if (typeof v !== 'string' || v.length > MAX_SECRET_LEN) {
            throw new LunarError(
              `${k} must be a string up to ${MAX_SECRET_LEN} characters`,
              ErrorCode.VALIDATION_ERROR,
            );
          }
        }
        if (c.jumpHostConnectionId !== undefined && c.jumpHostConfig !== undefined) {
          throw new LunarError(
            'testConnection accepts jumpHostConnectionId OR jumpHostConfig, not both',
            ErrorCode.VALIDATION_ERROR,
          );
        }
        if (c.jumpHostConnectionId !== undefined) {
          assertNonEmptyString(c.jumpHostConnectionId, 'jumpHostConnectionId');
          // Same rules as connection create/update — an invalid bastion id
          // must fail here too, otherwise a test against a deleted or
          // non-SFTP jump host passes and the real connect blows up later.
          assertValidJumpHost(getDatabase(), c.jumpHostConnectionId, null);
        }
        if (c.jumpHostConfig !== undefined) {
          assertValidManualJumpHost(c.jumpHostConfig);
        }
      } else if (params.connectionId) {
        assertNonEmptyString(params.connectionId, 'connectionId');
      } else {
        throw new LunarError(
          'testConnection requires connectionId or config',
          ErrorCode.VALIDATION_ERROR,
        );
      }
      return sshManager.testConnection(params);
    },
  );

  registerHandler(IPC.SSH_RESIZE, (_event, params: SshResizeParams) => {
    assertNonEmptyString(params.sessionId, 'sessionId');
    assertBoundedInt(params.cols, 'cols', 1, 500);
    assertBoundedInt(params.rows, 'rows', 1, 500);
    sshManager.resize(params.sessionId, params.cols, params.rows);
  });

  registerHandler(
    IPC.SSH_TRUST_HOST_KEY,
    (
      _event,
      params: { host: string; port: number },
    ): { trusted: boolean; fingerprint?: string } => {
      assertNonEmptyString(params.host, 'host');
      assertBoundedInt(params.port, 'port', 1, 65535);
      const fp = sshManager.trustPendingHostKey(params.host, params.port);
      return fp ? { trusted: true, fingerprint: fp } : { trusted: false };
    },
  );
}
