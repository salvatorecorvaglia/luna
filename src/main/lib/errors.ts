import { ErrorCode, LunaError } from '@shared/errors';

export class SshConnectionError extends LunaError {
  constructor(message: string, metadata?: Record<string, unknown>) {
    super(message, ErrorCode.SSH_ERROR, metadata);
    this.name = 'SshConnectionError';
  }
}

export class SftpTransferError extends LunaError {
  constructor(message: string, metadata?: Record<string, unknown>) {
    super(message, ErrorCode.SFTP_ERROR, metadata);
    this.name = 'SftpTransferError';
  }
}

/** Signals that a transfer (or a generic op) was aborted by the caller. */
export class AbortError extends Error {
  constructor(message = 'Aborted') {
    super(message);
    this.name = 'AbortError';
  }
}

export class S3StorageError extends LunaError {
  /**
   * True when the underlying SDK error is one the caller can reasonably
   * retry (throttling, 5xx, transient network). Always-false for auth
   * failures, NoSuchBucket, AccessDenied, etc. — re-issuing those would
   * just burn another round-trip with the same result.
   */
  public readonly retryable: boolean;

  constructor(
    message: string,
    public readonly cause?: unknown,
    metadata?: Record<string, unknown> & { retryable?: boolean },
  ) {
    const retryable = metadata?.retryable === true;
    super(message, ErrorCode.S3_ERROR, { ...metadata, cause, retryable });
    this.name = 'S3StorageError';
    this.retryable = retryable;
  }
}
