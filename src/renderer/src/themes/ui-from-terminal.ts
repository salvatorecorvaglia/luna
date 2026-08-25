import type { TerminalThemeName } from '@shared/types/terminal';
import type { ITheme } from '@xterm/xterm';
import { terminalThemes } from './terminal';
import { draculaUIOverrides } from './terminal/dracula';
import { gruvboxUIOverrides } from './terminal/gruvbox';
import { monokaiUIOverrides } from './terminal/monokai';
import { nordUIOverrides } from './terminal/nord';
import { oneDarkUIOverrides } from './terminal/one-dark';
import { tokyoNightUIOverrides } from './terminal/tokyo-night';

export interface UIThemeTokens {
  background: string;
  foreground: string;
  card: string;
  'card-foreground': string;
  popover: string;
  'popover-foreground': string;
  primary: string;
  'primary-foreground': string;
  secondary: string;
  'secondary-foreground': string;
  muted: string;
  'muted-foreground': string;
  accent: string;
  'accent-foreground': string;
  destructive: string;
  'destructive-foreground': string;
  border: string;
  input: string;
  ring: string;
  success: string;
  warning: string;
  info: string;
  sidebar: string;
  'sidebar-foreground': string;
  'sidebar-primary': string;
  'sidebar-primary-foreground': string;
  'sidebar-accent': string;
  'sidebar-accent-foreground': string;
  'sidebar-border': string;
  'sidebar-ring': string;
}

const TOKEN_KEYS: (keyof UIThemeTokens)[] = [
  'background',
  'foreground',
  'card',
  'card-foreground',
  'popover',
  'popover-foreground',
  'primary',
  'primary-foreground',
  'secondary',
  'secondary-foreground',
  'muted',
  'muted-foreground',
  'accent',
  'accent-foreground',
  'destructive',
  'destructive-foreground',
  'border',
  'input',
  'ring',
  'success',
  'warning',
  'info',
  'sidebar',
  'sidebar-foreground',
  'sidebar-primary',
  'sidebar-primary-foreground',
  'sidebar-accent',
  'sidebar-accent-foreground',
  'sidebar-border',
  'sidebar-ring',
];

interface HSL {
  h: number;
  s: number;
  l: number;
}

function hexToHsl(hex: string): HSL {
  let clean = hex.replace('#', '');
  if (clean.length === 3) {
    clean = clean
      .split('')
      .map((c) => c + c)
      .join('');
  }
  const r = parseInt(clean.slice(0, 2), 16) / 255;
  const g = parseInt(clean.slice(2, 4), 16) / 255;
  const b = parseInt(clean.slice(4, 6), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      case b:
        h = (r - g) / d + 4;
        break;
    }
    h *= 60;
  }

  return { h, s: s * 100, l: l * 100 };
}

function hslToCss({ h, s, l }: HSL): string {
  return `hsl(${h.toFixed(1)} ${s.toFixed(1)}% ${l.toFixed(1)}%)`;
}

function shiftLightnessHsl(hex: string, deltaPct: number): HSL {
  const hsl = hexToHsl(hex);
  hsl.l = Math.max(0, Math.min(100, hsl.l + deltaPct));
  return hsl;
}

function shiftLightness(hex: string, deltaPct: number): string {
  return hslToCss(shiftLightnessHsl(hex, deltaPct));
}

function isDark(hex: string): boolean {
  return hexToHsl(hex).l < 50;
}

function hslToRgb({ h, s, l }: HSL): [number, number, number] {
  const sFrac = s / 100;
  const lFrac = l / 100;
  const c = (1 - Math.abs(2 * lFrac - 1)) * sFrac;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = lFrac - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) {
    [r, g, b] = [c, x, 0];
  } else if (h < 120) {
    [r, g, b] = [x, c, 0];
  } else if (h < 180) {
    [r, g, b] = [0, c, x];
  } else if (h < 240) {
    [r, g, b] = [0, x, c];
  } else if (h < 300) {
    [r, g, b] = [x, 0, c];
  } else {
    [r, g, b] = [c, 0, x];
  }
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}

function srgbToLinear(channel: number): number {
  const cs = channel / 255;
  return cs <= 0.03928 ? cs / 12.92 : ((cs + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(hsl: HSL): number {
  const [r, g, b] = hslToRgb(hsl);
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
}

function contrastRatio(a: HSL, b: HSL): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Nudges `fg`'s lightness toward `extremeL` (0 or 100) until it reaches
 * `minRatio` contrast against `bg`, without overshooting further than needed.
 * Falls back to the extreme value if even that can't satisfy the ratio.
 */
function ensureContrast(fg: HSL, bg: HSL, minRatio: number, extremeL: number): HSL {
  const candidate: HSL = { ...fg };
  if (contrastRatio(candidate, bg) >= minRatio) return candidate;

  let lo = fg.l;
  let hi = extremeL;
  candidate.l = hi;
  if (contrastRatio(candidate, bg) < minRatio) {
    return candidate;
  }
  for (let i = 0; i < 20; i++) {
    const mid = (lo + hi) / 2;
    candidate.l = mid;
    if (contrastRatio(candidate, bg) >= minRatio) {
      hi = mid;
    } else {
      lo = mid;
    }
  }
  candidate.l = hi;
  return candidate;
}

function pickAccent(term: ITheme): string {
  return term.brightBlue || term.blue || term.brightMagenta || term.magenta || '#7aa2f7';
}

export function deriveUITokens(term: ITheme): UIThemeTokens {
  const bg = term.background || '#1a1b26';
  const fg = term.foreground || '#a9b1d6';
  const dark = isDark(bg);
  const sign = dark ? 1 : -1;

  const cardHsl = shiftLightnessHsl(bg, sign * 3);
  const card = hslToCss(cardHsl);
  const popover = card;
  const sidebar = shiftLightness(bg, sign * -2);
  const muted = shiftLightness(bg, sign * 6);
  const accent = shiftLightness(bg, sign * 8);
  const border = shiftLightness(bg, sign * 10);
  const secondary = shiftLightness(bg, sign * 5);

  const accentColor = pickAccent(term);
  // Muted text (e.g. toast descriptions) sits on `card`. A flat lightness
  // offset from `fg` can land too close to it on some themes, so clamp to a
  // minimum contrast instead of trusting the offset alone.
  const fgMutedHsl = ensureContrast(
    shiftLightnessHsl(fg, sign * -25),
    cardHsl,
    4.5,
    dark ? 100 : 0,
  );
  const fgMuted = hslToCss(fgMutedHsl);

  return {
    background: bg,
    foreground: fg,
    card,
    'card-foreground': fg,
    popover,
    'popover-foreground': fg,
    primary: accentColor,
    'primary-foreground': dark ? '#0b0d12' : '#ffffff',
    secondary,
    'secondary-foreground': fg,
    muted,
    'muted-foreground': fgMuted,
    accent,
    'accent-foreground': fg,
    destructive: term.red || '#ef4444',
    'destructive-foreground': '#ffffff',
    border,
    input: border,
    ring: accentColor,
    success: term.green || '#22c55e',
    warning: term.yellow || '#eab308',
    info: term.blue || '#3b82f6',
    sidebar,
    'sidebar-foreground': fg,
    'sidebar-primary': accentColor,
    'sidebar-primary-foreground': dark ? '#0b0d12' : '#ffffff',
    'sidebar-accent': accent,
    'sidebar-accent-foreground': fg,
    'sidebar-border': border,
    'sidebar-ring': accentColor,
  };
}

const UI_OVERRIDES: Record<TerminalThemeName, Partial<UIThemeTokens>> = {
  dracula: draculaUIOverrides,
  nord: nordUIOverrides,
  'tokyo-night': tokyoNightUIOverrides,
  gruvbox: gruvboxUIOverrides,
  'one-dark': oneDarkUIOverrides,
  monokai: monokaiUIOverrides,
};

export function buildUIThemeTokens(name: TerminalThemeName): UIThemeTokens {
  const term = terminalThemes[name];
  return { ...deriveUITokens(term), ...UI_OVERRIDES[name] };
}

export function applyUIThemeTokens(tokens: UIThemeTokens | null): void {
  const root = document.documentElement;
  if (tokens) {
    for (const key of TOKEN_KEYS) {
      root.style.setProperty(`--color-${key}`, tokens[key]);
    }
    root.classList.add('ui-themed');
  } else {
    for (const key of TOKEN_KEYS) {
      root.style.removeProperty(`--color-${key}`);
    }
    root.classList.remove('ui-themed');
  }
}
