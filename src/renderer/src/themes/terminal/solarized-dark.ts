import type { ITheme } from '@xterm/xterm'
import type { UIThemeTokens } from '../ui-from-terminal'

export const solarizedDarkUIOverrides: Partial<UIThemeTokens> = {
  primary: '#268bd2',
  ring: '#268bd2',
  'sidebar-primary': '#268bd2',
  'sidebar-ring': '#268bd2',
  foreground: '#93a1a1',
  'sidebar-foreground': '#93a1a1'
}

export const solarizedDarkTheme: ITheme = {
  background: '#002b36',
  foreground: '#839496',
  cursor: '#839496',
  cursorAccent: '#002b36',
  selectionBackground: '#073642',
  selectionForeground: '#93a1a1',
  black: '#073642',
  red: '#dc322f',
  green: '#859900',
  yellow: '#b58900',
  blue: '#268bd2',
  magenta: '#d33682',
  cyan: '#2aa198',
  white: '#eee8d5',
  brightBlack: '#586e75',
  brightRed: '#cb4b16',
  brightGreen: '#586e75',
  brightYellow: '#657b83',
  brightBlue: '#839496',
  brightMagenta: '#6c71c4',
  brightCyan: '#93a1a1',
  brightWhite: '#fdf6e3'
}
