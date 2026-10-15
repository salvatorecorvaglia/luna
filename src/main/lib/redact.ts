/**
 * Lightweight redaction helpers used at the logger boundary so secrets and
 * partial credentials never reach disk.
 */

const SENSITIVE_KEYS = new Set([
  'password',
  'passphrase',
  'privatekey',
  'privatekeydata',
  'secret',
  'authorization',
  'token',
  'cookie',
  'accesskeyid',
  'secretaccesskey',
  'sessiontoken',
  'credential',
  'credentials',
]);

/**
 * Suffixes that mark a key as secret-bearing whatever its prefix —
 * `accessToken`, `refresh_token`, `apiKey`, `dbPassword`, `clientSecret`.
 * The exact-match set alone let every one of those through.
 */
const SENSITIVE_SUFFIXES = ['password', 'passphrase', 'token', 'secret', 'apikey'];

/** Lower-case and drop `_`/`-` so `private_key`, `private-key` and `privateKey` compare equal. */
function normaliseKey(key: string): string {
  return key.toLowerCase().replace(/[-_]/g, '');
}

export function isSensitiveKey(key: string): boolean {
  const k = normaliseKey(key);
  return SENSITIVE_KEYS.has(k) || SENSITIVE_SUFFIXES.some((suffix) => k.endsWith(suffix));
}

const PLACEHOLDER = '[REDACTED]';

/**
 * Key names redacted inside free text. Longer alternatives first so e.g.
 * `secretAccessKey` wins over `secret`. Includes the S3 presigned-URL query
 * parameters: a presigned URL is a bearer credential until it expires.
 */
const TEXT_KEYS = [
  'x-amz-security-token',
  'x-amz-signature',
  'x-amz-credential',
  'secret[_-]?access[_-]?key',
  'access[_-]?key[_-]?id',
  'session[_-]?token',
  'access[_-]?token',
  'refresh[_-]?token',
  'api[_-]?key',
  'client[_-]?secret',
  'authorization',
  'passphrase',
  'password',
  'secret',
  'token',
].join('|');

/** `"password": "hunter2"` — JSON, including escaped quotes inside the value. */
const JSON_PAIR_RE = new RegExp(`("(?:${TEXT_KEYS})"\\s*:\\s*")((?:[^"\\\\]|\\\\.)*)(")`, 'gi');
/** `password=hunter2`, `token: abc`, `X-Amz-Signature=…&` — query strings, headers, prose. */
const BARE_PAIR_RE = new RegExp(
  `\\b(${TEXT_KEYS})(\\s*[:=]\\s*)(?!\\[REDACTED\\])([^\\s,;&"']+)`,
  'gi',
);
/** `Bearer eyJ…` / `Basic dXNlcjpw…` — the scheme word would otherwise be the only thing redacted. */
const AUTH_SCHEME_RE = /\b(bearer|basic)\s+[A-Za-z0-9._~+/=-]+/gi;

export function redactString(input: string): string {
  return input
    .replace(
      /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
      PLACEHOLDER,
    )
    .replace(JSON_PAIR_RE, `$1${PLACEHOLDER}$3`)
    .replace(AUTH_SCHEME_RE, `$1 ${PLACEHOLDER}`)
    .replace(BARE_PAIR_RE, `$1$2${PLACEHOLDER}`);
}

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return PLACEHOLDER;
  if (value == null) return value;
  if (typeof value === 'string') return redactString(value);
  if (typeof value !== 'object') return value;
  if (Buffer.isBuffer(value)) return `[Buffer ${value.length}b]`;
  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactString(value.message),
      stack: value.stack ? redactString(value.stack) : undefined,
    };
  }
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = isSensitiveKey(k) ? PLACEHOLDER : redact(v, depth + 1);
  }
  return out;
}
