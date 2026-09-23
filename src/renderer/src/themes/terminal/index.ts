import type { TerminalThemeName } from '@shared/types/terminal';
import type { ITheme } from '@xterm/xterm';
import { draculaTheme } from './dracula';
import { gruvboxTheme } from './gruvbox';
import { monokaiTheme } from './monokai';
import { nordTheme } from './nord';
import { oneDarkTheme } from './one-dark';
import { tokyoNightTheme } from './tokyo-night';

export const terminalThemes: Record<TerminalThemeName, ITheme> = {
  dracula: draculaTheme,
  nord: nordTheme,
  'tokyo-night': tokyoNightTheme,
  gruvbox: gruvboxTheme,
  'one-dark': oneDarkTheme,
  monokai: monokaiTheme,
};

export { draculaTheme, gruvboxTheme, monokaiTheme, nordTheme, oneDarkTheme, tokyoNightTheme };
