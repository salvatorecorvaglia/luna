import type { AuthType, ManualJumpHostConfig } from '@shared/types/connection';

export interface JumpHostDbRow {
  jump_host_host?: string | null;
  jump_host_port?: number | null;
  jump_host_username?: string | null;
  jump_host_auth_type?: string | null;
  jump_host_private_key_path?: string | null;
}

/**
 * Extract a normalized `ManualJumpHostConfig` from a database row or raw input object.
 * Returns `undefined` if required fields (host, port, username, authType) are incomplete.
 */
export function extractManualJumpHostConfig(row: JumpHostDbRow): ManualJumpHostConfig | undefined {
  if (
    row.jump_host_host &&
    row.jump_host_port &&
    row.jump_host_username &&
    row.jump_host_auth_type
  ) {
    return {
      host: row.jump_host_host,
      port: row.jump_host_port,
      username: row.jump_host_username,
      authType: row.jump_host_auth_type as AuthType,
      privateKeyPath: row.jump_host_private_key_path || undefined,
    };
  }
  return undefined;
}
