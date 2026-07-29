import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import log from '../lib/logger';

const execFileAsync = promisify(execFile);

/** Timeout cap for external CLI calls (5 seconds) to prevent hanging the main process. */
const CLI_TIMEOUT_MS = 5000;

export class PasswordManagerService {
  /**
   * Resolves a secret reference from external password managers.
   * Supported formats:
   *  - 1Password: `op://vault-name/item-name/field-name`
   *  - Bitwarden: `bw://item-id-or-name`
   */
  async resolveSecretReference(ref: string): Promise<string | null> {
    if (!ref || typeof ref !== 'string') return null;

    const trimmed = ref.trim();

    if (trimmed.startsWith('op://')) {
      return this.resolve1Password(trimmed);
    }

    if (trimmed.startsWith('bw://')) {
      return this.resolveBitwarden(trimmed);
    }

    return null;
  }

  private async resolve1Password(ref: string): Promise<string | null> {
    try {
      // 1Password CLI command: `op read op://vault/item/field`
      const { stdout } = await execFileAsync('op', ['read', ref], {
        timeout: CLI_TIMEOUT_MS,
      });
      return stdout.trim();
    } catch (err) {
      log.warn(`[PasswordManager] Failed to resolve 1Password secret for ${ref}:`, err);
      return null;
    }
  }

  private async resolveBitwarden(ref: string): Promise<string | null> {
    try {
      // Bitwarden CLI command: `bw get password <item-id-or-name>`
      const itemId = ref.replace(/^bw:\/\//, '');
      const { stdout } = await execFileAsync('bw', ['get', 'password', itemId], {
        timeout: CLI_TIMEOUT_MS,
      });
      return stdout.trim();
    } catch (err) {
      log.warn(`[PasswordManager] Failed to resolve Bitwarden secret for ${ref}:`, err);
      return null;
    }
  }
}

export const passwordManagerService = new PasswordManagerService();
