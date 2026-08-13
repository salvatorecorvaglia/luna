import { describe, expect, it } from 'vitest';
import { parseIni } from '../../../../src/main/lib/importers/ini-parser';

describe('INI Parser', () => {
  it('should parse standard INI content correctly', () => {
    const content = `
      [section1]
      key1 = value1
      key2 = value2

      [section2]
      key3 = value3
    `;
    const result = parseIni(content);
    expect(result.section1).toBeDefined();
    expect(result.section1.key1).toBe('value1');
    expect(result.section1.key2).toBe('value2');
    expect(result.section2.key3).toBe('value3');
  });

  it('should ignore comments and empty lines', () => {
    const content = `
      ; comment 1
      # comment 2

      [section]
      key = value
    `;
    const result = parseIni(content);
    expect(result.section.key).toBe('value');
  });

  it('should block prototype pollution via section headers', () => {
    const content = `
      [__proto__]
      polluted = true

      [constructor]
      polluted = true

      [prototype]
      polluted = true

      [valid_section]
      key = value
    `;
    const result = parseIni(content);
    // Since Object.create(null) was used, prototype properties shouldn't be defined on the global object prototype
    expect('polluted' in Object.prototype).toBe(false);
    expect(Object.getPrototypeOf(result)).toBeNull();
    const resultObj = result as Record<string, unknown>;
    expect(resultObj.constructor).toBeUndefined();
    expect(resultObj.prototype).toBeUndefined();
    expect(result.valid_section.key).toBe('value');
  });

  it('should block prototype pollution via property keys', () => {
    const content = `
      [section]
      __proto__ = true
      constructor = true
      prototype = true
      key = value
    `;
    const result = parseIni(content);
    expect('polluted' in Object.prototype).toBe(false);
    expect(Object.getPrototypeOf(result.section)).toBeNull();
    const sectionObj = result.section as Record<string, unknown>;
    expect(sectionObj.constructor).toBeUndefined();
    expect(sectionObj.prototype).toBeUndefined();
    expect(result.section.key).toBe('value');
  });

  it('should handle values with multiple equal signs correctly', () => {
    const content = `
      [section]
      url = http://example.com/query?param=1&other=2
      formula = a = b = c
    `;
    const result = parseIni(content);
    expect(result.section.url).toBe('http://example.com/query?param=1&other=2');
    expect(result.section.formula).toBe('a = b = c');
  });

  it('should handle keys and values with leading/trailing spaces correctly', () => {
    const content = `
      [ my section ]
      my key = my value 
    `;
    const result = parseIni(content);
    expect(result['my section']).toBeDefined();
    expect(result['my section']['my key']).toBe('my value');
  });

  it('should ignore invalid or malformed lines', () => {
    const content = `
      [section]
      invalidline
      =value_with_no_key
      key = value
    `;
    const result = parseIni(content);
    expect(result.section.key).toBe('value');
    expect(Object.keys(result.section).length).toBe(1);
  });
});
