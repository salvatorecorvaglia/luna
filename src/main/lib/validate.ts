export function assertNonEmptyString(value: unknown, name: string): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${name} must be a non-empty string`)
  }
  if (value.includes('\0')) {
    throw new Error(`${name} must not contain null bytes`)
  }
}

export function assertBoundedInt(
  value: unknown,
  name: string,
  min: number,
  max: number
): asserts value is number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`)
  }
}

export function assertValidPath(value: unknown, name: string): asserts value is string {
  assertNonEmptyString(value, name)
  if ((value as string).includes('\0')) {
    throw new Error(`${name} must not contain null bytes`)
  }
}

/** Hard cap on a saved startup command. */
export const MAX_STARTUP_COMMAND_LEN = 2000

/**
 * Validate a user-supplied startup command before persisting it.
 * Allows printable text, tab and newline. Rejects null bytes, other control
 * characters, and over-long input. Returns the trimmed string, or null when
 * input is empty/missing.
 */
export function sanitizeStartupCommand(value: unknown): string | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') {
    throw new Error('startupCommand must be a string')
  }
  const trimmed = value.replace(/^\s+|\s+$/g, '')
  if (trimmed.length === 0) return null
  if (trimmed.length > MAX_STARTUP_COMMAND_LEN) {
    throw new Error(`startupCommand exceeds ${MAX_STARTUP_COMMAND_LEN} characters`)
  }
  // Disallow control chars except tab (\x09) and newline (\x0A); explicitly reject \0.
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x08\x0B-\x1F\x7F]/.test(trimmed)) {
    throw new Error('startupCommand contains disallowed control characters')
  }
  return trimmed
}
