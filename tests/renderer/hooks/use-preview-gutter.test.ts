import { describe, expect, it } from 'vitest';
import { buildPreviewLineIndex } from '../../../src/renderer/src/hooks/use-preview-gutter';

describe('preview line index', () => {
  it('locates lines across sparse checkpoint boundaries, including a trailing empty line', () => {
    const text = `${Array.from({ length: 1000 }, (_, i) => `line-${i}`).join('\n')}\n`;
    const expected = [0];
    for (let i = 0; i < text.length; i++) if (text[i] === '\n') expected.push(i + 1);
    const index = buildPreviewLineIndex(text);
    expect(index.count).toBe(expected.length);
    for (const line of [0, 1, 127, 128, 129, 255, 256, 999, 1000]) {
      expect(index.offsetAt(line)).toBe(expected[line]);
      expect(index.offsetAt(line)).toBe(expected[line]);
    }
  });
  it('supports empty input and revisiting lines after the bounded cache fills', () => {
    const empty = buildPreviewLineIndex('');
    expect(empty.count).toBe(1);
    expect(empty.offsetAt(0)).toBe(0);
    const index = buildPreviewLineIndex('a\n'.repeat(5000));
    for (let line = 0; line <= 5000; line++) expect(index.offsetAt(line)).toBe(line * 2);
    expect(index.offsetAt(128)).toBe(256);
  });
});
