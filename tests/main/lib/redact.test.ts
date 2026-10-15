import { describe, expect, it } from 'vitest';
import { redact, redactString } from '../../../src/main/lib/redact';

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

  describe('gaps closed', () => {
    it('redacts JSON-quoted keys', () => {
      const out = redactString('{"user":"u","password":"hun\\"ter2","token": "abc"}');
      expect(out).not.toContain('hun');
      expect(out).not.toContain('abc');
      expect(out).toContain('"user":"u"');
    });

    it('redacts S3 presigned-URL signatures and session tokens', () => {
      const url =
        'https://b.s3.amazonaws.com/k?X-Amz-Credential=AKIA%2F&X-Amz-Security-Token=FQoG&X-Amz-Signature=deadbeef&X-Amz-Expires=60';
      const out = redactString(url);
      expect(out).not.toContain('deadbeef');
      expect(out).not.toContain('FQoG');
      expect(out).not.toContain('AKIA');
      expect(out).toContain('X-Amz-Expires=60');
    });

    it('redacts the token after a Bearer/Basic scheme, not just the scheme word', () => {
      const out = redactString('Authorization: Bearer eyJhbGciOi.payload.sig');
      expect(out).not.toContain('eyJ');
    });

    it('redacts token= and api_key= fragments', () => {
      expect(redactString('token=abc123 api_key=zzz')).not.toMatch(/abc123|zzz/);
    });

    it('treats camelCase and suffixed object keys as sensitive', () => {
      const out = redact({
        accessToken: 'a',
        refresh_token: 'b',
        apiKey: 'c',
        dbPassword: 'd',
        clientSecret: 'e',
        tokenCount: 3,
      }) as Record<string, unknown>;
      expect(out).toEqual({
        accessToken: '[REDACTED]',
        refresh_token: '[REDACTED]',
        apiKey: '[REDACTED]',
        dbPassword: '[REDACTED]',
        clientSecret: '[REDACTED]',
        tokenCount: 3,
      });
    });
  });
});
