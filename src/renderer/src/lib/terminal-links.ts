import { toastArgs } from '@shared/error-messages';
import { toast } from 'sonner';
import { getApi } from '@/services/api';

/**
 * Open a link clicked in a terminal.
 *
 * Requires Cmd (macOS) or Ctrl held, like every mainstream terminal: output is
 * attacker-influenced (a remote `cat`, a crafted OSC 8 hyperlink), and a plain
 * click is also how users select text, so an unmodified click must never
 * launch anything. The URL is validated again in main (https only).
 */
export function openTerminalLink(event: MouseEvent, uri: string): void {
  if (!event.metaKey && !event.ctrlKey) return;
  getApi()
    .app.openExternal(uri)
    .catch((err: unknown) => {
      toast.error(...toastArgs(err, 'Could not open link'));
    });
}
