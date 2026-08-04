import { homedir } from 'node:os';
import { StringDecoder } from 'node:string_decoder';
import { IPC } from '@shared/constants';
import { ErrorCode, LunaError } from '@shared/errors';
import * as pty from 'node-pty';
import { registerHandler } from '../lib/ipc-handler';
import log from '../lib/logger';
import { assertBoundedInt, assertNonEmptyString } from '../lib/validate';
import { getMainWindow } from './app.ipc';

interface LocalPtySession {
  pty: pty.IPty;
}

const sessions = new Map<string, LocalPtySession>();

interface TerminalBuffer {
  data: string[];
  timer: NodeJS.Timeout | null;
}

const localTerminalBuffers = new Map<string, TerminalBuffer>();

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
 * Hard cap on concurrent local shells. Every other resource in the app is
 * bounded (queued transfers, tracked rate-limit buckets, SFTP leases) but
 * spawn was not: a renderer loop — buggy or hostile — could fork unbounded
 * login shells, each of which sources the user's full shell profile. 32 is
 * well past any plausible tab count.
 */
const MAX_LOCAL_SESSIONS = 32;

/** Flush interval for coalescing PTY output into one IPC message. */
const PTY_FLUSH_INTERVAL_MS = 16;

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
      if (sessions.size >= MAX_LOCAL_SESSIONS) {
        throw new LunaError(
          `Too many local terminals open (max ${MAX_LOCAL_SESSIONS}). Close one and try again.`,
          ErrorCode.FORBIDDEN,
          { reason: 'session-limit', limit: MAX_LOCAL_SESSIONS },
        );
      }

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
      for (const v of electronVars) {
        delete cleanEnv[v];
      }

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

      /**
       * Send one frame, re-resolving the window each time.
       *
       * The window must be re-checked at *send* time, not at enqueue time.
       * The flush runs on a 16 ms timer, so a window destroyed between the
       * `onData` callback and the timer firing left the old code calling
       * `webContents.send` on a destroyed object. That throws from inside a
       * timer callback — an unhandled exception, which the process-level
       * handler answers with `process.exit(1)`. Closing the window while a
       * chatty command was running could take the whole app down with it.
       */
      const emit = (data: string): boolean => {
        const win = getMainWindow();
        if (!win || win.isDestroyed() || win.webContents.isDestroyed()) return false;
        win.webContents.send(IPC.LOCAL_TERMINAL_ON_DATA, { sessionId, data });
        return true;
      };

      const flush = (): void => {
        const currentTb = localTerminalBuffers.get(sessionId);
        if (!currentTb) return;
        const combined = currentTb.data.join('');
        currentTb.data = [];
        currentTb.timer = null;
        if (combined.length === 0) return;

        const buf = Buffer.from(combined, 'utf8');
        if (buf.byteLength <= MAX_PTY_EMIT_BYTES) {
          emit(combined);
          return;
        }
        // Chunk on byte boundaries; StringDecoder reassembles UTF-8 sequences
        // straddling chunk edges so a 4-byte emoji can't be corrupted.
        for (let offset = 0; offset < buf.byteLength; offset += MAX_PTY_EMIT_BYTES) {
          const slice = buf.subarray(offset, offset + MAX_PTY_EMIT_BYTES);
          const chunk = decoder.write(slice);
          // Stop early if the window went away mid-chunk-loop; the remaining
          // slices have nowhere to go.
          if (chunk.length > 0 && !emit(chunk)) return;
        }
        const tail = decoder.end();
        if (tail.length > 0) emit(tail);
      };

      ptyProcess.onData((data: string) => {
        // Cheap early-out: don't accumulate output for a window that's gone.
        // The authoritative check lives in emit().
        const win = getMainWindow();
        if (!win || win.isDestroyed()) return;

        let tb = localTerminalBuffers.get(sessionId);
        if (!tb) {
          tb = { data: [], timer: null };
          localTerminalBuffers.set(sessionId, tb);
        }
        tb.data.push(data);

        if (!tb.timer) {
          tb.timer = setTimeout(() => {
            try {
              flush();
            } catch (err) {
              // A throw here would escape the timer as an uncaught exception
              // and kill the process. Losing a frame of terminal output is a
              // vastly better outcome.
              log.error(`[LocalTerminal] Flush failed for session ${sessionId}:`, err);
              const tb = localTerminalBuffers.get(sessionId);
              if (tb) {
                tb.data = [];
                tb.timer = null;
              }
            }
          }, PTY_FLUSH_INTERVAL_MS);
        }
      });

      ptyProcess.onExit(({ exitCode }: { exitCode: number }) => {
        sessions.delete(sessionId);
        const buffer = localTerminalBuffers.get(sessionId);
        if (buffer) {
          if (buffer.timer) clearTimeout(buffer.timer);
          localTerminalBuffers.delete(sessionId);
        }
        const win = getMainWindow();
        if (win && !win.isDestroyed() && !win.webContents.isDestroyed()) {
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
    const buffer = localTerminalBuffers.get(sessionId);
    if (buffer) {
      if (buffer.timer) clearTimeout(buffer.timer);
      localTerminalBuffers.delete(sessionId);
    }
  });

  // Send data to a session
  registerHandler(
    IPC.LOCAL_TERMINAL_SEND_DATA,
    (_event, { sessionId, data }: { sessionId: string; data: string }) => {
      assertNonEmptyString(sessionId, 'sessionId');
      if (typeof data !== 'string') {
        throw new LunaError('data must be a string', ErrorCode.VALIDATION_ERROR);
      }
      const byteLength = Buffer.byteLength(data, 'utf8');
      if (byteLength > MAX_PTY_SEND_BYTES) {
        throw new LunaError(
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
  const ids = Array.from(sessions.keys());
  for (const id of ids) {
    const session = sessions.get(id);
    if (session) {
      try {
        session.pty.kill();
      } catch {
        // ignore
      }
      log.info(`[LocalTerminal] Disposed session ${id} on quit`);
    }
  }
  sessions.clear();
  for (const buffer of localTerminalBuffers.values()) {
    if (buffer.timer) clearTimeout(buffer.timer);
  }
  localTerminalBuffers.clear();
}
