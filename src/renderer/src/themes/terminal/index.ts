import type { ITheme } from '@xterm/xterm';
import { draculaTheme } from './dracula';
import { nordTheme } from './nord';
import { tokyoNightTheme } from './tokyo-night';
import { gruvboxTheme } from './gruvbox';
import { oneDarkTheme } from './one-dark';
import { monokaiTheme } from './monokai';
import type { TerminalThemeName } from '@shared/types/terminal';

export const terminalThemes: Record<TerminalThemeName, ITheme> = {
  dracula: draculaTheme,
  nord: nordTheme,
  'tokyo-night': tokyoNightTheme,
  gruvbox: gruvboxTheme,
  'one-dark': oneDarkTheme,
  monokai: monokaiTheme,
};

export { draculaTheme, nordTheme, tokyoNightTheme, gruvboxTheme, oneDarkTheme, monokaiTheme };
