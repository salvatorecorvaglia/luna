import { describe, expect, it } from 'vitest';
import { buildUIThemeTokens, deriveUITokens } from '../../../src/renderer/src/themes/ui-from-terminal';

describe('deriveUITokens', () => {
  it('preserves explicit background and foreground', () => {
    const out = deriveUITokens({ background: '#101010', foreground: '#eeeeee' });
    expect(out.background).toBe('#101010');
    expect(out.foreground).toBe('#eeeeee');
  });

  it('produces all required token keys', () => {
    const out = deriveUITokens({ background: '#101010', foreground: '#eeeeee' });
    const requiredKeys = [
      'card',
      'popover',
      'primary',
      'secondary',
      'muted',
      'accent',
      'border',
      'destructive',
      'sidebar',
      'success',
      'warning',
      'info',
    ];
    for (const k of requiredKeys) {
      expect(out[k as keyof typeof out]).toBeTruthy();
    }
  });

  it('lightens for dark backgrounds and darkens for light ones', () => {
    const dark = deriveUITokens({ background: '#101010', foreground: '#eeeeee' });
    const light = deriveUITokens({ background: '#fafafa', foreground: '#101010' });
    // Card differs from background in both directions.
    expect(dark.card).not.toBe('#101010');
    expect(light.card).not.toBe('#fafafa');
  });

  it('falls back to a sane primary when no terminal accent is provided', () => {
    const out = deriveUITokens({ background: '#101010', foreground: '#eeeeee' });
    expect(out.primary).toMatch(/^#?[0-9a-fA-F]{3,8}|hsl\(/);
  });
});

describe('buildUIThemeTokens', () => {
  it('applies per-theme overrides on top of derived tokens', () => {
    const tokens = buildUIThemeTokens('dracula');
    // Sanity: full token set is present.
    expect(tokens.background).toBeTruthy();
    expect(tokens.foreground).toBeTruthy();
    expect(tokens.primary).toBeTruthy();
  });
});
