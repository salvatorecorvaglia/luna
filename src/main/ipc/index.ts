import { registerAppHandlers } from './app.ipc';
import { registerConnectionHandlers } from './connection.ipc';
import { registerCredentialHandlers } from './credentials.ipc';
import { registerLocalTerminalHandlers } from './local-terminal.ipc';
import { registerLogHandlers } from './log.ipc';
import { registerS3Handlers } from './s3.ipc';
import { registerSettingsHandlers } from './settings.ipc';
import { registerShellHandlers } from './shell.ipc';
import { registerSshHandlers } from './ssh.ipc';
import { registerStorageHandlers } from './storage.ipc';
import { registerTransferHandlers } from './transfer.ipc';

export function registerAllHandlers(): void {
  registerConnectionHandlers();
  registerSettingsHandlers();
  registerCredentialHandlers();
  registerShellHandlers();
  registerSshHandlers();
  registerTransferHandlers();
  registerStorageHandlers();
  registerS3Handlers();
  registerAppHandlers();
  registerLocalTerminalHandlers();
  registerLogHandlers();
}
