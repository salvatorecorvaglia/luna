import type { ITheme } from '@xterm/xterm'
import type { UIThemeTokens } from '../ui-from-terminal'

export const gruvboxUIOverrides: Partial<UIThemeTokens> = {
  primary: '#fabd2f',
  ring: '#fabd2f',
  'sidebar-primary': '#fabd2f',
  'sidebar-ring': '#fabd2f',
  'primary-foreground': '#282828',
  'sidebar-primary-foreground': '#282828'
}

export const gruvboxTheme: ITheme = {
  background: '#282828',
  foreground: '#ebdbb2',
  cursor: '#ebdbb2',
  cursorAccent: '#282828',
  selectionBackground: '#504945',
  selectionForeground: '#ebdbb2',
  black: '#282828',
  red: '#cc241d',
  green: '#98971a',
  yellow: '#d79921',
  blue: '#458588',
  magenta: '#b16286',
  cyan: '#689d6a',
  white: '#a89984',
  brightBlack: '#928374',
  brightRed: '#fb4934',
  brightGreen: '#b8bb26',
  brightYellow: '#fabd2f',
  brightBlue: '#83a598',
  brightMagenta: '#d3869b',
  brightCyan: '#8ec07c',
  brightWhite: '#ebdbb2'
}
