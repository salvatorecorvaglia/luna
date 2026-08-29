import { execFile } from 'node:child_process';
import { constants as fsConstants } from 'node:fs';
import { access } from 'node:fs/promises';
import { delimiter, join } from 'node:path';
import { promisify } from 'node:util';
import { ErrorCode, LunaError } from '@shared/errors';
import log from '../lib/logger';

const execFileAsync = promisify(execFile);

/** Timeout cap for external CLI calls (5 seconds) to prevent hanging the main process. */
const CLI_TIMEOUT_MS = 5000;

/**
 * Cap on stdout from a password-manager CLI. A secret is at most a few KiB;
 * without a cap, a wedged or hostile `op`/`bw` on PATH could stream unbounded
 * output into the main process. Node's default is 1 MiB, which is still more
 * than any credential needs.
 */
const MAX_CLI_OUTPUT_BYTES = 64 * 1024;

/**
 * Resolve `bin` to something `execFile` can actually launch.
 *
 * On POSIX this is a no-op: `execFile` already resolves a bare name through
 * PATH with execvp semantics.
 *
 * Windows is the problem. `execFile` is used deliberately with no `shell`, so
 * nothing the user or a vault puts in an argument is ever seen by a command
 * processor — that is what makes the reference grammar and the `--` separator
 * sufficient. But without a shell Windows does not append `.exe` either, so
 * `execFile('op', …)` failed with ENOENT on every Windows install and the
 * integration reported "CLI not found" even with the CLI installed and on PATH.
 *
 * Returns null when nothing suitable is found, so the caller raises its own
 * "not installed" error.
 */
async function resolveExecutable(bin: string): Promise<string | null> {
  if (process.platform !== 'win32') return bin;

  const pathVar = process.env['PATH'] ?? process.env['Path'] ?? '';
  const dirs = pathVar.split(delimiter).filter(Boolean);

  // `.cmd`/`.bat` are deliberately absent. They are not executable by
  // CreateProcess, so running one requires routing through cmd.exe — which
  // would reintroduce exactly the command-processor parsing this module exists
  // to avoid, in the one code path that handles live credentials. Users who
  // installed an npm shim get the clear error below instead.
  const suffixes = ['.exe', '.com'];

  for (const dir of dirs) {
    for (const suffix of suffixes) {
      const candidate = join(dir, bin + suffix);
      try {
        await access(candidate, fsConstants.X_OK);
        return candidate;
      } catch {
        // Not here (or not executable) — keep looking.
      }
    }
  }
  return null;
}

/**
 * One path segment: starts with a word character, then word characters,
 * spaces, dots and dashes. The leading-word-character requirement is what
 * stops a segment from looking like a CLI flag (`--config`). Passing `--`
 * before the argument already neutralises that, but rejecting it outright
 * costs nothing and keeps the accepted set to things that are plausibly real
 * vault/item names.
 */
const SEGMENT = String.raw`[\w][\w .-]*`;

/**
 * 1Password secret references: `op://<vault>/<item>/<field>`, optionally with
 * a section (`op://vault/item/section/field`).
 */
const OP_REF_RE = new RegExp(`^op://${SEGMENT}/${SEGMENT}/${SEGMENT}(/${SEGMENT})?$`);

/** Bitwarden references: `bw://<item id or name>`. */
const BW_REF_RE = new RegExp(`^bw://${SEGMENT}$`);

/** Longest reference we'll even attempt to parse. */
const MAX_REF_LEN = 512;

export class PasswordManagerService {
  /**
   * Resolves a secret reference from external password managers.
   * Supported formats:
   *  - 1Password: `op://vault-name/item-name/field-name`
   *  - Bitwarden: `bw://item-id-or-name`
   *
   * References are validated against a strict grammar before they reach the
   * CLI. `execFile` already rules out shell injection, but it does not stop
   * *argument* injection: the previous implementation passed everything after
   * `bw://` straight through as argv, so a reference beginning with `-` became
   * a flag to the `bw` binary. The grammar below also keeps the surface
   * honest — anything that isn't a plain vault/item/field path is refused
   * rather than shipped to a subprocess and hoped for.
   */
  async resolveSecretReference(ref: string): Promise<string | null> {
    if (!ref || typeof ref !== 'string') return null;

    const trimmed = ref.trim();
    // A blank field is "nothing configured", not "bad input" — don't make the
    // user read an error for leaving an optional box empty.
    if (trimmed.length === 0) return null;
    if (trimmed.length > MAX_REF_LEN) {
      throw new LunaError(
        `Secret reference exceeds ${MAX_REF_LEN} characters`,
        ErrorCode.VALIDATION_ERROR,
      );
    }

    if (trimmed.startsWith('op://')) {
      if (!OP_REF_RE.test(trimmed)) {
        throw new LunaError(
          'Invalid 1Password reference. Expected op://vault/item/field.',
          ErrorCode.VALIDATION_ERROR,
        );
      }
      return this.run('op', ['read', '--', trimmed], '1Password');
    }

    if (trimmed.startsWith('bw://')) {
      if (!BW_REF_RE.test(trimmed)) {
        throw new LunaError(
          'Invalid Bitwarden reference. Expected bw://item-id-or-name (letters, digits, spaces, dot, dash, underscore).',
          ErrorCode.VALIDATION_ERROR,
        );
      }
      const itemId = trimmed.slice('bw://'.length);
      return this.run('bw', ['get', 'password', '--', itemId], 'Bitwarden');
    }

    throw new LunaError(
      'Unsupported secret reference. Use op:// (1Password) or bw:// (Bitwarden).',
      ErrorCode.VALIDATION_ERROR,
    );
  }

  /**
   * Invoke a password-manager CLI. Never logs the reference or the output —
   * both are secret-adjacent, and the whole point of this integration is to
   * keep credentials out of Luna's own storage and logs.
   */
  private async run(bin: string, args: string[], label: string): Promise<string | null> {
    const resolved = await resolveExecutable(bin);
    if (!resolved) {
      throw new LunaError(
        `The ${label} CLI ("${bin}") was not found on PATH. Install it and sign in, then try again.` +
          (process.platform === 'win32'
            ? ` On Windows, install the native ${label} CLI executable — the npm wrapper installs a .cmd shim, which Luna will not run because doing so would require passing your credentials through a command processor.`
            : ''),
        ErrorCode.NOT_FOUND,
        { reason: 'cli-missing', bin },
      );
    }
    try {
      const { stdout } = await execFileAsync(resolved, args, {
        timeout: CLI_TIMEOUT_MS,
        maxBuffer: MAX_CLI_OUTPUT_BYTES,
        // Don't let a CLI inherit a shell that might prompt interactively.
        windowsHide: true,
      });
      const secret = stdout.trim();
      return secret.length > 0 ? secret : null;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException | undefined)?.code;
      if (code === 'ENOENT') {
        throw new LunaError(
          `The ${label} CLI ("${bin}") was not found on PATH. Install it and sign in, then try again.`,
          ErrorCode.NOT_FOUND,
          { reason: 'cli-missing', bin },
        );
      }
      // Deliberately does not include the reference or stderr: stderr from
      // these tools routinely echoes the item path being read.
      log.warn(`[PasswordManager] ${label} lookup failed (${code ?? 'non-zero exit'})`);
      return null;
    }
  }
}

export const passwordManagerService = new PasswordManagerService();
