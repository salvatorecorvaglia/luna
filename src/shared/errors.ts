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

export class LunarError extends Error {
  public readonly code: ErrorCode;
  public readonly metadata?: Record<string, unknown>;

  constructor(
    message: string,
    code: ErrorCode = ErrorCode.INTERNAL_ERROR,
    metadata?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'LunarError';
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

  public static isLunarError(error: unknown): error is LunarError {
    return (
      error instanceof LunarError ||
      (typeof error === 'object' && error !== null && 'code' in error && 'message' in error)
    );
  }

  public static fromUnknown(
    error: unknown,
    defaultCode: ErrorCode = ErrorCode.INTERNAL_ERROR,
  ): LunarError {
    if (error instanceof LunarError) {
      return error;
    }

    if (error instanceof Error) {
      const lunarError = new LunarError(error.message, defaultCode);
      lunarError.stack = error.stack;
      return lunarError;
    }

    if (typeof error === 'object' && error !== null && 'code' in error && 'message' in error) {
      const e = error as ErrorDetails;
      const lunarError = new LunarError(e.message, e.code, e.metadata);
      lunarError.stack = e.stack;
      return lunarError;
    }

    return new LunarError(String(error), defaultCode);
  }
}
