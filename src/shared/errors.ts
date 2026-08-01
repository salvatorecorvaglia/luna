export enum ErrorCode {
  INTERNAL_ERROR = 'INTERNAL_ERROR',
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  NOT_FOUND = 'NOT_FOUND',
  UNAUTHORIZED = 'UNAUTHORIZED',
  FORBIDDEN = 'FORBIDDEN',
  DATABASE_ERROR = 'DATABASE_ERROR',
  SSH_ERROR = 'SSH_ERROR',
  SFTP_ERROR = 'SFTP_ERROR',
  S3_ERROR = 'S3_ERROR',
  NETWORK_ERROR = 'NETWORK_ERROR',
  AUTO_UPDATER_ERROR = 'AUTO_UPDATER_ERROR',
}

export interface ErrorDetails {
  code: ErrorCode;
  message: string;
  stack?: string;
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
}

export class LunaError extends Error {
  public readonly code: ErrorCode;
  public readonly metadata?: Record<string, unknown>;

  constructor(
    message: string,
    code: ErrorCode = ErrorCode.INTERNAL_ERROR,
    metadata?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'LunaError';
    this.code = code;
    this.metadata = metadata;
    // Ensure the stack is captured correctly
    Error.captureStackTrace(this, this.constructor);
  }

  public toObject(): ErrorDetails {
    return {
      code: this.code,
      message: this.message,
      stack: this.stack,
      metadata: this.metadata,
    };
  }

  public static isLunaError(error: unknown): error is LunaError {
    return (
      error instanceof LunaError ||
      (typeof error === 'object' &&
        error !== null &&
        'name' in error &&
        (error as Error).name === 'LunaError')
    );
  }

  public static fromUnknown(
    error: unknown,
    defaultCode: ErrorCode = ErrorCode.INTERNAL_ERROR,
  ): LunaError {
    if (error instanceof LunaError) {
      return error;
    }

    if (error instanceof Error) {
      const lunaError = new LunaError(error.message, defaultCode);
      lunaError.stack = error.stack;
      return lunaError;
    }

    if (typeof error === 'object' && error !== null && 'code' in error && 'message' in error) {
      const e = error as ErrorDetails;
      const lunaError = new LunaError(e.message, e.code, e.metadata);
      lunaError.stack = e.stack;
      return lunaError;
    }

    return new LunaError(String(error), defaultCode);
  }
}
