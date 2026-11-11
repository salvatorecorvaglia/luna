import { LIMITS } from '@shared/constants';
import { isEditableContent, textByteLength } from '@shared/editor';
import { describe, expect, it } from 'vitest';
import { assertEditableText } from '../../src/main/lib/validate';

describe('editing size contract', () => {
  it.each(['a', '"', '\\', '\u0000'])(
    'allows the byte boundary with %j while leaving room for the JSON envelope',
    (character) => {
      const content = character.repeat(LIMITS.MAX_EDITABLE_BYTES);
      expect(isEditableContent(content)).toBe(true);
      expect(() => assertEditableText(content)).not.toThrow();
      const payload = [{ sessionId: 's'.repeat(100), path: '/path/file', content }];
      expect(textByteLength(JSON.stringify(payload))).toBeLessThan(LIMITS.MAX_IPC_PAYLOAD_BYTES);
      expect(isEditableContent(`${content}x`)).toBe(false);
      expect(() => assertEditableText(`${content}x`)).toThrow(/editing limit/);
    },
  );
  it('counts multibyte UTF-8 and surrogate pairs consistently in both processes', () => {
    const content = '😀'.repeat(LIMITS.MAX_EDITABLE_BYTES / 4);
    expect(textByteLength(content)).toBe(LIMITS.MAX_EDITABLE_BYTES);
    expect(isEditableContent(content)).toBe(true);
    expect(() => assertEditableText(content)).not.toThrow();
    expect(isEditableContent(`${content}é`)).toBe(false);
    expect(() => assertEditableText(`${content}é`)).toThrow();
  });
});
