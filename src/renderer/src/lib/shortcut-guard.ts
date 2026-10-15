/**
 * True while any modal dialog is open.
 *
 * Every modal renders with `aria-modal="true"` (DialogShell and the command
 * palette), so this is the one marker global shortcut handlers can check. They
 * listen on `window`, and without this Cmd+W closed the terminal tab *behind*
 * an open connection form, Cmd+T opened tabs under Settings, and Cmd+1..9
 * switched tabs out from under a confirmation prompt.
 */
export function isModalOpen(): boolean {
  return typeof document !== 'undefined' && document.querySelector('[aria-modal="true"]') !== null;
}
