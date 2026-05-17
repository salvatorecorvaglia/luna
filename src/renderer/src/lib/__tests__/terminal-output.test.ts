import { describe, expect, it } from 'vitest';
import { sanitizeTerminalText } from '../terminal-output';

describe('sanitizeTerminalText', () => {
  it('preserves printable ASCII', () => {
    expect(sanitizeTerminalText('hello world 123 !@#$%^&*()_+-=[]{};:\'",.<>/?')).toBe(
      'hello world 123 !@#$%^&*()_+-=[]{};:\'",.<>/?',
    );
  });

  it('preserves whitespace (tab, LF, CR) so multi-line errors still wrap', () => {
    expect(sanitizeTerminalText('a\tb\nc\r\nd')).toBe('a\tb\nc\r\nd');
  });

  it('replaces ESC and other C0 control chars with "?"', () => {
    // ESC then a CSI sequence "\x1b[31m" should be neutralised so it can't
    // recolour the terminal when written verbatim.
    expect(sanitizeTerminalText('\x1b[31mRED\x1b[0m')).toBe('?[31mRED?[0m');
  });

  it('replaces DEL (0x7f) with "?"', () => {
    expect(sanitizeTerminalText('a\x7fb')).toBe('a?b');
  });

  it('replaces NUL with "?"', () => {
    expect(sanitizeTerminalText('foo\0bar')).toBe('foo?bar');
  });

  it('handles an empty string', () => {
    expect(sanitizeTerminalText('')).toBe('');
  });

  it('strips a full ANSI-smuggling payload from an untrusted error string', () => {
    // Simulates a malicious server message that tries to clear the screen
    // and reposition the cursor — both effects must be neutralised.
    const payload = 'oops\x1b[2J\x1b[H\x1b[1;31mPWNED';
    const cleaned = sanitizeTerminalText(payload);
    expect(cleaned).not.toContain('\x1b');
    expect(cleaned.startsWith('oops')).toBe(true);
    expect(cleaned.endsWith('PWNED')).toBe(true);
  });
});
