/**
 * Strip control characters (including ESC `0x1B`) from a string before
 * writing it into an xterm buffer. Server-side error messages can otherwise
 * smuggle ANSI escape sequences (cursor moves, screen clears, hyperlink
 * sequences) into the local terminal — this neutralises them by replacing
 * each non-printable byte with `?`. Tabs (`\t`), LF (`\n`) and CR (`\r`) are
 * preserved so multi-line error strings still wrap cleanly.
 */
export function sanitizeTerminalText(s: string): string {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    const printable = code === 9 || code === 10 || code === 13 || (code >= 32 && code !== 127);
    out += printable ? s[i] : '?';
  }
  return out;
}
