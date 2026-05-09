import { ipcMain } from 'electron';
import { homedir } from 'os';
import { IPC } from '@shared/constants';
import { getMainWindow } from './app.ipc';
import log from '../lib/logger';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const pty = require('node-pty') as typeof import('node-pty');

interface LocalPtySession {
  pty: import('node-pty').IPty;
}

const sessions = new Map<string, LocalPtySession>();

function detectShell(): string {
  if (process.platform === 'win32') return 'powershell.exe';
  const shell = process.env['SHELL'] || '/bin/zsh';
  return shell;
}

export function registerLocalTerminalHandlers(): void {
  // Spawn a new local PTY session
  ipcMain.handle(
    IPC.LOCAL_TERMINAL_SPAWN,
    (_event, { sessionId, cols, rows }: { sessionId: string; cols: number; rows: number }) => {
      if (sessions.has(sessionId)) return;

      const shell = detectShell();
      const args = process.platform !== 'win32' ? ['--login'] : [];
      const ptyProcess = pty.spawn(shell, args, {
        name: 'xterm-256color',
        cols: cols || 80,
        rows: rows || 24,
        cwd: homedir(),
        env: {
          ...process.env,
          TERM: 'xterm-256color',
          COLORTERM: 'truecolor',
          // Ensure we don't pass Electron-specific vars that might confuse child shells
          ELECTRON_RUN_AS_NODE: undefined,
        } as Record<string, string | undefined> as Record<string, string>,
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
      const session = sessions.get(sessionId);
      if (!session) return;
      session.pty.write(data);
    },
  );

  // Resize a session
  ipcMain.handle(
    IPC.LOCAL_TERMINAL_RESIZE,
    (_event, { sessionId, cols, rows }: { sessionId: string; cols: number; rows: number }) => {
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
