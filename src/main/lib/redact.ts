/**
 * Lightweight redaction helpers used at the logger boundary so secrets and
 * partial credentials never reach disk.
 */

const SENSITIVE_KEYS = new Set([
  'password',
  'passphrase',
  'privatekey',
  'private_key',
  'privatekeydata',
  'secret',
  'authorization',
  'token',
  'cookie'
])

const PLACEHOLDER = '[REDACTED]'

export function redactString(input: string): string {
  // Strip authorization-style header bodies and "password=..." style fragments.
  return input
    .replace(/(authorization\s*[:=]\s*)([^\s,;]+)/gi, `$1${PLACEHOLDER}`)
    .replace(/(password\s*[:=]\s*)([^\s,;]+)/gi, `$1${PLACEHOLDER}`)
    .replace(/(passphrase\s*[:=]\s*)([^\s,;]+)/gi, `$1${PLACEHOLDER}`)
}

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return PLACEHOLDER
  if (value == null) return value
  if (typeof value === 'string') return redactString(value)
  if (typeof value !== 'object') return value
  if (Buffer.isBuffer(value)) return `[Buffer ${value.length}b]`
  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactString(value.message),
      stack: value.stack ? redactString(value.stack) : undefined
    }
  }
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1))
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = SENSITIVE_KEYS.has(k.toLowerCase()) ? PLACEHOLDER : redact(v, depth + 1)
  }
  return out
}
