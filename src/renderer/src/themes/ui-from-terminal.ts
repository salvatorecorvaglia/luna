import type { ITheme } from '@xterm/xterm'
import type { TerminalThemeName } from '@shared/types/terminal'
import { terminalThemes } from './terminal'
import { draculaUIOverrides } from './terminal/dracula'
import { nordUIOverrides } from './terminal/nord'
import { tokyoNightUIOverrides } from './terminal/tokyo-night'
import { solarizedDarkUIOverrides } from './terminal/solarized-dark'
import { gruvboxUIOverrides } from './terminal/gruvbox'
import { oneDarkUIOverrides } from './terminal/one-dark'
import { monokaiUIOverrides } from './terminal/monokai'

export interface UIThemeTokens {
  background: string
  foreground: string
  card: string
  'card-foreground': string
  popover: string
  'popover-foreground': string
  primary: string
  'primary-foreground': string
  secondary: string
  'secondary-foreground': string
  muted: string
  'muted-foreground': string
  accent: string
  'accent-foreground': string
  destructive: string
  'destructive-foreground': string
  border: string
  input: string
  ring: string
  success: string
  warning: string
  info: string
  sidebar: string
  'sidebar-foreground': string
  'sidebar-primary': string
  'sidebar-primary-foreground': string
  'sidebar-accent': string
  'sidebar-accent-foreground': string
  'sidebar-border': string
  'sidebar-ring': string
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
  'sidebar-ring'
]

interface HSL {
  h: number
  s: number
  l: number
}

function hexToHsl(hex: string): HSL {
  const clean = hex.replace('#', '')
  const r = parseInt(clean.slice(0, 2), 16) / 255
  const g = parseInt(clean.slice(2, 4), 16) / 255
  const b = parseInt(clean.slice(4, 6), 16) / 255

  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  let h = 0
  let s = 0

  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0)
        break
      case g:
        h = (b - r) / d + 2
        break
      case b:
        h = (r - g) / d + 4
        break
    }
    h *= 60
  }

  return { h, s: s * 100, l: l * 100 }
}

function hslToCss({ h, s, l }: HSL): string {
  return `hsl(${h.toFixed(1)} ${s.toFixed(1)}% ${l.toFixed(1)}%)`
}

function shiftLightness(hex: string, deltaPct: number): string {
  const hsl = hexToHsl(hex)
  hsl.l = Math.max(0, Math.min(100, hsl.l + deltaPct))
  return hslToCss(hsl)
}

function isDark(hex: string): boolean {
  return hexToHsl(hex).l < 50
}

function pickAccent(term: ITheme): string {
  return term.brightBlue || term.blue || term.brightMagenta || term.magenta || '#7aa2f7'
}

export function deriveUITokens(term: ITheme): UIThemeTokens {
  const bg = term.background || '#1a1b26'
  const fg = term.foreground || '#a9b1d6'
  const dark = isDark(bg)
  const sign = dark ? 1 : -1

  const card = shiftLightness(bg, sign * 3)
  const popover = card
  const sidebar = shiftLightness(bg, sign * -2)
  const muted = shiftLightness(bg, sign * 6)
  const accent = shiftLightness(bg, sign * 8)
  const border = shiftLightness(bg, sign * 10)
  const secondary = shiftLightness(bg, sign * 5)

  const accentColor = pickAccent(term)
  const fgMuted = shiftLightness(fg, sign * -25)

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
    'sidebar-ring': accentColor
  }
}

const UI_OVERRIDES: Record<TerminalThemeName, Partial<UIThemeTokens>> = {
  dracula: draculaUIOverrides,
  nord: nordUIOverrides,
  'tokyo-night': tokyoNightUIOverrides,
  'solarized-dark': solarizedDarkUIOverrides,
  gruvbox: gruvboxUIOverrides,
  'one-dark': oneDarkUIOverrides,
  monokai: monokaiUIOverrides
}

export function buildUIThemeTokens(name: TerminalThemeName): UIThemeTokens {
  const term = terminalThemes[name]
  return { ...deriveUITokens(term), ...UI_OVERRIDES[name] }
}

export function applyUIThemeTokens(tokens: UIThemeTokens | null): void {
  const root = document.documentElement
  if (tokens) {
    for (const key of TOKEN_KEYS) {
      root.style.setProperty(`--color-${key}`, tokens[key])
    }
    root.classList.add('ui-themed')
  } else {
    for (const key of TOKEN_KEYS) {
      root.style.removeProperty(`--color-${key}`)
    }
    root.classList.remove('ui-themed')
  }
}
