import type {ITheme} from '@xterm/xterm'
import {draculaTheme} from './dracula'
import {nordTheme} from './nord'
import {tokyoNightTheme} from './tokyo-night'
import {solarizedDarkTheme} from './solarized-dark'
import {gruvboxTheme} from './gruvbox'
import {oneDarkTheme} from './one-dark'
import {monokaiTheme} from './monokai'
import type {TerminalThemeName} from '@shared/types/terminal'

export const terminalThemes: Record<TerminalThemeName, ITheme> = {
  dracula: draculaTheme,
  nord: nordTheme,
  'tokyo-night': tokyoNightTheme,
  'solarized-dark': solarizedDarkTheme,
  gruvbox: gruvboxTheme,
  'one-dark': oneDarkTheme,
  monokai: monokaiTheme
}

export {
  draculaTheme,
  nordTheme,
  tokyoNightTheme,
  solarizedDarkTheme,
  gruvboxTheme,
  oneDarkTheme,
  monokaiTheme
}
