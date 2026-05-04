import { describe, expect, it } from 'vitest';
import { redact, redactString } from '../redact';

describe('redactString', () => {
  it('redacts password=… style fragments', () => {
    expect(redactString('password=hunter2')).toBe('password=[REDACTED]');
  });
  it('redacts authorization headers', () => {
    expect(redactString('Authorization: Bearer abc123')).toContain('[REDACTED]');
  });
  it('passes plain text through', () => {
    expect(redactString('hello world')).toBe('hello world');
  });
});

describe('redact', () => {
  it('redacts sensitive object keys', () => {
    const out = redact({ user: 'me', password: 'hunter2', passphrase: 's3cret' }) as Record<
      string,
      unknown
    >;
    expect(out.user).toBe('me');
    expect(out.password).toBe('[REDACTED]');
    expect(out.passphrase).toBe('[REDACTED]');
  });

  it('redacts case-insensitively', () => {
    const out = redact({ Password: 'x', PRIVATEKEY: 'y' }) as Record<string, unknown>;
    expect(out.Password).toBe('[REDACTED]');
    expect(out.PRIVATEKEY).toBe('[REDACTED]');
  });

  it('walks arrays and nested objects', () => {
    const out = redact([{ secret: 'x' }, { nested: { token: 't' } }]) as unknown[];
    expect((out[0] as Record<string, unknown>).secret).toBe('[REDACTED]');
    expect(((out[1] as Record<string, unknown>).nested as Record<string, unknown>).token).toBe(
      '[REDACTED]',
    );
  });

  it('handles errors with redacted message and stack', () => {
    const err = new Error('failed: password=hunter2');
    const out = redact(err) as { name: string; message: string };
    expect(out.message).toContain('[REDACTED]');
  });

  it('summarises buffers without leaking content', () => {
    const out = redact(Buffer.from('secret bytes'));
    expect(typeof out).toBe('string');
    expect(out as string).toMatch(/^\[Buffer \d+b\]$/);
  });

  it('caps recursion depth', () => {
    type Recursive = { self?: Recursive };
    const obj: Recursive = {};
    obj.self = obj;
    expect(() => redact(obj)).not.toThrow();
  });
});
