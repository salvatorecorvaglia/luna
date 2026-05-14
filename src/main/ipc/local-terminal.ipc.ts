import { homedir } from 'os';
import { StringDecoder } from 'string_decoder';
import { IPC } from '@shared/constants';
import { getMainWindow } from './app.ipc';
import { assertBoundedInt, assertNonEmptyString } from '../lib/validate';
import { ErrorCode, LunarError } from '@shared/errors';
import { registerHandler } from '../lib/ipc-handler';
import log from '../lib/logger';

import * as pty from 'node-pty';

interface LocalPtySession {
  pty: pty.IPty;
}

const sessions = new Map<string, LocalPtySession>();

/** Upper bound on a single PTY write from the renderer. Matches the SSH cap. */
const MAX_PTY_SEND_BYTES = 65536;
/**
 * Upper bound on a single PTY → renderer emit. A misbehaving child process
 * (e.g. `yes > /dev/tty`) can produce arbitrarily large chunks; if we hand
 * the entire chunk to xterm in one IPC message, the renderer can stall
 * parsing for seconds. 1 MiB is well above what any well-behaved program
 * emits in a single read but small enough to keep the UI responsive.
 */
const MAX_PTY_EMIT_BYTES = 1024 * 1024;

/**
 * Whitelist of POSIX shells we're willing to spawn. process.env.SHELL is
 * attacker-influenceable (parent process, IDE launcher, sourced .env), so we
 * refuse to hand it straight to pty.spawn().
 */
const ALLOWED_POSIX_SHELLS = new Set([
  '/bin/zsh',
  '/bin/bash',
  '/bin/sh',
  '/bin/dash',
  '/bin/fish',
  '/usr/bin/zsh',
  '/usr/bin/bash',
  '/usr/bin/sh',
  '/usr/bin/dash',
  '/usr/bin/fish',
  '/usr/local/bin/bash',
  '/usr/local/bin/zsh',
  '/usr/local/bin/fish',
  '/opt/homebrew/bin/bash',
  '/opt/homebrew/bin/zsh',
  '/opt/homebrew/bin/fish',
]);

function detectShell(): string {
  if (process.platform === 'win32') return 'powershell.exe';
  const candidate = process.env['SHELL'];
  if (candidate && ALLOWED_POSIX_SHELLS.has(candidate)) return candidate;
  if (candidate) {
    log.warn(`[LocalTerminal] Ignoring untrusted $SHELL "${candidate}"; falling back to /bin/zsh`);
  }
  return '/bin/zsh';
}

export function registerLocalTerminalHandlers(): void {
  // Spawn a new local PTY session
  registerHandler(
    IPC.LOCAL_TERMINAL_SPAWN,
    (_event, { sessionId, cols, rows }: { sessionId: string; cols: number; rows: number }) => {
      assertNonEmptyString(sessionId, 'sessionId');
      assertBoundedInt(cols, 'cols', 1, 500);
      assertBoundedInt(rows, 'rows', 1, 500);
      if (sessions.has(sessionId)) return;

      const shell = detectShell();
      const args = process.platform !== 'win32' ? ['--login'] : [];
      const cleanEnv = { ...process.env };
      const electronVars = [
        'ELECTRON_RUN_AS_NODE',
        'ELECTRON_NO_ATTACH_CONSOLE',
        'ORIGINAL_XDG_CURRENT_DESKTOP',
        'CHROME_DESKTOP',
        'DESKTOP_STARTUP_ID',
      ];
      electronVars.forEach((v) => delete cleanEnv[v]);

      const ptyProcess = pty.spawn(shell, args, {
        name: 'xterm-256color',
        cols,
        rows,
        cwd: homedir(),
        env: {
          ...cleanEnv,
          TERM: 'xterm-256color',
          COLORTERM: 'truecolor',
        },
      });

      sessions.set(sessionId, { pty: ptyProcess });

      // StringDecoder buffers incomplete UTF-8 sequences across emits so we
      // never hand a half-multibyte character to the renderer.
      const decoder = new StringDecoder('utf8');
      ptyProcess.onData((data: string) => {
        const win = getMainWindow();
        if (!win || win.isDestroyed()) return;
        const buf = Buffer.from(data, 'utf8');
        if (buf.byteLength <= MAX_PTY_EMIT_BYTES) {
          win.webContents.send(IPC.LOCAL_TERMINAL_ON_DATA, { sessionId, data });
          return;
        }
        // Chunk on byte boundaries; StringDecoder reassembles UTF-8 sequences
        // straddling chunk edges so a 4-byte emoji can't be corrupted.
        for (let offset = 0; offset < buf.byteLength; offset += MAX_PTY_EMIT_BYTES) {
          const slice = buf.subarray(offset, offset + MAX_PTY_EMIT_BYTES);
          const chunk = decoder.write(slice);
          if (chunk.length > 0) {
            win.webContents.send(IPC.LOCAL_TERMINAL_ON_DATA, { sessionId, data: chunk });
          }
        }
        const tail = decoder.end();
        if (tail.length > 0) {
          win.webContents.send(IPC.LOCAL_TERMINAL_ON_DATA, { sessionId, data: tail });
        }
      });

      ptyProcess.onExit(({ exitCode }: { exitCode: number }) => {
        sessions.delete(sessionId);
        const win = getMainWindow();
        if (win && !win.isDestroyed()) {
          win.webContents.send(IPC.LOCAL_TERMINAL_ON_EXIT, { sessionId, exitCode });
        }
        log.info(`[LocalTerminal] Session ${sessionId} exited with code ${exitCode}`);
      });

      log.info(`[LocalTerminal] Spawned session ${sessionId} (shell: ${shell})`);
    },
  );

  // Kill a session
  registerHandler(IPC.LOCAL_TERMINAL_KILL, (_event, sessionId: string) => {
    assertNonEmptyString(sessionId, 'sessionId');
    const session = sessions.get(sessionId);
    if (!session) return;
    try {
      session.pty.kill();
    } catch (err) {
      log.warn(`[LocalTerminal] Error killing session ${sessionId}:`, err);
    }
    sessions.delete(sessionId);
  });

  // Send data to a session
  registerHandler(
    IPC.LOCAL_TERMINAL_SEND_DATA,
    (_event, { sessionId, data }: { sessionId: string; data: string }) => {
      assertNonEmptyString(sessionId, 'sessionId');
      if (typeof data !== 'string') {
        throw new LunarError('data must be a string', ErrorCode.VALIDATION_ERROR);
      }
      const byteLength = Buffer.byteLength(data, 'utf8');
      if (byteLength > MAX_PTY_SEND_BYTES) {
        throw new LunarError(
          `PTY input exceeds ${MAX_PTY_SEND_BYTES}-byte cap (got ${byteLength})`,
          ErrorCode.VALIDATION_ERROR,
        );
      }
      const session = sessions.get(sessionId);
      if (!session) return;
      session.pty.write(data);
    },
  );

  // Resize a session
  registerHandler(
    IPC.LOCAL_TERMINAL_RESIZE,
    (_event, { sessionId, cols, rows }: { sessionId: string; cols: number; rows: number }) => {
      assertNonEmptyString(sessionId, 'sessionId');
      assertBoundedInt(cols, 'cols', 1, 500);
      assertBoundedInt(rows, 'rows', 1, 500);
      const session = sessions.get(sessionId);
      if (!session) return;
      try {
        session.pty.resize(cols, rows);
      } catch (err) {
        log.warn(`[LocalTerminal] Resize failed for session ${sessionId}:`, err);
      }
    },
  );
}

/** Kill all local sessions on app quit. */
export function disposeLocalTerminals(): void {
  for (const [id, session] of sessions) {
    try {
      session.pty.kill();
    } catch {
      // ignore
    }
    log.info(`[LocalTerminal] Disposed session ${id} on quit`);
  }
  sessions.clear();
}
