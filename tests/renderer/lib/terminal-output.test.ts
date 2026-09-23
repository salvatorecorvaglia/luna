import { describe, expect, it } from 'vitest';
import { sanitizeTerminalText } from '../../../src/renderer/src/lib/terminal-output';

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

  describe('C1 controls (0x80-0x9f)', () => {
    // The guard used to be `code >= 32`, which admitted the entire C1 block.
    // In a decoded UTF-8 string those are ordinary characters, and xterm's
    // parser honours them as single-character equivalents of ESC sequences —
    // so a server could still drive the terminal through the one function
    // whose whole job is to stop that.

    it('replaces CSI (U+009B), the single-char equivalent of ESC[', () => {
      expect(sanitizeTerminalText('a31mRED')).toBe('a?31mRED');
    });

    it('replaces OSC (U+009D), used for hyperlink and title sequences', () => {
      expect(sanitizeTerminalText('a0;title')).toBe('a?0;title?');
    });

    it('replaces the whole C1 block', () => {
      for (let code = 0x80; code <= 0x9f; code++) {
        expect(sanitizeTerminalText(String.fromCharCode(code))).toBe('?');
      }
    });

    it('still preserves printable characters either side of the block', () => {
      // U+007E '~' is the last printable ASCII; U+00A0 onward is printable
      // Latin-1 and must survive — non-ASCII text is not an attack.
      expect(sanitizeTerminalText('~ é中')).toBe('~ é中');
    });
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
