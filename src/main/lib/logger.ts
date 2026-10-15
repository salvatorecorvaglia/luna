import { LunaError } from '@shared/errors';
import log from 'electron-log/main';
import { redact, redactString } from './redact';

log.initialize();

log.transports.file.level = 'info';
log.transports.console.level = 'debug';
log.transports.file.maxSize = 10 * 1024 * 1024; // 10 MB

// Custom format for console to make it more readable during development
log.transports.console.format = '[{h}:{i}:{s}.{ms}] [{level}] {text}';

if (process.env.NODE_ENV === 'test') {
  log.transports.console.level = false;
}

/**
 * Hook to redact sensitive information (passwords, keys, etc.) from all logs.
 */
log.hooks.push((message) => {
  message.data = message.data.map((v) => {
    if (v instanceof Error) {
      // For errors, we redact the message, the stack and any custom properties.
      // The stack starts with "Name: message", so redacting only `message`
      // still wrote the secret to disk via the stack.
      v.message = redactString(v.message);
      if (v.stack) v.stack = redactString(v.stack);
      if (LunaError.isLunaError(v)) {
        const metadata = v.metadata;
        if (metadata) {
          const redactedMetadata: Record<string, unknown> = {};
          for (const [key, value] of Object.entries(metadata)) {
            redactedMetadata[key] = redact(value);
          }
          // We can't easily modify the metadata on the error object without potentially
          // causing issues if it's used elsewhere, but for logging it's fine.
          (v as unknown as { metadata: Record<string, unknown> }).metadata = redactedMetadata;
        }
      }
      return v;
    }
    return redact(v);
  });
  return message;
});

/**
 * Structured logger utility.
 */
export const logger = {
  info: (message: string, context?: Record<string, unknown>) => {
    if (context) log.info(message, context);
    else log.info(message);
  },
  warn: (message: string, context?: Record<string, unknown>) => {
    if (context) log.warn(message, context);
    else log.warn(message);
  },
  error: (message: string, error?: unknown, context?: Record<string, unknown>) => {
    const data: unknown[] = [message];
    if (error) data.push(error);
    if (context) data.push(context);
    log.error(...data);
  },
  debug: (message: string, context?: Record<string, unknown>) => {
    if (context) log.debug(message, context);
    else log.debug(message);
  },
};

export default log;
