/**
 * Strip control characters (including ESC `0x1B`) from a string before
 * writing it into an xterm buffer. Server-side error messages can otherwise
 * smuggle ANSI escape sequences (cursor moves, screen clears, hyperlink
 * sequences) into the local terminal — this neutralises them by replacing
 * each non-printable byte with `?`. Tabs (`\t`), LF (`\n`) and CR (`\r`) are
 * preserved so multi-line error strings still wrap cleanly.
 *
 * Both control blocks are rejected. C0 (`0x00`–`0x1F`) is the obvious one, but
 * the check used to be `code >= 32`, which admitted the whole C1 block
 * (`0x80`–`0x9F`). In a decoded UTF-8 string those are real characters, and
 * xterm's parser honours them as single-byte equivalents of the ESC sequences
 * — U+009B is CSI, U+009D is OSC. A hostile server could therefore still move
 * the cursor or clear the screen through the one function whose entire job is
 * to stop that.
 */
export function sanitizeTerminalText(s: string): string {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    const isC0 = code < 32;
    const isC1 = code >= 0x7f && code <= 0x9f; // DEL + the C1 block
    const printable = code === 9 || code === 10 || code === 13 || (!isC0 && !isC1);
    out += printable ? s[i] : '?';
  }
  return out;
}
