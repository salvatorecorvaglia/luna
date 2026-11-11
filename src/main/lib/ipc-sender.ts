import { ErrorCode, LunaError } from '@shared/errors';
import type { WebContents } from 'electron';
import { isAllowedNavigation } from './navigation-guard';

let owner: { contents: WebContents; entry: string; devUrl?: string } | null = null;

export function setTrustedIpcSender(
  contents: WebContents | null,
  entry = '',
  devUrl?: string,
): void {
  owner = contents ? { contents, entry, devUrl } : null;
}

export function assertTrustedIpcSender(event: Electron.IpcMainInvokeEvent): void {
  const frame = event?.senderFrame;
  if (
    !owner ||
    !frame ||
    event.sender !== owner.contents ||
    owner.contents.isDestroyed() ||
    frame !== owner.contents.mainFrame ||
    !isAllowedNavigation(frame.url, owner.entry, owner.devUrl)
  ) {
    throw new LunaError('IPC sender is not the application document', ErrorCode.FORBIDDEN);
  }
}
