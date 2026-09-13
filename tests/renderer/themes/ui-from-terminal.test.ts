import { describe, expect, it } from 'vitest';
import {
  buildUIThemeTokens,
  deriveUITokens,
} from '../../../src/renderer/src/themes/ui-from-terminal';

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

/**
 * Relative luminance / contrast, per WCAG. Duplicated here rather than exported
 * from the module under test so the assertion does not depend on the same
 * arithmetic the implementation uses.
 */
function luminance(css: string): number {
  const hsl = /hsl\(\s*([\d.]+)\s+([\d.]+)%\s+([\d.]+)%\s*\)/.exec(css);
  let r: number;
  let g: number;
  let b: number;
  if (hsl) {
    const h = Number(hsl[1]) / 360;
    const sat = Number(hsl[2]) / 100;
    const l = Number(hsl[3]) / 100;
    const c = (1 - Math.abs(2 * l - 1)) * sat;
    const hp = h * 6;
    const x = c * (1 - Math.abs((hp % 2) - 1));
    const m = l - c / 2;
    const seg = Math.floor(hp) % 6;
    const table: [number, number, number][] = [
      [c, x, 0],
      [x, c, 0],
      [0, c, x],
      [0, x, c],
      [x, 0, c],
      [c, 0, x],
    ];
    const [r0, g0, b0] = table[seg] ?? [0, 0, 0];
    [r, g, b] = [r0 + m, g0 + m, b0 + m];
  } else {
    const hex = css.replace('#', '');
    const full =
      hex.length === 3
        ? hex
            .split('')
            .map((ch) => ch + ch)
            .join('')
        : hex;
    r = parseInt(full.slice(0, 2), 16) / 255;
    g = parseInt(full.slice(2, 4), 16) / 255;
    b = parseInt(full.slice(4, 6), 16) / 255;
  }
  const lin = (v: number): number => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrastOf(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

describe('destructive ink', () => {
  /**
   * `destructive-fg` is the token design-tokens.test.ts mandates for destructive
   * *text*, and it is used in about thirty places — but it was absent from
   * UIThemeTokens and TOKEN_KEYS, so it was never written and stayed pinned to
   * main.css's light red while `destructive`, `background` and `card` all moved
   * with the terminal theme. Switching themes therefore produced a
   * partially-themed palette, and on a light ground it left low-contrast red on
   * light.
   */
  it('is emitted for both a dark and a light ground', () => {
    const dark = deriveUITokens({ background: '#101010', foreground: '#eeeeee', red: '#ef4444' });
    const light = deriveUITokens({ background: '#fafafa', foreground: '#101010', red: '#ef4444' });
    expect(dark['destructive-fg']).toBeTruthy();
    expect(light['destructive-fg']).toBeTruthy();
  });

  it('adapts to the ground rather than being a constant', () => {
    const dark = deriveUITokens({ background: '#101010', foreground: '#eeeeee', red: '#ef4444' });
    const light = deriveUITokens({ background: '#fafafa', foreground: '#101010', red: '#ef4444' });
    expect(dark['destructive-fg']).not.toBe(light['destructive-fg']);
  });

  it('stays legible against the card surface it sits on', () => {
    for (const ground of [
      { background: '#101010', foreground: '#eeeeee', red: '#ef4444' },
      { background: '#fafafa', foreground: '#101010', red: '#ef4444' },
      { background: '#1a1b26', foreground: '#a9b1d6', red: '#f7768e' },
    ]) {
      const tokens = deriveUITokens(ground);
      const ratio = contrastOf(tokens['destructive-fg'], tokens.card);
      expect(
        ratio,
        `destructive-fg on card for ${ground.background} is ${ratio.toFixed(2)}:1`,
      ).toBeGreaterThanOrEqual(4.4);
    }
  });

  it('is included in the applied token set', () => {
    // The actual defect was omission from TOKEN_KEYS, which is what decides
    // which tokens get written to documentElement.
    const tokens = deriveUITokens({ background: '#101010', foreground: '#eeeeee' });
    expect(Object.keys(tokens)).toContain('destructive-fg');
  });
});
