import { ErrorCode, LunarError } from './errors';

/**
 * Human-friendly description for each known error code. Kept short and
 * action-oriented — these surface in toasts, so they need to read at a
 * glance and avoid jargon.
 */
const CODE_DESCRIPTIONS: Record<ErrorCode, string> = {
  [ErrorCode.INTERNAL_ERROR]: 'Something went wrong',
  [ErrorCode.VALIDATION_ERROR]: 'Check the highlighted fields and try again',
  [ErrorCode.NOT_FOUND]: 'Not found',
  [ErrorCode.UNAUTHORIZED]: 'Authentication failed — check your credentials',
  [ErrorCode.FORBIDDEN]: 'Permission denied',
  [ErrorCode.DATABASE_ERROR]: 'Local database error',
  [ErrorCode.SSH_ERROR]: 'SSH connection error',
  [ErrorCode.SFTP_ERROR]: 'SFTP error',
  [ErrorCode.S3_ERROR]: 'S3 error',
  [ErrorCode.NETWORK_ERROR]: 'Network error — check your connection',
  [ErrorCode.AUTO_UPDATER_ERROR]: 'Updater error',
};

/** Strip noisy error-class prefixes that leak from main-process throws. */
function stripPrefixes(message: string): string {
  return message.replace(/^(LunarError|S3StorageError|SftpStorageError|Error):\s*/i, '').trim();
}

export interface FormattedError {
  /** Primary line shown to the user. */
  title: string;
  /** Optional secondary line for context (Sonner renders below the title). */
  description?: string;
  /** Stable code for telemetry / conditional UI; undefined for non-LunarErrors. */
  code?: ErrorCode;
}

/**
 * Normalize any thrown value into a stable shape for toasts and inline UI.
 *
 * Use as:
 *   const { title, description } = formatError(err);
 *   toast.error(title, { description });
 *
 * Or directly:
 *   toast.error(...toastArgs(err, 'Save failed'));
 *
 * When `prefix` is supplied it becomes the title and the original message
 * moves to the description, so callers don't need to manually concatenate
 * "Save failed: ${err.message}" anymore.
 */
export function formatError(err: unknown, prefix?: string): FormattedError {
  if (LunarError.isLunarError(err)) {
    const message = stripPrefixes(err.message) || CODE_DESCRIPTIONS[err.code];
    return {
      title: prefix ?? message,
      description: prefix ? message : CODE_DESCRIPTIONS[err.code],
      code: err.code,
    };
  }

  if (err instanceof Error) {
    const message = stripPrefixes(err.message);
    return {
      title: prefix ?? message,
      description: prefix ? message : undefined,
    };
  }

  const message = stripPrefixes(String(err)) || 'Something went wrong';
  return {
    title: prefix ?? message,
    description: prefix ? message : undefined,
  };
}

/**
 * Sonner-friendly tuple. Spreads into `toast.error(title, { description })`.
 */
export function toastArgs(err: unknown, prefix?: string): [string, { description?: string }] {
  const { title, description } = formatError(err, prefix);
  return [title, { description }];
}
