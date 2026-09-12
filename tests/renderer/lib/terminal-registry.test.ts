import { beforeEach, describe, expect, it } from 'vitest';
import {
  __resetTerminalRegistry,
  readTerminalScrollback,
  registerTerminal,
  type ScrollbackSource,
  unregisterTerminal,
} from '../../../src/renderer/src/lib/terminal-registry';

/** xterm pads every line to the terminal width, so fakes must pad too. */
function source(lines: (string | undefined)[]): ScrollbackSource {
  return {
    buffer: {
      active: {
        length: lines.length,
        getLine: (i: number) => {
          const raw = lines[i];
          if (raw === undefined) return undefined;
          return { translateToString: (trimRight?: boolean) => (trimRight ? raw.trimEnd() : raw) };
        },
      },
    },
  };
}

beforeEach(() => {
  __resetTerminalRegistry();
});

describe('readTerminalScrollback', () => {
  it('returns null for a session with no live terminal', () => {
    // Must be distinguishable from an empty transcript: the caller refuses to
    // export in this case rather than writing a header over nothing.
    expect(readTerminalScrollback('missing')).toBeNull();
  });

  it('joins the buffer into text and strips xterm line padding', () => {
    registerTerminal('s1', source(['$ id          ', 'uid=0(root)   ']));
    expect(readTerminalScrollback('s1')).toBe('$ id\nuid=0(root)');
  });

  it('drops the trailing blank lines of a part-empty viewport', () => {
    registerTerminal('s1', source(['line one', '', '    ', '']));
    expect(readTerminalScrollback('s1')).toBe('line one');
  });

  it('returns an empty string for a terminal that has produced no output', () => {
    registerTerminal('s1', source(['', '   ']));
    expect(readTerminalScrollback('s1')).toBe('');
  });

  it('preserves interior blank lines', () => {
    registerTerminal('s1', source(['a', '', 'b']));
    expect(readTerminalScrollback('s1')).toBe('a\n\nb');
  });

  it('tolerates a getLine that returns undefined mid-buffer', () => {
    registerTerminal('s1', source(['a', undefined, 'b']));
    expect(readTerminalScrollback('s1')).toBe('a\n\nb');
  });

  it('stops resolving a session once its pane unregisters', () => {
    registerTerminal('s1', source(['a']));
    unregisterTerminal('s1');
    expect(readTerminalScrollback('s1')).toBeNull();
  });

  it('keeps sessions independent', () => {
    registerTerminal('s1', source(['first']));
    registerTerminal('s2', source(['second']));
    expect(readTerminalScrollback('s1')).toBe('first');
    expect(readTerminalScrollback('s2')).toBe('second');
  });
});
