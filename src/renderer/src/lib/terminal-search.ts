import type { ISearchOptions } from '@xterm/addon-search';

/**
 * Options for every terminal search call.
 *
 * `decorations` is not cosmetic: @xterm/addon-search only fires
 * `onDidChangeResults` — the source of the "2/7" chip and of "no matches" —
 * when decorations are enabled. Without them the count never appeared and a
 * miss looked exactly like a hit. Overview-ruler colours must be #RRGGBB.
 */
const DECORATIONS: NonNullable<ISearchOptions['decorations']> = {
  matchBackground: '#5c4b00',
  matchBorder: '#b58900',
  matchOverviewRuler: '#b58900',
  activeMatchBackground: '#b58900',
  activeMatchBorder: '#ffd75f',
  activeMatchColorOverviewRuler: '#ffd75f',
};

/** Enter / Shift+Enter / the arrow buttons: move to the next or previous match. */
export const SEARCH_STEP_OPTIONS: ISearchOptions = { decorations: DECORATIONS };

/**
 * Typing in the box: `incremental` keeps extending the current match instead
 * of jumping to the next one on every keystroke.
 */
export const SEARCH_TYPE_OPTIONS: ISearchOptions = { decorations: DECORATIONS, incremental: true };
