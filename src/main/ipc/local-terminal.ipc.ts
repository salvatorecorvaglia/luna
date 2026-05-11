import { ipcMain } from 'electron';
import { homedir } from 'os';
import { IPC } from '@shared/constants';
import { getMainWindow } from './app.ipc';
import { assertBoundedInt, assertNonEmptyString } from '../lib/validate';
import log from '../lib/logger';

import * as pty from 'node-pty';

interface LocalPtySession {
  pty: pty.IPty;
}

const sessions = new Map<string, LocalPtySession>();

/** Upper bound on a single PTY write from the renderer. Matches the SSH cap. */
const MAX_PTY_SEND_BYTES = 65536;

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
  ipcMain.handle(
    IPC.LOCAL_TERMINAL_SPAWN,
    (_event, { sessionId, cols, rows }: { sessionId: string; cols: number; rows: number }) => {
      assertNonEmptyString(sessionId, 'sessionId');
      assertBoundedInt(cols, 'cols', 1, 500);
      assertBoundedInt(rows, 'rows', 1, 500);
      if (sessions.has(sessionId)) return;

      const shell = detectShell();
      const args = process.platform !== 'win32' ? ['--login'] : [];
      const ptyProcess = pty.spawn(shell, args, {
        name: 'xterm-256color',
        cols,
        rows,
        cwd: homedir(),
        env: {
          ...process.env,
          TERM: 'xterm-256color',
          COLORTERM: 'truecolor',
          // Ensure we don't pass Electron-specific vars that might confuse child shells
          ELECTRON_RUN_AS_NODE: undefined,
        },
      });

      sessions.set(sessionId, { pty: ptyProcess });

      ptyProcess.onData((data: string) => {
        const win = getMainWindow();
        if (win && !win.isDestroyed()) {
          win.webContents.send(IPC.LOCAL_TERMINAL_ON_DATA, { sessionId, data });
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
  ipcMain.handle(IPC.LOCAL_TERMINAL_KILL, (_event, sessionId: string) => {
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
  ipcMain.handle(
    IPC.LOCAL_TERMINAL_SEND_DATA,
    (_event, { sessionId, data }: { sessionId: string; data: string }) => {
      assertNonEmptyString(sessionId, 'sessionId');
      if (typeof data !== 'string') {
        throw new Error('data must be a string');
      }
      const byteLength = Buffer.byteLength(data, 'utf8');
      if (byteLength > MAX_PTY_SEND_BYTES) {
        throw new Error(`PTY input exceeds ${MAX_PTY_SEND_BYTES}-byte cap (got ${byteLength})`);
      }
      const session = sessions.get(sessionId);
      if (!session) return;
      session.pty.write(data);
    },
  );

  // Resize a session
  ipcMain.handle(
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
