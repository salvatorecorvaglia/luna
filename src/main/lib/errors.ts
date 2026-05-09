import { LunarError, ErrorCode } from '@shared/errors';

export class SshConnectionError extends LunarError {
  constructor(message: string, metadata?: Record<string, unknown>) {
    super(message, ErrorCode.SSH_ERROR, metadata);
    this.name = 'SshConnectionError';
  }
}

export class SftpTransferError extends LunarError {
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

export class S3StorageError extends LunarError {
  constructor(
    message: string,
    public readonly cause?: unknown,
    metadata?: Record<string, unknown>,
  ) {
    super(message, ErrorCode.S3_ERROR, { ...metadata, cause });
    this.name = 'S3StorageError';
  }
}
