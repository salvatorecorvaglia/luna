import { describe, expect, it } from 'vitest';
import {
  extractSnippetVariables,
  substituteSnippetVariables,
} from '../../../src/renderer/src/lib/snippets';

describe('snippet templates', () => {
  it('extracts distinct trimmed names', () => {
    expect(extractSnippetVariables('ssh {{ host }} && ping {{host}} -c {{count}}')).toEqual([
      'host',
      'count',
    ]);
  });

  it('inserts values literally, without replacement-pattern expansion', () => {
    // Regression: values went in as a replacement string, so `$&` re-inserted
    // the placeholder and `$$` collapsed to `$`.
    expect(substituteSnippetVariables('echo {{v}}', { v: 'cost: $& and $$5' })).toBe(
      'echo cost: $& and $$5',
    );
  });

  it('handles names containing regex metacharacters', () => {
    // Regression: `{{a(b}}` threw a SyntaxError; `{{file.name}}` over-matched.
    expect(substituteSnippetVariables('x {{a(b}}', { 'a(b': '1' })).toBe('x 1');
    expect(substituteSnippetVariables('{{file.name}} {{fileXname}}', { 'file.name': 'f' })).toBe(
      'f {{fileXname}}',
    );
  });

  it('leaves placeholders without a value untouched', () => {
    expect(substituteSnippetVariables('{{a}} {{b}}', { a: '1' })).toBe('1 {{b}}');
  });
});
